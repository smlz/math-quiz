"""conftest for the math-quiz backend tests.

Points DATABASE_URL at a throwaway SQLite file before importing api_async
(whose module-level `engine` reads that env var at import time), so tests
never touch a real Postgres/local dev database.
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_tmp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_tmp_dir.name}/test.db")

import pytest
from httpx import ASGITransport, AsyncClient

# api_async must be imported before math_quiz: api_async.py imports the
# math_quiz router near its bottom (after engine/metadata/AsyncPubSub are
# already defined), so importing api_async first avoids a circular-import
# ImportError on `router` not existing yet.
from api_async import app, engine, metadata
import math_quiz


@pytest.fixture(autouse=True)
async def _reset_state():
    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)
    math_quiz._sessions_by_pin.clear()
    math_quiz._pin_by_host_pin.clear()
    yield


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
