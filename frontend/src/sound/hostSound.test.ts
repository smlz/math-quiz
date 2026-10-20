import { afterEach, describe, expect, it, vi } from "vitest";
import { audibleRange, nextTune, pickAtRandom } from "./hostSound";

describe("nextTune", () => {
  const tunes = ["a", "b", "c", "d"];

  it("plays every tune once per round, in random order", () => {
    let played: string[] = [];
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      [order[i], played] = nextTune(tunes, played);
    }
    expect([...order].sort()).toEqual(tunes);
    expect(played).toEqual(order);
  });

  it("starts a new round once all have played, not with the last one", () => {
    for (let i = 0; i < 20; i++) {
      const [tune, round] = nextTune(tunes, ["b", "d", "a", "c"]);
      expect(tune).not.toBe("c");
      expect(round).toEqual([tune]);
    }
  });

  it("forgets tunes that no longer exist", () => {
    const [tune, round] = nextTune(["a", "b"], ["a", "gone"]);
    expect(tune).toBe("b");
    expect(round).toEqual(["a", "b"]);
  });
});

describe("pickAtRandom", () => {
  afterEach(() => vi.restoreAllMocks());

  it("can pick any of the items", () => {
    const picks = [0, 0.4, 0.99].map((r) => {
      vi.spyOn(Math, "random").mockReturnValue(r);
      return pickAtRandom(["a", "b", "c"]);
    });
    expect(picks).toEqual(["a", "b", "c"]);
  });

  it("never picks the same item twice in a row when there is a choice", () => {
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      expect(pickAtRandom(["a", "b", "c"], "b")).not.toBe("b");
    }
  });

  it("repeats an item that is the only one", () => {
    expect(pickAtRandom(["a"], "a")).toBe("a");
  });
});

function buffer(...channels: number[][]) {
  return {
    numberOfChannels: channels.length,
    sampleRate: 10,
    length: channels[0].length,
    getChannelData: (channel: number) => Float32Array.from(channels[channel]),
  };
}

describe("audibleRange", () => {
  it("skips the silent padding at both ends", () => {
    expect(audibleRange(buffer([0, 0, 0.5, -0.5, 0.2, 0, 0, 0, 0, 0]))).toEqual([0.2, 0.5]);
  });

  it("takes the widest range over all channels", () => {
    expect(audibleRange(buffer([0, 0, 0, 0.5, 0, 0], [0, 0.5, 0, 0, 0.5, 0]))).toEqual([0.1, 0.5]);
  });

  it("treats near-silence as silence", () => {
    expect(audibleRange(buffer([0.0001, 0.5, 0.5, -0.0001]))).toEqual([0.1, 0.3]);
  });

  it("keeps a silent buffer whole", () => {
    expect(audibleRange(buffer([0, 0, 0, 0]))).toEqual([0, 0.4]);
  });

  it("keeps a buffer with no padding whole", () => {
    expect(audibleRange(buffer([0.5, 0.5, 0.5]))).toEqual([0, 0.3]);
  });
});
