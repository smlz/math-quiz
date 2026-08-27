"""Integration tests for the math-quiz relay backend (SPEC.md §7, §12.1).

These deliberately never construct a real quiz: per the relay contract, the
server treats question content and option indices as opaque, so arbitrary
JSON event payloads are enough to exercise create/join/advance/answer/relay.

Every session path is addressed by the public `pin`; identity is proved by a
token header (`X-Host-Token` / `X-Player-Token`), never by the URL.
"""

import asyncio

import sqlalchemy as sa

import math_quiz

API = "/api/math-quiz/v1"


def host_auth(host_token):
    return {"X-Host-Token": host_token}


def player_auth(player_token):
    return {"X-Player-Token": player_token}


async def create_session(client):
    resp = await client.post(f"{API}/sessions")
    assert resp.status_code == 200
    body = resp.json()
    return body["pin"], body["host_token"]


async def join(client, pin, nickname, player_token=None):
    resp = await client.post(
        f"{API}/sessions/{pin}/join",
        json={"nickname": nickname, "player_token": player_token},
    )
    assert resp.status_code == 200
    return resp.json()


async def start_question(client, pin, host_token, question_index):
    resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": question_index}},
        headers=host_auth(host_token),
    )
    assert resp.status_code == 200


async def stored_pins():
    async with math_quiz.engine.connect() as conn:
        result = await conn.execute(sa.select(math_quiz.math_quiz_quiz_table.c.pin))
        return [row.pin for row in result]


async def test_create_session_returns_pin_and_host_token(client):
    resp = await client.post(f"{API}/sessions")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["pin"]) == 6
    assert body["pin"].isdigit()
    assert len(body["host_token"]) > 10
    assert body["host_token"] != body["pin"]


async def test_join_unknown_pin_returns_404(client):
    resp = await client.post(f"{API}/sessions/000000/join", json={"nickname": "Ada"})
    assert resp.status_code == 404


async def test_full_relay_flow(client):
    pin, host_token = await create_session(client)

    ada = await join(client, pin, "Ada")
    bo = await join(client, pin, "Bo")
    assert ada["player_id"] != bo["player_id"]

    await start_question(client, pin, host_token, 0)

    for player in (ada, bo):
        resp = await client.post(
            f"{API}/sessions/{pin}/answers",
            json={"question_index": 0, "option_index": 2},
            headers=player_auth(player["player_token"]),
        )
        assert resp.status_code == 200

    state = (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).json()
    assert state["current_question_index"] == 0
    assert state["tally"] == {"2": 2}
    assert {p["nickname"] for p in state["players"]} == {"Ada", "Bo"}
    assert set(state["answers"]) == {ada["player_id"], bo["player_id"]}
    assert state["answers"][ada["player_id"]]["option_index"] == 2


# --- Token authentication (SPEC.md §7) ---------------------------------


async def test_advance_requires_host_token(client):
    pin, host_token = await create_session(client)
    ada = await join(client, pin, "Ada")
    body = {"event_type": "question_started", "data": {"question_index": 0}}

    no_token = await client.post(f"{API}/sessions/{pin}/advance", json=body)
    assert no_token.status_code == 403

    wrong_token = await client.post(
        f"{API}/sessions/{pin}/advance", json=body, headers=host_auth("x" * 22)
    )
    assert wrong_token.status_code == 403

    # A player's own token must not let them drive the game.
    as_player = await client.post(
        f"{API}/sessions/{pin}/advance", json=body, headers=host_auth(ada["player_token"])
    )
    assert as_player.status_code == 403

    ok = await client.post(
        f"{API}/sessions/{pin}/advance", json=body, headers=host_auth(host_token)
    )
    assert ok.status_code == 200


async def test_answer_requires_player_token(client):
    pin, host_token = await create_session(client)
    await join(client, pin, "Ada")
    await start_question(client, pin, host_token, 0)
    body = {"question_index": 0, "option_index": 0}

    no_token = await client.post(f"{API}/sessions/{pin}/answers", json=body)
    assert no_token.status_code == 403

    unknown_token = await client.post(
        f"{API}/sessions/{pin}/answers", json=body, headers=player_auth("x" * 22)
    )
    assert unknown_token.status_code == 403

    # The host token authenticates the host, not a player, so it can't answer.
    as_host = await client.post(
        f"{API}/sessions/{pin}/answers", json=body, headers=player_auth(host_token)
    )
    assert as_host.status_code == 403


async def test_answer_is_attributed_to_the_token_holder(client):
    """`player_id` is no longer taken from the body, so one player cannot
    submit an answer on another's behalf."""
    pin, host_token = await create_session(client)
    ada = await join(client, pin, "Ada")
    bo = await join(client, pin, "Bo")
    await start_question(client, pin, host_token, 0)

    resp = await client.post(
        f"{API}/sessions/{pin}/answers",
        # A forged `player_id` in the body is simply ignored.
        json={"question_index": 0, "option_index": 3, "player_id": bo["player_id"]},
        headers=player_auth(ada["player_token"]),
    )
    assert resp.status_code == 200

    state = (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).json()
    assert list(state["answers"]) == [ada["player_id"]]


async def test_state_requires_a_session_token(client):
    pin, host_token = await create_session(client)
    ada = await join(client, pin, "Ada")

    assert (await client.get(f"{API}/sessions/{pin}/state")).status_code == 403
    assert (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth("x" * 22))
    ).status_code == 403
    assert (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).status_code == 200
    assert (
        await client.get(
            f"{API}/sessions/{pin}/state", headers=player_auth(ada["player_token"])
        )
    ).status_code == 200


async def test_malformed_token_header_rejected_before_lookup(client):
    pin, _ = await create_session(client)

    resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "session_finished", "data": {}},
        headers=host_auth("sh!ort"),
    )
    assert resp.status_code == 422

    resp = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"question_index": 0, "option_index": 0},
        headers=player_auth("!!!"),
    )
    assert resp.status_code == 422


async def test_events_stream_needs_no_token(client):
    """`EventSource` cannot send custom headers, so the stream is gated on the
    `pin` alone -- it only ever carries events every participant sees."""
    resp = await client.get(f"{API}/sessions/000000/events")
    assert resp.status_code == 404


# --- Reconnect via per-session player token (SPEC.md §4.3) --------------


async def test_rejoin_with_token_keeps_same_player(client):
    """A player that loses its connection must resume its identity instead of
    being added to the roster a second time."""
    pin, host_token = await create_session(client)

    first = await join(client, pin, "Ada")
    again = await join(client, pin, "Ada", player_token=first["player_token"])

    assert again["player_id"] == first["player_id"]
    assert again["player_token"] == first["player_token"]
    assert again["reconnected"] is True

    state = (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).json()
    assert len(state["players"]) == 1


async def test_rejoin_keeps_original_nickname(client):
    pin, host_token = await create_session(client)

    first = await join(client, pin, "Ada")
    again = await join(client, pin, "Impostor", player_token=first["player_token"])

    assert again["nickname"] == "Ada"
    state = (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).json()
    assert [p["nickname"] for p in state["players"]] == ["Ada"]


async def test_rejoin_reports_active_question_and_own_answer(client):
    """So the player app can land back on the question it left, with its
    already-submitted option locked in rather than tappable (and 409-ing)."""
    pin, host_token = await create_session(client)
    first = await join(client, pin, "Ada")
    await start_question(client, pin, host_token, 3)

    before_answering = await join(client, pin, "Ada", player_token=first["player_token"])
    assert before_answering["current_question_index"] == 3
    assert before_answering["submitted_answer"] is None

    await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"question_index": 3, "option_index": 1},
        headers=player_auth(first["player_token"]),
    )

    after_answering = await join(client, pin, "Ada", player_token=first["player_token"])
    assert after_answering["submitted_answer"] == {"question_index": 3, "option_index": 1}


async def test_stale_token_falls_back_to_a_fresh_join(client):
    """A token left over from a finished quiz must not lock the player out."""
    pin, host_token = await create_session(client)

    joined = await join(client, pin, "Ada", player_token="a" * 32)
    assert joined["reconnected"] is False

    state = (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).json()
    assert [p["nickname"] for p in state["players"]] == ["Ada"]


async def test_tokens_are_never_broadcast(client):
    """`player_id` is published to every subscriber, so the tokens must not
    be -- they are the only access-control secrets."""
    pin, host_token = await create_session(client)

    async def read_first_event():
        async for event in math_quiz.quiz_events.subscribe(topic=pin):
            return event

    reader_task = asyncio.create_task(read_first_event())
    await asyncio.sleep(0.05)
    joined = await join(client, pin, "Ada")

    event = await asyncio.wait_for(reader_task, timeout=2)
    assert "player_token" not in event.data

    state = await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    assert joined["player_token"] not in state.text
    assert host_token not in state.text


async def test_rejoin_with_malformed_token_rejected(client):
    pin, _ = await create_session(client)

    resp = await client.post(
        f"{API}/sessions/{pin}/join",
        json={"nickname": "Ada", "player_token": "!!!"},
    )
    assert resp.status_code == 422


# --- Answer validation --------------------------------------------------


async def test_answer_rejects_wrong_question_index(client):
    pin, host_token = await create_session(client)
    ada = await join(client, pin, "Ada")
    await start_question(client, pin, host_token, 0)

    resp = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"question_index": 1, "option_index": 0},
        headers=player_auth(ada["player_token"]),
    )
    assert resp.status_code == 409


async def test_answer_rejects_duplicate_submission(client):
    pin, host_token = await create_session(client)
    ada = await join(client, pin, "Ada")
    await start_question(client, pin, host_token, 0)

    first = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"question_index": 0, "option_index": 0},
        headers=player_auth(ada["player_token"]),
    )
    second = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"question_index": 0, "option_index": 1},
        headers=player_auth(ada["player_token"]),
    )
    assert first.status_code == 200
    assert second.status_code == 409


async def test_answer_rejects_out_of_range_option_index(client):
    pin, host_token = await create_session(client)
    ada = await join(client, pin, "Ada")
    await start_question(client, pin, host_token, 0)

    for option_index in (-1, 999):
        resp = await client.post(
            f"{API}/sessions/{pin}/answers",
            json={"question_index": 0, "option_index": option_index},
            headers=player_auth(ada["player_token"]),
        )
        assert resp.status_code == 422, option_index


async def test_session_finished_tears_down_session(client):
    pin, host_token = await create_session(client)

    finish_resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "session_finished", "data": {}},
        headers=host_auth(host_token),
    )
    assert finish_resp.status_code == 200

    join_resp = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Ada"})
    assert join_resp.status_code == 404
    advance_resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "question_started", "data": {}},
        headers=host_auth(host_token),
    )
    assert advance_resp.status_code == 404


async def test_session_finished_deletes_the_database_row(client):
    """Nothing about a played quiz outlives it -- the row exists only so the
    pin/host_token can be minted uniquely while the session runs."""
    pin, host_token = await create_session(client)

    assert pin in await stored_pins()

    finish_resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "session_finished", "data": {}},
        headers=host_auth(host_token),
    )
    assert finish_resp.status_code == 200
    assert pin not in await stored_pins()


async def test_join_publishes_player_joined_event(client):
    """Exercises the relay logic directly against the pub/sub topic rather
    than through the HTTP SSE endpoint: httpx's in-process ASGITransport
    buffers the whole ASGI app call before returning a response, so it can't
    drive an intentionally-never-ending SSE stream (see SPEC.md §12.3 -- full
    stream behavior is covered by the manual/E2E pass instead)."""
    pin, _ = await create_session(client)

    async def read_first_event():
        async for event in math_quiz.quiz_events.subscribe(topic=pin):
            return event

    reader_task = asyncio.create_task(read_first_event())
    await asyncio.sleep(0.05)  # let subscribe() register before publishing
    await join(client, pin, "Ada")

    event = await asyncio.wait_for(reader_task, timeout=2)
    assert event.event_type == "player_joined"
    assert event.data["nickname"] == "Ada"


async def test_answer_count_update_includes_player_and_timing(client):
    """The host app (SPEC.md §12.2 step 4) needs to know *which* player
    submitted *which* option and *when*, to compute per-player correctness
    and points at reveal time client-side (§12.1). The server still never
    learns which option is correct."""
    pin, host_token = await create_session(client)
    ada = await join(client, pin, "Ada")
    await start_question(client, pin, host_token, 0)

    async def read_events(n):
        events = []
        async for event in math_quiz.quiz_events.subscribe(topic=pin):
            events.append(event)
            if len(events) == n:
                return events

    reader_task = asyncio.create_task(read_events(1))
    await asyncio.sleep(0.05)
    await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"question_index": 0, "option_index": 1},
        headers=player_auth(ada["player_token"]),
    )

    [event] = await asyncio.wait_for(reader_task, timeout=2)
    assert event.event_type == "answer_count_update"
    assert event.data["player_id"] == ada["player_id"]
    assert event.data["option_index"] == 1
    assert event.data["counts"] == {1: 1}
    assert "submitted_at" in event.data


# --- Shape validation hardening (SPEC.md §12.2 step 7) -----------------


async def test_malformed_pin_rejected_before_lookup(client):
    for path in ("join", "answers", "advance", "state"):
        method = client.get if path == "state" else client.post
        kwargs = {} if path == "state" else {"json": {}}
        resp = await method(f"{API}/sessions/not-six-digits/{path}", **kwargs)
        assert resp.status_code == 422, path

    resp = await client.get(f"{API}/sessions/not-six-digits/events")
    assert resp.status_code == 422


async def test_advance_rejects_unknown_event_type(client):
    pin, host_token = await create_session(client)

    resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "definitely_not_a_real_event", "data": {}},
        headers=host_auth(host_token),
    )
    assert resp.status_code == 422


# --- Multi-player end-to-end game (SPEC.md §12.2 step 6) ----------------


async def test_full_multiplayer_two_question_game_e2e(client):
    """Plays a whole 2-question game with 3 players end-to-end through the
    relay contract exactly as the host/player apps would, including a
    non-answering player and correctness/points computed client-side (the
    server never learns which option is correct -- SPEC.md §12.1)."""
    pin, host_token = await create_session(client)

    players = {name: await join(client, pin, name) for name in ("Ada", "Bo", "Cy")}
    player_ids = {name: player["player_id"] for name, player in players.items()}

    state = (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).json()
    assert {p["nickname"] for p in state["players"]} == {"Ada", "Bo", "Cy"}
    scores = {player_id: 0 for player_id in player_ids.values()}

    # --- Question 1: correct_index = 2. Ada right, Bo wrong, Cy never answers. ---
    await start_question(client, pin, host_token, 0)

    for name, option_index in [("Ada", 2), ("Bo", 1)]:
        resp = await client.post(
            f"{API}/sessions/{pin}/answers",
            json={"question_index": 0, "option_index": option_index},
            headers=player_auth(players[name]["player_token"]),
        )
        assert resp.status_code == 200

    state = (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).json()
    assert state["current_question_index"] == 0
    assert state["tally"] == {"1": 1, "2": 1}  # Cy never answered

    results_q1 = {
        # Ada is the first (and only) correct answer -> 12 points (SPEC.md §5).
        player_ids["Ada"]: {"option_index": 2, "correct": True, "points_awarded": 12},
        player_ids["Bo"]: {"option_index": 1, "correct": False, "points_awarded": 0},
        player_ids["Cy"]: {"option_index": None, "correct": False, "points_awarded": 0},
    }
    for player_id, result in results_q1.items():
        scores[player_id] += result["points_awarded"]

    reveal_resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={
            "event_type": "question_revealed",
            "data": {
                "question_index": 0,
                "correct_index": 2,
                "counts": state["tally"],
                "results": results_q1,
            },
        },
        headers=host_auth(host_token),
    )
    assert reveal_resp.status_code == 200

    standings_after_q1 = sorted(
        ({"player_id": pid, "score": s} for pid, s in scores.items()),
        key=lambda e: e["score"],
        reverse=True,
    )
    assert standings_after_q1[0]["player_id"] == player_ids["Ada"]
    leaderboard_resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "leaderboard_updated", "data": {"standings": standings_after_q1}},
        headers=host_auth(host_token),
    )
    assert leaderboard_resp.status_code == 200

    # --- Question 2: correct_index = 0. Ada + Bo both right, Cy wrong. ---
    await start_question(client, pin, host_token, 1)

    for name, option_index in [("Ada", 0), ("Bo", 0), ("Cy", 3)]:
        resp = await client.post(
            f"{API}/sessions/{pin}/answers",
            json={"question_index": 1, "option_index": option_index},
            headers=player_auth(players[name]["player_token"]),
        )
        assert resp.status_code == 200

    state = (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).json()
    assert state["current_question_index"] == 1
    assert state["tally"] == {"0": 2, "3": 1}

    results_q2 = {
        # Ada answered first, Bo second -> 12 / 11 points (SPEC.md §5).
        player_ids["Ada"]: {"option_index": 0, "correct": True, "points_awarded": 12},
        player_ids["Bo"]: {"option_index": 0, "correct": True, "points_awarded": 11},
        player_ids["Cy"]: {"option_index": 3, "correct": False, "points_awarded": 0},
    }
    for player_id, result in results_q2.items():
        scores[player_id] += result["points_awarded"]

    reveal_resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={
            "event_type": "question_revealed",
            "data": {
                "question_index": 1,
                "correct_index": 0,
                "counts": state["tally"],
                "results": results_q2,
            },
        },
        headers=host_auth(host_token),
    )
    assert reveal_resp.status_code == 200

    # Ada: 24, Bo: 11, Cy: 0 -- final standings.
    assert scores[player_ids["Ada"]] == 24
    assert scores[player_ids["Bo"]] == 11
    assert scores[player_ids["Cy"]] == 0
    final_standings = sorted(
        ({"player_id": pid, "score": s} for pid, s in scores.items()),
        key=lambda e: e["score"],
        reverse=True,
    )
    leaderboard_resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "leaderboard_updated", "data": {"standings": final_standings}},
        headers=host_auth(host_token),
    )
    assert leaderboard_resp.status_code == 200

    finish_resp = await client.post(
        f"{API}/sessions/{pin}/advance",
        json={"event_type": "session_finished", "data": {}},
        headers=host_auth(host_token),
    )
    assert finish_resp.status_code == 200

    # Session is torn down: the pin resolves to nothing for anyone.
    assert (
        await client.get(f"{API}/sessions/{pin}/state", headers=host_auth(host_token))
    ).status_code == 404
    assert (
        await client.post(
            f"{API}/sessions/{pin}/advance",
            json={"event_type": "session_finished", "data": {}},
            headers=host_auth(host_token),
        )
    ).status_code == 404
