import { appendFileSync } from "node:fs";
import { relative } from "node:path";
import type { FullConfig, Reporter, Suite } from "@playwright/test/reporter";

const noun = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

function counts(failed: number, passed: number) {
  const parts: string[] = [];
  if (failed > 0) parts.push(`❌ **${noun(failed, "failure", "failures")}**`);
  if (passed > 0) parts.push(`✅ **${noun(passed, "pass", "passes")}**`);
  parts.push(`${failed + passed} total`);
  return parts.join(" · ");
}

/**
 * On GitHub Actions, writes a job summary in the same shape as Vitest's
 * built-in one; elsewhere it does nothing.
 */
export default class GitHubSummaryReporter implements Reporter {
  private config!: FullConfig;
  private suite!: Suite;

  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    this.suite = suite;
  }

  printsToStdio() {
    return false;
  }

  onEnd() {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;

    const files = new Map<string, boolean>();
    const failed: string[] = [];
    let passed = 0;
    let skipped = 0;
    for (const test of this.suite.allTests()) {
      const outcome = test.outcome();
      if (outcome === "skipped") {
        skipped++;
        continue;
      }
      const file = relative(this.config.rootDir, test.location.file).replaceAll("\\", "/");
      const isFailure = outcome === "unexpected";
      files.set(file, (files.get(file) ?? false) || isFailure);
      if (isFailure) failed.push(`${file}:${test.location.line} › ${test.title}`);
      else passed++;
    }
    const failedFiles = [...files.values()].filter(Boolean).length;

    const lines = [
      "## Playwright Test Report",
      "",
      "### Summary",
      "",
      `- **Test Files**: ${counts(failedFiles, files.size - failedFiles)}`,
      `- **Test Results**: ${counts(failed.length, passed)}`,
    ];
    if (skipped > 0) lines.push(`- **Other**: ${noun(skipped, "skip", "skips")}`);
    if (failed.length > 0) {
      lines.push("", "### Failures", "", ...failed.map((title) => `- \`${title}\``));
    }
    appendFileSync(summaryPath, lines.join("\n") + "\n");
  }
}
