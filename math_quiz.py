"""Math Quiz backend: session relay mounted under /api/math-quiz/v1.

Implements the relay contract from SPEC.md 12.1: the host's browser is the
authoritative owner of quiz content and game state. The server never sees
or parses the quiz source at all -- it only:

  - mints session identifiers (pin / host_token) and per-player tokens, and
    persists a minimal row (id, pin, host_token, created_at -- see SPEC.md
    6.1) that is deleted again as soon as the session finishes, so no trace
    of a played quiz is kept,
  - relays host-authored events to all subscribers of a session's SSE topic,
  - tallies raw (opaque) answer option indices so a live count can be shown
    without the server ever knowing which option is correct.

Every path is addressed by the public `pin`; who you are is proved by a
token sent in a header (`X-Host-Token` / `X-Player-Token`), never in the URL.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Literal

import sqlalchemy as sa
from fastapi import APIRouter, Header, HTTPException, Path, Request
from pydantic import BaseModel, Field

from api_async import AsyncPubSub, engine, metadata

router = APIRouter(prefix="/api/math-quiz/v1", tags=["math-quiz"])

quiz_events = AsyncPubSub()

math_quiz_quiz_table = sa.Table(
    "math_quiz_quiz",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("pin", sa.Text, unique=True, nullable=False),
    sa.Column("host_token", sa.Text, unique=True, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)

PIN_ALPHABET = "0123456789"
PIN_LENGTH = 6
NICKNAME_MAX_LENGTH = 30
NICKNAME_RE = re.compile(r"^\S.{0,29}$")  # 1-30 chars, no leading whitespace

# `host_token`/`player_token` are the only access-control secrets (SPEC.md
# §7/§9), so path/header shape is validated up front -- rejecting malformed
# values with 422 before they ever reach a dict-lookup 404, and keeping
# arbitrarily long/weird strings out of in-memory dicts and SSE topic keys.
PIN_PATTERN = r"^\d{6}$"
# secrets.token_urlsafe(n) emits ceil(n * 8 / 6) base64url chars; give some
# slack either side rather than hardcoding the exact length.
TOKEN_PATTERN = r"^[A-Za-z0-9_-]{16,64}$"
MAX_OPTION_INDEX = 25  # generous upper bound for multiple-choice option count

HOST_TOKEN_HEADER = "X-Host-Token"
PLAYER_TOKEN_HEADER = "X-Player-Token"

PinPath = Path(pattern=PIN_PATTERN)
HostTokenHeader = Header(default=None, alias=HOST_TOKEN_HEADER, pattern=TOKEN_PATTERN)
PlayerTokenHeader = Header(default=None, alias=PLAYER_TOKEN_HEADER, pattern=TOKEN_PATTERN)


class SessionState:
    """In-memory, per-pin game bookkeeping (see SPEC.md 12.1).

    Deliberately minimal: the server never learns question content or which
    option is correct, only enough to relay events and tally submissions.
    """

    __slots__ = (
        "pin",
        "host_token",
        "created_at",
        "roster",
        "player_ids_by_token",
        "current_question_index",
        "answers",
        "tally",
    )

    def __init__(self, pin: str, host_token: str):
        self.pin = pin
        self.host_token = host_token
        self.created_at = datetime.now(timezone.utc)
        self.roster: dict[str, str] = {}  # player_id -> nickname
        # Reconnect credential (SPEC.md §7): unlike `player_id`, which is
        # broadcast to every SSE subscriber, a token is only ever returned to
        # the player who owns it, so it is safe to resume an identity with.
        self.player_ids_by_token: dict[str, str] = {}
        self.current_question_index: int | None = None
        # player_id -> {"option_index": int, "submitted_at": str}, reset on
        # every `question_started`. Doubles as the "already answered" guard.
        self.answers: dict[str, dict] = {}
        self.tally: dict[int, int] = {}


_sessions_by_pin: dict[str, SessionState] = {}


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


def _is_host(session: SessionState, host_token: str | None) -> bool:
    return host_token is not None and secrets.compare_digest(host_token, session.host_token)


def _require_host(session: SessionState, host_token: str | None) -> None:
    if not _is_host(session, host_token):
        raise HTTPException(status_code=403, detail="Invalid or missing host token")


def _require_player(session: SessionState, player_token: str | None) -> str:
    """Return the authenticated player's id -- never taken from the body, so
    one player can't submit or impersonate another's answer."""
    player_id = session.player_ids_by_token.get(player_token) if player_token else None
    if player_id is None:
        raise HTTPException(status_code=403, detail="Invalid or missing player token")
    return player_id


def _require_participant(
    session: SessionState, host_token: str | None, player_token: str | None
) -> None:
    if _is_host(session, host_token):
        return
    if player_token is not None and player_token in session.player_ids_by_token:
        return
    raise HTTPException(status_code=403, detail="Invalid or missing session token")


# Request/response models


class CreateSessionResponse(BaseModel):
    pin: str
    host_token: str


class JoinRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=NICKNAME_MAX_LENGTH)
    # Present when the player is resuming an existing identity after losing
    # its connection; `nickname` is then ignored in favour of the stored one.
    player_token: str | None = Field(default=None, pattern=TOKEN_PATTERN)


class SubmittedAnswer(BaseModel):
    question_index: int
    option_index: int


class JoinResponse(BaseModel):
    player_id: str
    player_token: str
    nickname: str
    reconnected: bool = False
    # Enough state for a reconnecting player to land back where it left off
    # instead of on the lobby screen.
    current_question_index: int | None = None
    submitted_answer: SubmittedAnswer | None = None


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
    question_index: int = Field(ge=0)
    option_index: int = Field(ge=0, le=MAX_OPTION_INDEX)


# Endpoints


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session():
    # No body: the server never sees or parses the quiz source (SPEC.md
    # §1/§12.1) -- it only mints identifiers and a bare row that lives
    # exactly as long as the session does.
    pin = _generate_pin()
    host_token = secrets.token_urlsafe(16)
    session = SessionState(pin=pin, host_token=host_token)
    _sessions_by_pin[pin] = session

    async with engine.begin() as conn:
        await conn.execute(
            sa.insert(math_quiz_quiz_table).values(
                pin=pin,
                host_token=host_token,
                created_at=session.created_at,
            )
        )

    return CreateSessionResponse(pin=pin, host_token=host_token)


@router.post("/sessions/{pin}/join", response_model=JoinResponse)
async def join_session(pin: str = PinPath, body: JoinRequest = ...):
    session = _get_session_by_pin(pin)

    if body.player_token is not None:
        player_id = session.player_ids_by_token.get(body.player_token)
        if player_id is not None:
            # Same identity, so the roster is unchanged -- deliberately no
            # `player_joined` republish, which is what used to make a
            # reconnecting player show up twice on the host screen.
            return _join_response(session, player_id, body.player_token, reconnected=True)
        # A token from a finished/restarted session is treated as absent
        # rather than an error, so the player just joins afresh.

    nickname = body.nickname.strip()
    if not nickname or not NICKNAME_RE.match(nickname):
        raise HTTPException(status_code=400, detail="Invalid nickname")

    player_id = secrets.token_urlsafe(12)
    player_token = secrets.token_urlsafe(24)
    session.roster[player_id] = nickname
    session.player_ids_by_token[player_token] = player_id

    quiz_events.publish(
        "player_joined",
        {
            "player_id": player_id,
            "nickname": nickname,
            "player_count": len(session.roster),
        },
        topic=pin,
    )
    return _join_response(session, player_id, player_token)


def _join_response(
    session: SessionState,
    player_id: str,
    player_token: str,
    reconnected: bool = False,
) -> JoinResponse:
    answer = session.answers.get(player_id)
    submitted_answer = None
    if answer is not None and session.current_question_index is not None:
        submitted_answer = SubmittedAnswer(
            question_index=session.current_question_index,
            option_index=answer["option_index"],
        )
    return JoinResponse(
        player_id=player_id,
        player_token=player_token,
        nickname=session.roster[player_id],
        reconnected=reconnected,
        current_question_index=session.current_question_index,
        submitted_answer=submitted_answer,
    )


@router.get("/sessions/{pin}/events")
async def session_events(request: Request, pin: str = PinPath):
    # The one endpoint without token auth: the browser's native `EventSource`
    # cannot send custom headers, and putting a secret in the query string
    # would leak it into access logs. Knowing the `pin` is therefore what
    # grants the stream -- acceptable because every event published here is
    # broadcast to all participants anyway (SPEC.md §7).
    _get_session_by_pin(pin)  # 404s if unknown
    return quiz_events.streaming_response(request, topic=pin, keep_alive_timeout=20)


@router.post("/sessions/{pin}/advance")
async def advance_session(
    pin: str = PinPath,
    body: AdvanceRequest = ...,
    host_token: str | None = HostTokenHeader,
):
    session = _get_session_by_pin(pin)
    _require_host(session, host_token)

    if body.event_type == "question_started":
        session.current_question_index = body.data.get("question_index")
        session.answers = {}
        session.tally = {}
    elif body.event_type == "session_finished":
        _sessions_by_pin.pop(session.pin, None)
        async with engine.begin() as conn:
            await conn.execute(
                sa.delete(math_quiz_quiz_table).where(
                    math_quiz_quiz_table.c.pin == session.pin
                )
            )

    quiz_events.publish(body.event_type, body.data, topic=session.pin)
    return {"ok": True}


@router.post("/sessions/{pin}/answers")
async def submit_answer(
    pin: str = PinPath,
    body: AnswerRequest = ...,
    player_token: str | None = PlayerTokenHeader,
):
    session = _get_session_by_pin(pin)
    player_id = _require_player(session, player_token)

    if body.question_index != session.current_question_index:
        raise HTTPException(status_code=409, detail="No active question with that index")
    if player_id in session.answers:
        raise HTTPException(status_code=409, detail="Answer already submitted")

    submitted_at = datetime.now(timezone.utc).isoformat()
    session.answers[player_id] = {
        "option_index": body.option_index,
        "submitted_at": submitted_at,
    }
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
            "player_id": player_id,
            "option_index": body.option_index,
            "submitted_at": submitted_at,
        },
        topic=pin,
    )
    return {"ok": True}


@router.get("/sessions/{pin}/state")
async def session_state(
    pin: str = PinPath,
    host_token: str | None = HostTokenHeader,
    player_token: str | None = PlayerTokenHeader,
):
    session = _get_session_by_pin(pin)
    _require_participant(session, host_token, player_token)
    return {
        "pin": session.pin,
        "players": [
            {"player_id": pid, "nickname": nickname}
            for pid, nickname in session.roster.items()
        ],
        "current_question_index": session.current_question_index,
        "tally": session.tally,
        # Per-player attribution (already public via `answer_count_update`)
        # so a reloaded host can rebuild the answer map it needs to score
        # the current question.
        "answers": session.answers,
    }
