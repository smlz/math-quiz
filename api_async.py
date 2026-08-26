"""Async re-implementation of api.py using FastAPI + SQLAlchemy (asyncio).

Functionally equivalent to api.py for API consumers (same routes, same
JSON response shapes), but built on an async stack instead of wau/werkzeug:

 - FastAPI (ASGI) instead of wau.API (WSGI)
 - SQLAlchemy async engine (asyncpg for Postgres, aiosqlite for local dev)
   instead of dataset
 - A small asyncio-native pub/sub for Server-Sent Events instead of
   wau.PubSub (which blocks on a thread-safe queue.Queue and would stall
   the event loop if used directly from async code)

Meant to run as a single worker / single event loop process (see Procfile),
relying on cooperative concurrency instead of a thread pool.
"""

import asyncio
import collections
import contextlib
import itertools
import json
import os
import secrets
from datetime import datetime, timezone
from typing import Literal, NamedTuple

import sqlalchemy as sa
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import create_async_engine

# Database
# Heroku sets DATABASE_URL with the legacy "postgres://" scheme and no async
# driver; SQLAlchemy's asyncpg dialect requires "postgresql+asyncpg://".
# Locally (no DATABASE_URL set) fall back to a SQLite file, using aiosqlite.
_db_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///messenger.db")
_db_url = _db_url.replace("postgres://", "postgresql+asyncpg://", 1)

engine = create_async_engine(_db_url)
metadata = sa.MetaData()

user_table = sa.Table(
    "user",
    metadata,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("name", sa.Text),
)

message_table = sa.Table(
    "message",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("sender", sa.Text),
    sa.Column("recipient", sa.Text),
    sa.Column("kind", sa.Text),
    sa.Column("content", sa.Text),
    sa.Column("created", sa.DateTime(timezone=True)),
)

ID_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"


async def random_id(length=6):
    """Return a short, random, unique user id (tinyurl style)."""
    while True:
        candidate = "".join(secrets.choice(ID_ALPHABET) for _ in range(length))
        async with engine.connect() as conn:
            result = await conn.execute(
                sa.select(user_table.c.id).where(user_table.c.id == candidate)
            )
            if result.first() is None:
                return candidate


# Real-time events


class Event(NamedTuple):
    id: int
    event_type: str
    data: object


class _TimeOut:
    pass


class AsyncPubSub:
    """Asyncio-native publish/subscribe scheme for Server-Sent Events.

    Reimplements the semantics of wau.PubSub, but using asyncio.Queue
    instead of queue.Queue, so subscribing never blocks the event loop.
    """

    def __init__(self):
        self._queues = collections.defaultdict(set)
        self._replay_log = collections.defaultdict(
            lambda: collections.deque(maxlen=1_000)
        )
        self._current_id = itertools.count()

    def publish(self, event_type, data, topic=None):
        """Publish an event, optionally scoped to a topic."""
        id = next(self._current_id)
        event = Event(id, event_type, data)

        self._replay_log[topic].append(event)

        to_remove = []
        for q in self._queues[topic]:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:  # Somebody fell asleep?!?
                to_remove.append(q)
        for q in to_remove:
            self._queues[topic].discard(q)

    async def subscribe(self, topic=None, timeout=None):
        """Async-iterate over published events for a topic."""
        q = asyncio.Queue(100)
        self._queues[topic].add(q)
        try:
            while True:
                try:
                    if timeout is None:
                        yield await q.get()
                    else:
                        yield await asyncio.wait_for(q.get(), timeout=timeout)
                except asyncio.TimeoutError:
                    yield _TimeOut
        finally:
            self._queues[topic].discard(q)

    def _replay_events(self, last_id, topic=None):
        if last_id is None:
            return ()

        last_id = int(last_id)
        replay_log = self._replay_log[topic]

        log_iter = iter(replay_log)
        for event in log_iter:
            if event.id == last_id:
                break
        else:
            raise ValueError(f"{last_id} is not in event log")
        return list(log_iter)

    @staticmethod
    def _format_event(event):
        data = json.dumps(jsonable_encoder(event.data))
        return (
            f"id: {event.id}\n"
            f"event: {event.event_type}\n"
            f"data: {data}\n\n"
        ).encode("utf-8")

    async def _event_stream(self, replay_events, topic, keep_alive_timeout):
        for event in replay_events:
            yield self._format_event(event)

        async for event in self.subscribe(topic, timeout=keep_alive_timeout):
            if event is _TimeOut:
                yield b": keep-alive\n\n"
            else:
                yield self._format_event(event)

    def streaming_response(self, request: Request, topic=None, keep_alive_timeout=None):
        """Build a StreamingResponse of Server-Sent Events for `topic`."""
        last_id = request.headers.get("Last-Event-ID")
        try:
            replay_events = self._replay_events(last_id, topic)
        except ValueError:
            raise HTTPException(status_code=404)

        return StreamingResponse(
            self._event_stream(replay_events, topic, keep_alive_timeout),
            media_type="text/event-stream",
        )


events = AsyncPubSub()


class LenientJSONContentTypeMiddleware:
    """Treat request bodies without an `application/json` Content-Type as
    JSON anyway, when the header is missing or set to `text/plain`.

    Browsers' `fetch()` sends `Content-Type: text/plain;charset=UTF-8` by
    default for a plain string body unless the caller sets the header
    explicitly, which would otherwise stop FastAPI from parsing it as JSON.
    This middleware rewrites the header before routing/body-parsing happens,
    so the rest of the app can rely on FastAPI's normal JSON body parsing.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = list(scope["headers"])
            for index, (key, value) in enumerate(headers):
                if key == b"content-type":
                    content_type = value.split(b";")[0].strip().lower()
                    if content_type in (b"", b"text/plain"):
                        headers[index] = (key, b"application/json")
                    break
            else:
                headers.append((b"content-type", b"application/json"))
            scope = {**scope, "headers": headers}
        await self.app(scope, receive, send)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(LenientJSONContentTypeMiddleware)

# Math Quiz app, mounted under /api/math-quiz/v1 (see SPEC.md); imported
# after `engine`/`metadata`/`AsyncPubSub` are defined above, which it needs.
from math_quiz import router as math_quiz_router  # noqa: E402

app.include_router(math_quiz_router)


class UserCreate(BaseModel):
    name: str


class MessageCreate(BaseModel):
    sender: str
    recipient: str
    content: str
    kind: Literal["plain", "encrypted", "dh"] = "plain"


@app.get("/")
async def hello():
    return "Hello, World!"


@app.post("/users")
async def register(user: UserCreate):
    new_user = {"id": await random_id(), "name": user.name}
    async with engine.begin() as conn:
        await conn.execute(sa.insert(user_table).values(**new_user))
    return new_user


@app.get("/users/{id}")
async def get_user(id: str):
    async with engine.connect() as conn:
        result = await conn.execute(sa.select(user_table).where(user_table.c.id == id))
        row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No user with id '{id}'")
    return dict(row)


@app.post("/messages")
async def send_message(message: MessageCreate):
    new_message = {
        "sender": message.sender,
        "recipient": message.recipient,
        "kind": message.kind,
        "content": message.content,
        "created": datetime.now(timezone.utc),
    }
    async with engine.begin() as conn:
        result = await conn.execute(sa.insert(message_table).values(**new_message))
        new_message["id"] = result.inserted_primary_key[0]

    events.publish("message", new_message, topic=new_message["recipient"])
    if new_message["sender"] != new_message["recipient"]:
        events.publish("message", new_message, topic=new_message["sender"])
    return new_message


@app.get("/messages/{user_id}")
async def history(user_id: str):
    async with engine.connect() as conn:
        result = await conn.execute(
            sa.text(
                "SELECT * FROM message WHERE sender = :u OR recipient = :u "
                "ORDER BY id"
            ),
            {"u": user_id},
        )
        rows = result.mappings().all()
    return [dict(row) for row in rows]


@app.get("/events/{user_id}")
async def stream(request: Request, user_id: str):
    return events.streaming_response(request, topic=user_id, keep_alive_timeout=20)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=3000)
