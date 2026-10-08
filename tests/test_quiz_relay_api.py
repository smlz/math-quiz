"""Tests for the stateless relay backend (quiz_relay_api.py)."""

import asyncio
import contextlib
import re
import time

import pytest
from httpx import ASGITransport, AsyncClient

import quiz_relay_api as relay


@pytest.fixture(autouse=True)
def _forget_live_sessions():
    # The live-session map is the relay's only module-level state; without
    # this, pins handed out by one test would leak into the next.
    relay.live_sessions.clear()
    yield
    relay.live_sessions.clear()


@pytest.fixture
async def client():
    # Base URL carries the API prefix so the paths below stay readable.
    transport = ASGITransport(app=relay.app)
    async with AsyncClient(transport=transport, base_url=f"http://test{relay.API_PREFIX}") as ac:
        yield ac


async def _create_session(client):
    response = await client.post("/session")
    assert response.status_code == 200
    return response.json()


async def _join(client, pin):
    response = await client.post(f"/session/{pin}")
    assert response.status_code == 200
    return response.json()


async def _start_subscriber(topic):
    """Subscribe and wait until the queue is actually registered.

    `subscribe` only registers on first iteration, so publishing before that
    would be a genuine (but here unintended) miss.
    """
    stream = relay.fanout.subscribe(topic)
    task = asyncio.create_task(stream.__anext__())
    for _ in range(100):
        await asyncio.sleep(0)
        if relay.fanout._queues.get(topic):
            return stream, task
    raise AssertionError(f"subscriber for {topic!r} never registered")


async def _stop_subscriber(stream, task):
    # The generator cannot be closed while a pending `__anext__` is still
    # running, so the cancellation has to be awaited first.
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    await stream.aclose()


def _mint_host_token(pin, session_id="aaaaaaaaaaaa", ttl=relay.SESSION_TTL_SECONDS):
    """A host token the relay never handed out, as after a restart."""
    return relay._host_token(pin, session_id, int(time.time()) + ttl)


def _parse_sse(frame: bytes) -> tuple[str, str]:
    match = re.fullmatch(r"event: (.+)\ndata: (.+)\n\n", frame.decode())
    assert match, f"not an SSE data frame: {frame!r}"
    return match.group(1), match.group(2)


# Minting


async def test_create_session_returns_pin_and_host_token(client):
    session = await _create_session(client)
    assert re.fullmatch(r"\d{6}", session["pin"])
    assert re.fullmatch(relay.HOST_TOKEN_PATTERN, session["host_token"])


async def test_create_session_returns_a_different_pin_each_time(client):
    pins = {(await _create_session(client))["pin"] for _ in range(20)}
    assert len(pins) > 1


async def test_join_returns_player_id_and_matching_token(client):
    session = await _create_session(client)
    player = await _join(client, session["pin"])
    assert re.fullmatch(relay.PLAYER_TOKEN_PATTERN, player["player_token"])
    assert player["player_token"].startswith(f"{player['player_id']}.")


async def test_join_rejects_malformed_pin(client):
    assert (await client.post("/session/12345")).status_code == 422
    assert (await client.post("/session/abcdef")).status_code == 422


async def test_create_session_redraws_a_pin_that_is_already_live(client, monkeypatch):
    digits = iter("111111" + "222222")
    monkeypatch.setattr(relay.secrets, "choice", lambda _alphabet: next(digits))
    relay.live_sessions["111111"] = ("aaaaaaaaaaaa", int(time.time()) + 60)

    assert (await _create_session(client))["pin"] == "222222"


async def test_end_session_releases_the_pin(client):
    session = await _create_session(client)
    assert session["pin"] in relay.live_sessions

    response = await client.delete(
        f"/session/{session['pin']}",
        headers={relay.HOST_TOKEN_HEADER: session["host_token"]},
    )
    assert response.status_code == 200
    assert session["pin"] not in relay.live_sessions


async def test_end_session_requires_the_host_token(client):
    session = await _create_session(client)

    assert (await client.delete(f"/session/{session['pin']}")).status_code == 403
    assert session["pin"] in relay.live_sessions


# Statelessness


async def test_relay_accepts_a_session_it_never_minted(client):
    # Proves the cold-start story: a valid token is the only thing needed,
    # so a restarted replica keeps serving a session it has no record of.
    pin = "424242"
    response = await client.post(
        f"/session/{pin}/state",
        json={"phase": "lobby"},
        headers={relay.HOST_TOKEN_HEADER: _mint_host_token(pin)},
    )
    assert response.status_code == 200


async def test_no_subscribers_leaves_no_topics_behind(client):
    session = await _create_session(client)
    await client.post(
        f"/session/{session['pin']}/state",
        json={"phase": "lobby"},
        headers={relay.HOST_TOKEN_HEADER: session["host_token"]},
    )
    assert relay.fanout._queues == {}


# Authorisation


async def test_publish_state_requires_the_host_token(client):
    session = await _create_session(client)
    path = f"/session/{session['pin']}/state"

    assert (await client.post(path, json={})).status_code == 403
    assert (
        await client.post(
            path, json={}, headers={relay.HOST_TOKEN_HEADER: _mint_host_token("000000")}
        )
    ).status_code == 403
    assert (
        await client.post(path, json={}, headers={relay.HOST_TOKEN_HEADER: "nope"})
    ).status_code == 422


async def test_message_stream_requires_the_host_token(client):
    session = await _create_session(client)
    player = await _join(client, session["pin"])
    path = f"/session/{session['pin']}/message_stream"

    assert (await client.get(path)).status_code == 403
    # A player must not be able to read what other players send.
    assert (
        await client.get(path, headers={relay.HOST_TOKEN_HEADER: _mint_host_token("000000")})
    ).status_code == 403
    assert player["player_token"] not in session["host_token"]


async def test_host_token_of_an_earlier_session_on_the_same_pin_is_rejected(
    client, monkeypatch
):
    # Pins are reused, so a token must not unlock a later session that
    # happens to draw the same pin -- otherwise anyone could harvest host
    # tokens for every pin just by creating and releasing sessions.
    monkeypatch.setattr(relay.secrets, "choice", lambda _alphabet: "7")
    earlier = await _create_session(client)
    await client.delete(
        f"/session/{earlier['pin']}",
        headers={relay.HOST_TOKEN_HEADER: earlier["host_token"]},
    )
    later = await _create_session(client)
    assert later["pin"] == earlier["pin"]
    assert later["host_token"] != earlier["host_token"]

    path = f"/session/{later['pin']}/state"
    stale = {relay.HOST_TOKEN_HEADER: earlier["host_token"]}
    assert (await client.post(path, json={}, headers=stale)).status_code == 403
    assert (
        await client.get(f"/session/{later['pin']}/message_stream", headers=stale)
    ).status_code == 403
    current = {relay.HOST_TOKEN_HEADER: later["host_token"]}
    assert (await client.post(path, json={}, headers=current)).status_code == 200


async def test_expired_host_token_is_rejected(client):
    response = await client.post(
        "/session/424242/state",
        json={},
        headers={relay.HOST_TOKEN_HEADER: _mint_host_token("424242", ttl=-1)},
    )
    assert response.status_code == 403


async def test_tampered_host_token_expiry_is_rejected(client):
    session = await _create_session(client)
    session_id, expires, signature = session["host_token"].split(".")
    extended = f"{session_id}.{int(expires) + 1}.{signature}"

    response = await client.post(
        f"/session/{session['pin']}/state",
        json={},
        headers={relay.HOST_TOKEN_HEADER: extended},
    )
    assert response.status_code == 403


async def test_after_a_restart_the_first_valid_host_token_claims_the_pin(client):
    pin = "424242"
    first = {relay.HOST_TOKEN_HEADER: _mint_host_token(pin, "aaaaaaaaaaaa")}
    other = {relay.HOST_TOKEN_HEADER: _mint_host_token(pin, "bbbbbbbbbbbb")}

    assert (await client.post(f"/session/{pin}/state", json={}, headers=first)).status_code == 200
    assert (await client.post(f"/session/{pin}/state", json={}, headers=other)).status_code == 403


async def test_create_session_skips_a_pin_someone_is_still_connected_to(
    client, monkeypatch
):
    # After a restart the live-session map is empty, but a quiz whose host
    # has not reconnected yet still has players listening on its pin.
    stream, task = await _start_subscriber(relay._state_topic("111111"))
    try:
        digits = iter("111111" + "222222")
        monkeypatch.setattr(relay.secrets, "choice", lambda _alphabet: next(digits))
        assert (await _create_session(client))["pin"] == "222222"
    finally:
        await _stop_subscriber(stream, task)


async def test_publish_message_requires_the_player_token(client):
    session = await _create_session(client)
    path = f"/session/{session['pin']}/message"

    assert (await client.post(path, json={})).status_code == 403
    assert (
        await client.post(path, json={}, headers={relay.PLAYER_TOKEN_HEADER: "nope"})
    ).status_code == 422


async def test_player_token_is_bound_to_its_session(client):
    other = await _create_session(client)
    session = await _create_session(client)
    player = await _join(client, other["pin"])

    response = await client.post(
        f"/session/{session['pin']}/message",
        json={"answer": 2},
        headers={relay.PLAYER_TOKEN_HEADER: player["player_token"]},
    )
    assert response.status_code == 403


async def test_player_cannot_forge_another_players_id(client):
    session = await _create_session(client)
    player = await _join(client, session["pin"])
    forged = "aaaaaaaaaaaa." + player["player_token"].partition(".")[2]

    response = await client.post(
        f"/session/{session['pin']}/message",
        json={},
        headers={relay.PLAYER_TOKEN_HEADER: forged},
    )
    assert response.status_code == 403


# Relaying


async def test_state_reaches_players(client):
    session = await _create_session(client)
    stream, task = await _start_subscriber(relay._state_topic(session["pin"]))
    try:
        await client.post(
            f"/session/{session['pin']}/state",
            json={"phase": "question", "index": 1},
            headers={relay.HOST_TOKEN_HEADER: session["host_token"]},
        )
        event, data = _parse_sse(await asyncio.wait_for(task, 1))
        assert event == "state"
        assert data == '{"phase":"question","index":1}'
    finally:
        await _stop_subscriber(stream, task)


async def test_message_reaches_the_host_tagged_with_the_sender(client):
    session = await _create_session(client)
    player = await _join(client, session["pin"])
    stream, task = await _start_subscriber(relay._message_topic(session["pin"]))
    try:
        await client.post(
            f"/session/{session['pin']}/message",
            json={"answer": 2},
            headers={relay.PLAYER_TOKEN_HEADER: player["player_token"]},
        )
        event, data = _parse_sse(await asyncio.wait_for(task, 1))
        assert event == "message"
        assert data == (
            '{"player_id":"%s","payload":{"answer":2}}' % player["player_id"]
        )
    finally:
        await _stop_subscriber(stream, task)


async def test_the_two_streams_are_separate(client):
    session = await _create_session(client)
    player = await _join(client, session["pin"])
    stream, task = await _start_subscriber(relay._state_topic(session["pin"]))
    try:
        await client.post(
            f"/session/{session['pin']}/message",
            json={"answer": 2},
            headers={relay.PLAYER_TOKEN_HEADER: player["player_token"]},
        )
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(task), 0.05)
    finally:
        await _stop_subscriber(stream, task)


async def test_sessions_do_not_leak_into_each_other(client):
    session = await _create_session(client)
    other = await _create_session(client)
    stream, task = await _start_subscriber(relay._state_topic(other["pin"]))
    try:
        await client.post(
            f"/session/{session['pin']}/state",
            json={"phase": "lobby"},
            headers={relay.HOST_TOKEN_HEADER: session["host_token"]},
        )
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(task), 0.05)
    finally:
        await _stop_subscriber(stream, task)


async def test_a_full_queue_drops_the_oldest_frame_not_the_subscriber():
    stream, task = await _start_subscriber("t")
    try:
        for index in range(relay.QUEUE_SIZE + 10):
            relay.fanout.publish("t", "state", {"n": index})
        # Still subscribed, and holding the newest frames rather than the
        # oldest -- a stale snapshot is worthless, the latest one is not.
        assert relay.fanout._queues["t"]
        _, data = _parse_sse(await asyncio.wait_for(task, 1))
        assert data == '{"n":10}'
    finally:
        await _stop_subscriber(stream, task)


@pytest.mark.parametrize(
    "origin", [relay.FRONTEND_ORIGIN, "http://127.0.0.1:5173", "http://localhost:5173"]
)
async def test_cors_preflight_allows_the_frontend_and_dev_origins(client, origin):
    response = await client.options(
        "/session",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": relay.HOST_TOKEN_HEADER,
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


async def test_cors_preflight_rejects_an_unknown_origin(client):
    response = await client.options(
        "/session",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in response.headers
