"""Integration tests for the math-quiz relay backend (SPEC.md §7, §12.1).

These deliberately never construct a real quiz: per the relay contract, the
server treats question content and option indices as opaque, so arbitrary
JSON event payloads are enough to exercise create/join/advance/answer/relay.
"""

import asyncio

import math_quiz

API = "/api/math-quiz/v1"


async def test_create_session_returns_pin_and_host_pin(client):
    resp = await client.post(f"{API}/sessions")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["pin"]) == 6
    assert body["pin"].isdigit()
    assert len(body["host_pin"]) > 10
    assert body["host_pin"] != body["pin"]


async def test_join_unknown_pin_returns_404(client):
    resp = await client.post(f"{API}/sessions/000000/join", json={"nickname": "Ada"})
    assert resp.status_code == 404


async def test_advance_requires_correct_host_pin(client):
    create_resp = await client.post(f"{API}/sessions")
    resp = await client.post(
        f"{API}/sessions/not-the-real-host-pin/advance",
        json={"event_type": "question_started", "data": {}},
    )
    assert resp.status_code == 404
    assert create_resp.status_code == 200  # sanity: session creation itself worked


async def test_full_relay_flow(client):
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]
    host_pin = create_resp.json()["host_pin"]

    join_a = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Ada"})
    join_b = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Bo"})
    assert join_a.status_code == 200
    assert join_b.status_code == 200
    player_a = join_a.json()["player_id"]
    player_b = join_b.json()["player_id"]
    assert player_a != player_b

    advance_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": 0}},
    )
    assert advance_resp.status_code == 200

    answer_a = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": player_a, "question_index": 0, "option_index": 2},
    )
    answer_b = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": player_b, "question_index": 0, "option_index": 2},
    )
    assert answer_a.status_code == 200
    assert answer_b.status_code == 200

    state = (await client.get(f"{API}/sessions/{pin}/state")).json()
    assert state["current_question_index"] == 0
    assert state["tally"] == {"2": 2}
    assert {p["nickname"] for p in state["players"]} == {"Ada", "Bo"}


async def test_answer_rejects_unknown_player(client):
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]
    host_pin = create_resp.json()["host_pin"]
    await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": 0}},
    )

    resp = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": "not-a-real-player", "question_index": 0, "option_index": 0},
    )
    assert resp.status_code == 403


async def test_answer_rejects_wrong_question_index(client):
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]
    host_pin = create_resp.json()["host_pin"]
    join_resp = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Ada"})
    player_id = join_resp.json()["player_id"]

    await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": 0}},
    )

    resp = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": player_id, "question_index": 1, "option_index": 0},
    )
    assert resp.status_code == 409


async def test_answer_rejects_duplicate_submission(client):
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]
    host_pin = create_resp.json()["host_pin"]
    join_resp = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Ada"})
    player_id = join_resp.json()["player_id"]

    await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": 0}},
    )
    first = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": player_id, "question_index": 0, "option_index": 0},
    )
    second = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": player_id, "question_index": 0, "option_index": 1},
    )
    assert first.status_code == 200
    assert second.status_code == 409


async def test_session_finished_tears_down_session(client):
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]
    host_pin = create_resp.json()["host_pin"]

    finish_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "session_finished", "data": {}},
    )
    assert finish_resp.status_code == 200

    # Both pin and host_pin should no longer resolve to a live session.
    join_resp = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Ada"})
    assert join_resp.status_code == 404
    advance_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {}},
    )
    assert advance_resp.status_code == 404


async def test_join_publishes_player_joined_event(client):
    """Exercises the relay logic directly against the pub/sub topic rather
    than through the HTTP SSE endpoint: httpx's in-process ASGITransport
    buffers the whole ASGI app call before returning a response, so it can't
    drive an intentionally-never-ending SSE stream (see SPEC.md §12.3 -- full
    stream behavior is covered by the manual/E2E pass instead)."""
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]

    async def read_first_event():
        async for event in math_quiz.quiz_events.subscribe(topic=pin):
            return event

    reader_task = asyncio.create_task(read_first_event())
    await asyncio.sleep(0.05)  # let subscribe() register before publishing
    await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Ada"})

    event = await asyncio.wait_for(reader_task, timeout=2)
    assert event.event_type == "player_joined"
    assert event.data["nickname"] == "Ada"


async def test_answer_count_update_includes_player_and_timing(client):
    """The host app (SPEC.md §12.2 step 4) needs to know *which* player
    submitted *which* option and *when*, to compute per-player correctness
    and points at reveal time client-side (§12.1). The server still never
    learns which option is correct."""
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]
    host_pin = create_resp.json()["host_pin"]
    join_resp = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Ada"})
    player_id = join_resp.json()["player_id"]
    await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": 0}},
    )

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
        json={"player_id": player_id, "question_index": 0, "option_index": 1},
    )

    [event] = await asyncio.wait_for(reader_task, timeout=2)
    assert event.event_type == "answer_count_update"
    assert event.data["player_id"] == player_id
    assert event.data["option_index"] == 1
    assert event.data["counts"] == {1: 1}
    assert "submitted_at" in event.data


async def test_events_stream_unknown_pin_returns_404(client):
    resp = await client.get(f"{API}/sessions/000000/events")
    assert resp.status_code == 404


# --- Shape validation hardening (SPEC.md §12.2 step 7) -----------------


async def test_malformed_pin_rejected_before_lookup(client):
    for path in ("join", "answers", "state"):
        method = client.get if path == "state" else client.post
        kwargs = {} if path == "state" else {"json": {}}
        resp = await method(f"{API}/sessions/not-six-digits/{path}", **kwargs)
        assert resp.status_code == 422, path

    resp = await client.get(f"{API}/sessions/not-six-digits/events")
    assert resp.status_code == 422


async def test_malformed_host_pin_rejected_before_lookup(client):
    resp = await client.post(
        f"{API}/sessions/sh!ort/advance",
        json={"event_type": "session_finished", "data": {}},
    )
    assert resp.status_code == 422


async def test_answer_rejects_malformed_player_id(client):
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]

    resp = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": "!!!", "question_index": 0, "option_index": 0},
    )
    assert resp.status_code == 422


async def test_answer_rejects_out_of_range_option_index(client):
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]
    host_pin = create_resp.json()["host_pin"]
    join_resp = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": "Ada"})
    player_id = join_resp.json()["player_id"]
    await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": 0}},
    )

    resp = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": player_id, "question_index": 0, "option_index": -1},
    )
    assert resp.status_code == 422

    resp = await client.post(
        f"{API}/sessions/{pin}/answers",
        json={"player_id": player_id, "question_index": 0, "option_index": 999},
    )
    assert resp.status_code == 422


async def test_advance_rejects_unknown_event_type(client):
    create_resp = await client.post(f"{API}/sessions")
    host_pin = create_resp.json()["host_pin"]

    resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "definitely_not_a_real_event", "data": {}},
    )
    assert resp.status_code == 422


# --- Multi-player end-to-end game (SPEC.md §12.2 step 6) ----------------


async def test_full_multiplayer_two_question_game_e2e(client):
    """Plays a whole 2-question game with 3 players end-to-end through the
    relay contract exactly as the host/player apps would, including a
    non-answering player and correctness/points computed client-side (the
    server never learns which option is correct -- SPEC.md §12.1)."""
    create_resp = await client.post(f"{API}/sessions")
    pin = create_resp.json()["pin"]
    host_pin = create_resp.json()["host_pin"]

    nicknames = {"Ada": None, "Bo": None, "Cy": None}
    for name in nicknames:
        join_resp = await client.post(f"{API}/sessions/{pin}/join", json={"nickname": name})
        assert join_resp.status_code == 200
        nicknames[name] = join_resp.json()["player_id"]

    state = (await client.get(f"{API}/sessions/{pin}/state")).json()
    assert {p["nickname"] for p in state["players"]} == {"Ada", "Bo", "Cy"}
    scores = {player_id: 0 for player_id in nicknames.values()}

    # --- Question 1: correct_index = 2. Ada right, Bo wrong, Cy never answers. ---
    advance_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": 0}},
    )
    assert advance_resp.status_code == 200

    assert (
        await client.post(
            f"{API}/sessions/{pin}/answers",
            json={"player_id": nicknames["Ada"], "question_index": 0, "option_index": 2},
        )
    ).status_code == 200
    assert (
        await client.post(
            f"{API}/sessions/{pin}/answers",
            json={"player_id": nicknames["Bo"], "question_index": 0, "option_index": 1},
        )
    ).status_code == 200

    state = (await client.get(f"{API}/sessions/{pin}/state")).json()
    assert state["current_question_index"] == 0
    assert state["tally"] == {"1": 1, "2": 1}  # Cy never answered

    correct_index_q1 = 2
    results_q1 = {
        nicknames["Ada"]: {"option_index": 2, "correct": True, "points_awarded": 10},
        nicknames["Bo"]: {"option_index": 1, "correct": False, "points_awarded": 0},
        nicknames["Cy"]: {"option_index": None, "correct": False, "points_awarded": 0},
    }
    for player_id, result in results_q1.items():
        scores[player_id] += result["points_awarded"]

    reveal_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={
            "event_type": "question_revealed",
            "data": {
                "question_index": 0,
                "correct_index": correct_index_q1,
                "counts": state["tally"],
                "results": results_q1,
            },
        },
    )
    assert reveal_resp.status_code == 200

    standings_after_q1 = sorted(
        ({"player_id": pid, "score": s} for pid, s in scores.items()),
        key=lambda e: e["score"],
        reverse=True,
    )
    assert standings_after_q1[0]["player_id"] == nicknames["Ada"]
    leaderboard_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "leaderboard_updated", "data": {"standings": standings_after_q1}},
    )
    assert leaderboard_resp.status_code == 200

    # --- Question 2: correct_index = 0. Ada + Bo both right, Cy wrong. ---
    advance_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "question_started", "data": {"question_index": 1}},
    )
    assert advance_resp.status_code == 200

    for name, option_index in [("Ada", 0), ("Bo", 0), ("Cy", 3)]:
        resp = await client.post(
            f"{API}/sessions/{pin}/answers",
            json={"player_id": nicknames[name], "question_index": 1, "option_index": option_index},
        )
        assert resp.status_code == 200

    state = (await client.get(f"{API}/sessions/{pin}/state")).json()
    assert state["current_question_index"] == 1
    assert state["tally"] == {"0": 2, "3": 1}

    correct_index_q2 = 0
    results_q2 = {
        nicknames["Ada"]: {"option_index": 0, "correct": True, "points_awarded": 10},
        nicknames["Bo"]: {"option_index": 0, "correct": True, "points_awarded": 10},
        nicknames["Cy"]: {"option_index": 3, "correct": False, "points_awarded": 0},
    }
    for player_id, result in results_q2.items():
        scores[player_id] += result["points_awarded"]

    reveal_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={
            "event_type": "question_revealed",
            "data": {
                "question_index": 1,
                "correct_index": correct_index_q2,
                "counts": state["tally"],
                "results": results_q2,
            },
        },
    )
    assert reveal_resp.status_code == 200

    # Ada: 20, Bo: 10, Cy: 0 -- final standings.
    assert scores[nicknames["Ada"]] == 20
    assert scores[nicknames["Bo"]] == 10
    assert scores[nicknames["Cy"]] == 0
    final_standings = sorted(
        ({"player_id": pid, "score": s} for pid, s in scores.items()),
        key=lambda e: e["score"],
        reverse=True,
    )
    leaderboard_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "leaderboard_updated", "data": {"standings": final_standings}},
    )
    assert leaderboard_resp.status_code == 200

    finish_resp = await client.post(
        f"{API}/sessions/{host_pin}/advance",
        json={"event_type": "session_finished", "data": {}},
    )
    assert finish_resp.status_code == 200

    # Session is torn down: neither pin nor host_pin resolve anymore.
    assert (await client.get(f"{API}/sessions/{pin}/state")).status_code == 404
    assert (
        await client.post(f"{API}/sessions/{host_pin}/advance", json={"event_type": "session_finished", "data": {}})
    ).status_code == 404
