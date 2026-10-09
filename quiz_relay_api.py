"""Math Quiz relay backend: an ephemeral, stateless message relay.

See SPEC.md (Appendix A). The host's browser owns the entire application
state; this service is a transport and nothing else. It never parses a
payload, never learns what a question or an answer is, and -- deliberately --
keeps no state at all:

  - identifiers are minted, not stored: every token is an HMAC of a server
    secret, so it can be verified after the process has forgotten everything,
  - the two per-session topics exist only as long as someone is subscribed.

The single exception is the map of pins currently in use to the session that
holds them. It keeps two concurrent hosts from being handed the same pin, and
it is what stops a host token from outliving its session: pins are only six
digits and get reused, so a token signed over the pin alone would also unlock
every later session that draws the same pin. A host releases its pin when the
quiz finishes, and a restart or scale-to-zero purges whatever was left
dangling -- the first valid host token seen for a pin afterwards claims it
again (see `_require_host`).

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
import pathlib
import secrets
import time
import tomllib
from typing import Any, AsyncIterator

from fastapi import APIRouter, FastAPI, Header, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.types import ASGIApp, Message, Receive, Scope, Send

API_PREFIX = "/api/v1"

PIN_ALPHABET = "0123456789"
PIN_LENGTH = 6
PIN_PATTERN = r"^\d{6}$"
# Far below the 10^6 pins there are, so a free pin is almost always found on
# the first draw and the live-session map stays small. Past the cap -- or if a
# free pin is not found within a bounded number of draws -- creating a session
# fails with 503 instead of spinning on the event loop, which would stall
# every running session along with it.
MAX_LIVE_SESSIONS = 100_000
MAX_PIN_DRAWS = 50

# urlsafe-b64 of a SHA-256 digest, minus padding.
_SIGNATURE_LENGTH = 43
# `<session_id>.<expires>.<signature>` -- the random session id is what
# tells two sessions on the same pin apart; the expiry (unix seconds) bounds
# how long a token is any use at all, generously enough for a whole school day.
HOST_TOKEN_PATTERN = rf"^[A-Za-z0-9_-]{{12}}\.\d{{1,12}}\.[A-Za-z0-9_-]{{{_SIGNATURE_LENGTH}}}$"
SESSION_TTL_SECONDS = 24 * 60 * 60
# `<player_id>.<signature>` -- self-contained, so the server can recover the
# player's identity from the token alone without having stored anything.
PLAYER_TOKEN_PATTERN = rf"^[A-Za-z0-9_-]{{12}}\.[A-Za-z0-9_-]{{{_SIGNATURE_LENGTH}}}$"

HOST_TOKEN_HEADER = "X-Host-Token"
PLAYER_TOKEN_HEADER = "X-Player-Token"

# Snapshots and player messages are a few hundred bytes; this still fits a
# snapshot listing thousands of players. Anything bigger is abuse, and every
# frame is held in up to QUEUE_SIZE slots per topic.
MAX_BODY_BYTES = 64 * 1024

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


def _host_token(pin: str, session_id: str, expires: int) -> str:
    return f"{session_id}.{expires}.{_sign(f'{pin}:host:{session_id}:{expires}')}"


def _player_token(pin: str, player_id: str) -> str:
    return f"{player_id}.{_sign(f'{pin}:player:{player_id}')}"


def _require_host(pin: str, token: str | None) -> None:
    """Accept only a validly signed, unexpired token of the session that
    currently holds `pin`.

    A pin with no live session (after a restart, or once released) is claimed
    by the first valid token that shows up: that is how a running quiz
    survives a cold start. The residual risk -- a still-unexpired token of an
    *earlier* session on the same pin racing the real host right after a
    restart -- is bounded by `SESSION_TTL_SECONDS`.
    """
    if token is None:
        raise HTTPException(status_code=403, detail="Invalid or missing host token")
    session_id, expires, _ = token.split(".")
    now = time.time()
    if (
        not hmac.compare_digest(token, _host_token(pin, session_id, int(expires)))
        or int(expires) <= now
    ):
        raise HTTPException(status_code=403, detail="Invalid or missing host token")
    current = live_sessions.get(pin)
    if current is None or current[1] <= now:
        live_sessions.pop(pin, None)
        live_sessions[pin] = (session_id, int(expires))
    elif current[0] != session_id:
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

    def has_subscribers(self, topic: str) -> bool:
        return topic in self._queues

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

# Pin -> (session_id, expires) for every pin handed out and not yet released.
# A forgotten entry (host tab closed without finishing) costs nothing but one
# unusable pin until it expires or the process restarts.
live_sessions: dict[str, tuple[str, int]] = {}


def _state_topic(pin: str) -> str:
    return f"{pin}:state"


def _message_topic(pin: str) -> str:
    return f"{pin}:message"


def _purge_expired(now: float) -> None:
    """Drop expired reservations from the front of the map. Entries are
    inserted in (nearly) expiry order, so this is amortised O(1); the rare
    straggler behind a younger entry is still treated as free by
    `_pin_in_use` and only lingers until the purge reaches it."""
    while live_sessions:
        pin, (_, expires) = next(iter(live_sessions.items()))
        if expires > now:
            return
        del live_sessions[pin]


def _pin_in_use(pin: str, now: float) -> bool:
    """A pin is taken while a session holds it -- or while anyone is still
    connected to it, which after a restart is the only trace left of a quiz
    whose host has not reconnected yet."""
    current = live_sessions.get(pin)
    return (
        (current is not None and current[1] > now)
        or fanout.has_subscribers(_state_topic(pin))
        or fanout.has_subscribers(_message_topic(pin))
    )


# Request/response models


class CreateSessionResponse(BaseModel):
    pin: str
    host_token: str


class JoinSessionResponse(BaseModel):
    player_id: str
    player_token: str


# App


class BodySizeLimitMiddleware:
    """Reject request bodies over `max_bytes` with 413 before they are
    buffered: up front from `Content-Length`, and while streaming for a
    chunked body that does not announce its size."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_length = dict(scope["headers"]).get(b"content-length", b"")
        if content_length.isdigit() and int(content_length) > self.max_bytes:
            await JSONResponse(
                {"detail": "Request body too large"}, status_code=413
            )(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # FastAPI re-raises an HTTPException from body parsing.
                    raise HTTPException(status_code=413, detail="Request body too large")
            return message

        await self.app(scope, limited_receive, send)

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

# The project is not installed as a package (`[tool.uv] package = false`), so
# importlib.metadata has nothing to report -- pyproject.toml is read directly.
with open(pathlib.Path(__file__).with_name("pyproject.toml"), "rb") as _pyproject:
    __version__ = tomllib.load(_pyproject)["project"]["version"]

# AGPL §13: users interacting with the relay over a network get a way to the
# source. A modified deployment must point this at its own source.
SOURCE_URL = "https://github.com/smlz/math-quiz"

app = FastAPI(
    title="Quiz Relay API",
    version=__version__,
    description=f"Source code: <{SOURCE_URL}>",
    license_info={"name": "AGPL-3.0-or-later", "identifier": "AGPL-3.0-or-later"},
)
# Added before CORS so CORS wraps it and a 413 still reaches the browser.
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_BODY_BYTES)
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
    return {"ok": True, "source": SOURCE_URL}


@router.post("/session", response_model=CreateSessionResponse)
async def create_session():
    now = time.time()
    _purge_expired(now)
    if len(live_sessions) >= MAX_LIVE_SESSIONS:
        raise HTTPException(status_code=503, detail="Too many live sessions")
    for _ in range(MAX_PIN_DRAWS):
        pin = "".join(secrets.choice(PIN_ALPHABET) for _ in range(PIN_LENGTH))
        if not _pin_in_use(pin, now):
            break
    else:
        raise HTTPException(status_code=503, detail="No free pin")
    session_id = secrets.token_urlsafe(9)
    expires = int(now) + SESSION_TTL_SECONDS
    live_sessions.pop(pin, None)
    live_sessions[pin] = (session_id, expires)
    return CreateSessionResponse(
        pin=pin, host_token=_host_token(pin, session_id, expires)
    )


@router.delete("/session/{pin}")
async def end_session(
    pin: str = PinPath,
    host_token: str | None = HostTokenHeader,
):
    _require_host(pin, host_token)
    live_sessions.pop(pin, None)
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
