"""Make the repo root importable, so tests can `import quiz_relay_api`."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _noun(count, singular, plural):
    return f"{count} {singular if count == 1 else plural}"


def pytest_terminal_summary(terminalreporter):
    """On GitHub Actions, write a job summary in the same shape as Vitest's."""
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return

    stats = terminalreporter.stats
    failed = [r for key in ("failed", "error") for r in stats.get(key, [])]
    passed = stats.get("passed", [])
    skipped = len(stats.get("skipped", []))

    files = {}
    for report in [*passed, *failed]:
        file = report.nodeid.split("::")[0]
        files[file] = files.get(file, False) or report in failed
    failed_files = sum(files.values())

    def counts(n_failed, n_passed):
        parts = []
        if n_failed:
            parts.append(f"❌ **{_noun(n_failed, 'failure', 'failures')}**")
        if n_passed:
            parts.append(f"✅ **{_noun(n_passed, 'pass', 'passes')}**")
        parts.append(f"{n_failed + n_passed} total")
        return " · ".join(parts)

    lines = [
        "## Pytest Test Report",
        "",
        "### Summary",
        "",
        f"- **Test Files**: {counts(failed_files, len(files) - failed_files)}",
        f"- **Test Results**: {counts(len(failed), len(passed))}",
    ]
    if skipped:
        lines.append(f"- **Other**: {_noun(skipped, 'skip', 'skips')}")
    if failed:
        lines += ["", "### Failures", ""]
        lines += [f"- `{report.nodeid}`" for report in failed]

    with open(summary_path, "a", encoding="utf-8") as summary:
        summary.write("\n".join(lines) + "\n")
