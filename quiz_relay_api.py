"""Math Quiz relay backend: an ephemeral, stateless message relay.

See SPEC.md (Appendix A). The host's browser owns the entire application
state; this service is a transport and nothing else. It never parses a
payload, never learns what a question or an answer is, and -- deliberately --
keeps no state at all:

  - identifiers are minted, not stored: every token is an HMAC of a server
    secret, so it can be verified after the process has forgotten everything,
  - the two per-session topics exist only as long as someone is subscribed.

The single exception is the set of pins currently in use, kept only so two
concurrent hosts cannot be handed the same one. It is a live-pin reservation,
not session state: a host releases its pin when the quiz finishes, and a
restart or scale-to-zero purges whatever was left dangling.

Because of that, a restart or a scale-to-zero cold start needs no recovery
endpoint. Participants reconnect, the host's next state broadcast arrives,
and everyone is up to date again.

Reliability comes from idempotent state transfer rather than message
durability: the host re-broadcasts a full snapshot on every change and every
few seconds regardless, and players re-send a message until they observe its
effect in a snapshot. A dropped message therefore costs latency, never
correctness -- which is why there is no replay log and no `Last-Event-ID`
handling here.

Each session has two streams:

  - `state_stream`   host -> all players.  Public: knowing the pin is what
                     grants access, because the browser's native EventSource
                     cannot send an auth header and a token in the query
                     string would leak into access logs.
  - `message_stream` players -> host.      Host only, so one player can never
                     read another's messages. The host reads it with `fetch`
                     + ReadableStream, which *can* send a header.

Everything is mounted under `/api/v1`, except the `/` health check.
"""

import asyncio
import base64
import collections
import hashlib
import hmac
import json
import os
import secrets
from typing import Any, AsyncIterator

from fastapi import APIRouter, FastAPI, Header, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

API_PREFIX = "/api/v1"

PIN_ALPHABET = "0123456789"
PIN_LENGTH = 6
PIN_PATTERN = r"^\d{6}$"

# urlsafe-b64 of a SHA-256 digest, minus padding.
_SIGNATURE_LENGTH = 43
HOST_TOKEN_PATTERN = rf"^[A-Za-z0-9_-]{{{_SIGNATURE_LENGTH}}}$"
# `<player_id>.<signature>` -- self-contained, so the server can recover the
# player's identity from the token alone without having stored anything.
PLAYER_TOKEN_PATTERN = rf"^[A-Za-z0-9_-]{{12}}\.[A-Za-z0-9_-]{{{_SIGNATURE_LENGTH}}}$"

HOST_TOKEN_HEADER = "X-Host-Token"
PLAYER_TOKEN_HEADER = "X-Player-Token"

KEEP_ALIVE_SECONDS = 20
# One slot is enough for the state stream (only the newest snapshot matters)
# but the host inbox can legitimately burst when 25 players answer at once.
QUEUE_SIZE = 50

PinPath = Path(pattern=PIN_PATTERN)
HostTokenHeader = Header(
    default=None, alias=HOST_TOKEN_HEADER, pattern=HOST_TOKEN_PATTERN
)
PlayerTokenHeader = Header(
    default=None, alias=PLAYER_TOKEN_HEADER, pattern=PLAYER_TOKEN_PATTERN
)


# Tokens

# Without a fixed secret every token minted before a restart stops verifying.
# That is the right behaviour for local dev and tests; production sets the
# env var so a cold-started replica still recognises a running session.
_secret = os.environ.get("SERVER_SECRET")
SERVER_SECRET = _secret.encode() if _secret else secrets.token_bytes(32)


def _sign(message: str) -> str:
    digest = hmac.new(SERVER_SECRET, message.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _host_token(pin: str) -> str:
    return _sign(f"{pin}:host")


def _player_token(pin: str, player_id: str) -> str:
    return f"{player_id}.{_sign(f'{pin}:player:{player_id}')}"


def _require_host(pin: str, token: str | None) -> None:
    if token is None or not hmac.compare_digest(token, _host_token(pin)):
        raise HTTPException(status_code=403, detail="Invalid or missing host token")


def _require_player(pin: str, token: str | None) -> str:
    """Return the authenticated player's id, taken from the token rather than
    the body so nobody can send a message as someone else."""
    if token is None:
        raise HTTPException(status_code=403, detail="Invalid or missing player token")
    player_id = token.partition(".")[0]
    if not hmac.compare_digest(token, _player_token(pin, player_id)):
        raise HTTPException(status_code=403, detail="Invalid or missing player token")
    return player_id


# Fan-out


def _format_sse(event: str, data: Any) -> bytes:
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n".encode()


class Fanout:
    """Per-topic fan-out to currently connected subscribers.

    Holds no history: a subscriber that was not connected when something was
    published has simply missed it, and recovers through the next snapshot.
    """

    def __init__(self) -> None:
        self._queues: dict[str, set[asyncio.Queue[bytes]]] = collections.defaultdict(set)

    def publish(self, topic: str, event: str, data: Any) -> None:
        frame = _format_sse(event, data)
        for queue in self._queues.get(topic, ()):
            if queue.full():
                # Newest wins. Discarding the oldest frame is safe in both
                # directions: a stale snapshot is superseded by the next one,
                # and an unseen player message gets re-sent. Dropping the
                # *subscriber* instead would silently kill the stream.
                queue.get_nowait()
            queue.put_nowait(frame)

    async def subscribe(self, topic: str) -> AsyncIterator[bytes]:
        queue: asyncio.Queue[bytes] = asyncio.Queue(QUEUE_SIZE)
        self._queues[topic].add(queue)
        try:
            while True:
                try:
                    yield await asyncio.wait_for(queue.get(), KEEP_ALIVE_SECONDS)
                except asyncio.TimeoutError:
                    yield b": keep-alive\n\n"
        finally:
            subscribers = self._queues[topic]
            subscribers.discard(queue)
            if not subscribers:
                del self._queues[topic]

    def stream(self, topic: str) -> StreamingResponse:
        return StreamingResponse(
            self.subscribe(topic),
            media_type="text/event-stream",
            # Without these an intermediate proxy may buffer the stream and
            # deliver events in batches, or not at all.
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )


fanout = Fanout()

# Pins handed out and not yet released. Purely a collision guard, so a
# forgotten entry (host tab closed without finishing) costs nothing but one
# unusable pin until the next restart.
live_pins: set[str] = set()


def _state_topic(pin: str) -> str:
    return f"{pin}:state"


def _message_topic(pin: str) -> str:
    return f"{pin}:message"


# Request/response models


class CreateSessionResponse(BaseModel):
    pin: str
    host_token: str


class JoinSessionResponse(BaseModel):
    player_id: str
    player_token: str


# App

# Only the deployed frontend is allowed to call the relay from a browser,
# plus the local Vite dev/preview origins so a checkout can talk to a running
# relay. `ALLOWED_ORIGINS` (comma-separated) replaces the list entirely, e.g.
# for a staging deployment.
FRONTEND_ORIGIN = "https://quiz.smlz.ch"
DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
_allowed_origins = os.environ.get("ALLOWED_ORIGINS")
ALLOWED_ORIGINS = (
    [origin.strip() for origin in _allowed_origins.split(",") if origin.strip()]
    if _allowed_origins
    else [FRONTEND_ORIGIN, *DEV_ORIGINS]
)

app = FastAPI(title="Quiz Relay API")
# No cookies or HTTP auth travel with a request -- identity is a token in a
# custom header -- so credentialed cross-origin requests stay disallowed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=[HOST_TOKEN_HEADER, PLAYER_TOKEN_HEADER, "Content-Type"],
)

router = APIRouter(prefix=API_PREFIX)


@app.get("/")
async def health():
    return {"ok": True}


@router.post("/session", response_model=CreateSessionResponse)
async def create_session():
    while True:
        pin = "".join(secrets.choice(PIN_ALPHABET) for _ in range(PIN_LENGTH))
        if pin not in live_pins:
            break
    live_pins.add(pin)
    return CreateSessionResponse(pin=pin, host_token=_host_token(pin))


@router.delete("/session/{pin}")
async def end_session(
    pin: str = PinPath,
    host_token: str | None = HostTokenHeader,
):
    _require_host(pin, host_token)
    live_pins.discard(pin)
    return {"ok": True}


@router.post("/session/{pin}", response_model=JoinSessionResponse)
async def join_session(pin: str = PinPath):
    # No nickname: that is application data, so the player sends it to the
    # host as an ordinary message and learns it arrived by finding itself in
    # the next state snapshot -- the same loop every other message uses.
    player_id = secrets.token_urlsafe(9)
    return JoinSessionResponse(
        player_id=player_id, player_token=_player_token(pin, player_id)
    )


@router.get("/session/{pin}/state_stream")
async def state_stream(pin: str = PinPath):
    return fanout.stream(_state_topic(pin))


@router.get("/session/{pin}/message_stream")
async def message_stream(
    pin: str = PinPath,
    host_token: str | None = HostTokenHeader,
):
    _require_host(pin, host_token)
    return fanout.stream(_message_topic(pin))


@router.post("/session/{pin}/state")
async def publish_state(
    pin: str = PinPath,
    body: dict[str, Any] = ...,
    host_token: str | None = HostTokenHeader,
):
    _require_host(pin, host_token)
    fanout.publish(_state_topic(pin), "state", body)
    return {"ok": True}


@router.post("/session/{pin}/message")
async def publish_message(
    pin: str = PinPath,
    body: dict[str, Any] = ...,
    player_token: str | None = PlayerTokenHeader,
):
    player_id = _require_player(pin, player_token)
    fanout.publish(
        _message_topic(pin), "message", {"player_id": player_id, "payload": body}
    )
    return {"ok": True}


app.include_router(router)
