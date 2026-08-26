"""Math Quiz backend: session relay mounted under /api/math-quiz/v1.

Implements the relay contract from SPEC.md 12.1: the host's browser is the
authoritative owner of quiz content and game state. The server never sees
or parses the quiz source at all -- it only:

  - mints session identifiers (pin / host_pin) and persists a minimal audit
    row (id, pin, host_pin, created_at -- see SPEC.md 6.1; a host refresh
    loses the whole quiz/game state and must start a new session),
  - relays host-authored events to all subscribers of a session's SSE topic,
  - tallies raw (opaque) answer option indices so a live count can be shown
    without the server ever knowing which option is correct.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Literal

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Path, Request
from pydantic import BaseModel, Field

from api_async import AsyncPubSub, engine, metadata

router = APIRouter(prefix="/api/math-quiz/v1", tags=["math-quiz"])

quiz_events = AsyncPubSub()

math_quiz_quiz_table = sa.Table(
    "math_quiz_quiz",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("pin", sa.Text, unique=True, nullable=False),
    sa.Column("host_pin", sa.Text, unique=True, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)

PIN_ALPHABET = "0123456789"
PIN_LENGTH = 6
NICKNAME_MAX_LENGTH = 30
NICKNAME_RE = re.compile(r"^\S.{0,29}$")  # 1-30 chars, no leading whitespace

# `pin`/`host_pin`/`player_id` are the only access-control secrets (SPEC.md
# §7/§9), so path/body shape is validated up front -- rejecting malformed
# values with 422 before they ever reach a dict-lookup 404, and keeping
# arbitrarily long/weird strings out of in-memory dicts and SSE topic keys.
PIN_PATTERN = r"^\d{6}$"
# secrets.token_urlsafe(n) emits ceil(n * 8 / 6) base64url chars; give some
# slack either side rather than hardcoding the exact length.
HOST_PIN_PATTERN = r"^[A-Za-z0-9_-]{16,64}$"
PLAYER_ID_PATTERN = r"^[A-Za-z0-9_-]{8,64}$"
MAX_OPTION_INDEX = 25  # generous upper bound for multiple-choice option count

PinPath = Path(pattern=PIN_PATTERN)
HostPinPath = Path(pattern=HOST_PIN_PATTERN)


class SessionState:
    """In-memory, per-pin game bookkeeping (see SPEC.md 12.1).

    Deliberately minimal: the server never learns question content or which
    option is correct, only enough to relay events and tally submissions.
    """

    __slots__ = (
        "pin",
        "host_pin",
        "created_at",
        "roster",
        "current_question_index",
        "answered_player_ids",
        "tally",
    )

    def __init__(self, pin: str, host_pin: str):
        self.pin = pin
        self.host_pin = host_pin
        self.created_at = datetime.now(timezone.utc)
        self.roster: dict[str, str] = {}  # player_id -> nickname
        self.current_question_index: int | None = None
        self.answered_player_ids: set[str] = set()
        self.tally: dict[int, int] = {}


# pin -> SessionState, and a reverse index for host-authenticated lookups.
_sessions_by_pin: dict[str, SessionState] = {}
_pin_by_host_pin: dict[str, str] = {}


def _generate_pin() -> str:
    while True:
        candidate = "".join(secrets.choice(PIN_ALPHABET) for _ in range(PIN_LENGTH))
        if candidate not in _sessions_by_pin:
            return candidate


def _get_session_by_pin(pin: str) -> SessionState:
    session = _sessions_by_pin.get(pin)
    if session is None:
        raise HTTPException(status_code=404, detail=f"No session with pin '{pin}'")
    return session


def _get_session_by_host_pin(host_pin: str) -> SessionState:
    pin = _pin_by_host_pin.get(host_pin)
    if pin is None:
        raise HTTPException(status_code=404, detail="Invalid host pin")
    return _sessions_by_pin[pin]


# Request/response models


class CreateSessionResponse(BaseModel):
    pin: str
    host_pin: str


class JoinRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=NICKNAME_MAX_LENGTH)


class JoinResponse(BaseModel):
    player_id: str


# The only event types the host's Vue store ever drives through `advance`
# (SPEC.md §12.1); `player_joined`/`answer_count_update` are published
# server-side instead. Restricting this closes off arbitrary event-type/
# payload injection through an otherwise-generic relay endpoint.
AdvanceEventType = Literal[
    "question_started",
    "question_revealed",
    "leaderboard_updated",
    "session_finished",
]


class AdvanceRequest(BaseModel):
    event_type: AdvanceEventType
    data: dict = Field(default_factory=dict)


class AnswerRequest(BaseModel):
    player_id: str = Field(pattern=PLAYER_ID_PATTERN)
    question_index: int = Field(ge=0)
    option_index: int = Field(ge=0, le=MAX_OPTION_INDEX)


# Endpoints


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session():
    # No body: the server never sees or parses the quiz source (SPEC.md
    # §1/§12.1) -- it only mints identifiers and a bare audit row.
    pin = _generate_pin()
    host_pin = secrets.token_urlsafe(16)
    session = SessionState(pin=pin, host_pin=host_pin)
    _sessions_by_pin[pin] = session
    _pin_by_host_pin[host_pin] = pin

    async with engine.begin() as conn:
        await conn.execute(
            sa.insert(math_quiz_quiz_table).values(
                pin=pin,
                host_pin=host_pin,
                created_at=session.created_at,
            )
        )

    return CreateSessionResponse(pin=pin, host_pin=host_pin)


@router.post("/sessions/{pin}/join", response_model=JoinResponse)
async def join_session(pin: str = PinPath, body: JoinRequest = ...):
    session = _get_session_by_pin(pin)

    nickname = body.nickname.strip()
    if not nickname or not NICKNAME_RE.match(nickname):
        raise HTTPException(status_code=400, detail="Invalid nickname")

    player_id = secrets.token_urlsafe(12)
    session.roster[player_id] = nickname

    quiz_events.publish(
        "player_joined",
        {
            "player_id": player_id,
            "nickname": nickname,
            "player_count": len(session.roster),
        },
        topic=pin,
    )
    return JoinResponse(player_id=player_id)


@router.get("/sessions/{pin}/events")
async def session_events(request: Request, pin: str = PinPath):
    _get_session_by_pin(pin)  # 404s if unknown
    return quiz_events.streaming_response(request, topic=pin, keep_alive_timeout=20)


@router.post("/sessions/{host_pin}/advance")
async def advance_session(host_pin: str = HostPinPath, body: AdvanceRequest = ...):
    session = _get_session_by_host_pin(host_pin)

    if body.event_type == "question_started":
        session.current_question_index = body.data.get("question_index")
        session.answered_player_ids = set()
        session.tally = {}
    elif body.event_type == "session_finished":
        _pin_by_host_pin.pop(host_pin, None)
        _sessions_by_pin.pop(session.pin, None)

    quiz_events.publish(body.event_type, body.data, topic=session.pin)
    return {"ok": True}


@router.post("/sessions/{pin}/answers")
async def submit_answer(pin: str = PinPath, body: AnswerRequest = ...):
    session = _get_session_by_pin(pin)

    if body.player_id not in session.roster:
        raise HTTPException(status_code=403, detail="Unknown player_id for this session")
    if body.question_index != session.current_question_index:
        raise HTTPException(status_code=409, detail="No active question with that index")
    if body.player_id in session.answered_player_ids:
        raise HTTPException(status_code=409, detail="Answer already submitted")

    session.answered_player_ids.add(body.player_id)
    session.tally[body.option_index] = session.tally.get(body.option_index, 0) + 1

    # `player_id`/`option_index`/`submitted_at` are included alongside the
    # aggregate `counts` so the host can build up a per-player answer map
    # (needed to compute correctness/points at reveal time, per SPEC.md
    # §12.1) without the server itself ever learning which option is
    # correct. The server remains opaque to quiz content either way.
    quiz_events.publish(
        "answer_count_update",
        {
            "question_index": body.question_index,
            "counts": session.tally,
            "player_id": body.player_id,
            "option_index": body.option_index,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        },
        topic=pin,
    )
    return {"ok": True}


@router.get("/sessions/{pin}/state")
async def session_state(pin: str = PinPath):
    session = _get_session_by_pin(pin)
    return {
        "pin": session.pin,
        "players": [
            {"player_id": pid, "nickname": nickname}
            for pid, nickname in session.roster.items()
        ],
        "current_question_index": session.current_question_index,
        "tally": session.tally,
    }
