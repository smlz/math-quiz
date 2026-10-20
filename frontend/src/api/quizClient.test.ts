import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportAfterGrace, type ConnectionStatus } from "./quizClient";

describe("reportAfterGrace", () => {
  let seen: ConnectionStatus[];
  const record = (status: ConnectionStatus) => seen.push(status);

  beforeEach(() => {
    seen = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes open on at once", () => {
    reportAfterGrace(record, 5000)("open");
    expect(seen).toEqual(["open"]);
  });

  it("keeps quiet about an outage that heals within the grace period", () => {
    const report = reportAfterGrace(record, 5000);
    report("reconnecting");
    vi.advanceTimersByTime(4999);
    report("open");
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual(["open"]);
  });

  it("reports an outage that outlasts the grace period", () => {
    const report = reportAfterGrace(record, 5000);
    report("reconnecting");
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual(["reconnecting"]);
  });

  it("counts the grace period from the first failure, not the latest", () => {
    // A reconnect loop fails again every second; that must not postpone the
    // banner forever.
    const report = reportAfterGrace(record, 5000);
    for (let i = 0; i < 5; i++) {
      report("reconnecting");
      vi.advanceTimersByTime(1000);
    }
    expect(seen).toEqual(["reconnecting"]);
  });

  it("forgets a pending outage when cancelled", () => {
    const report = reportAfterGrace(record, 5000);
    report("reconnecting");
    report.cancel();
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual([]);
  });
});
