import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answersAtRisk, IDLE_LINK, openHostLink, type HostLink, type LinkStatus } from "./hostLink";
import {
  endSession,
  publishState,
  subscribeToMessages,
  RelayError,
  type ConnectionStatus,
  type IncomingMessage,
  type SessionSnapshot,
} from "./quizClient";

vi.mock("./quizClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./quizClient")>()),
  publishState: vi.fn(),
  subscribeToMessages: vi.fn(),
  endSession: vi.fn(),
}));

/** The inbox HostLink reads, standing in for the relay's message stream. */
interface FakeInbox {
  message: (message: IncomingMessage) => void;
  status: (status: ConnectionStatus) => void;
  refuse: () => void;
  closed: boolean;
}

/** A publish that has not been answered yet. */
interface PendingPublish {
  snapshot: SessionSnapshot;
  succeed: () => void;
  fail: (error: Error) => void;
}

let inbox: FakeInbox;
let pending: PendingPublish[];
let sent: SessionSnapshot[];
let released: number;
let statuses: LinkStatus[];
let messages: IncomingMessage[];
let phase: SessionSnapshot["phase"];
let link: HostLink;

const status = () => statuses.at(-1) ?? IDLE_LINK;
/** Answers every publish under way, and lets the link react. */
async function answerAll() {
  while (pending.length) pending.shift()!.succeed();
  await vi.advanceTimersByTimeAsync(0);
}

function open(seq?: number) {
  link = openHostLink({
    pin: "123456",
    hostToken: "secret",
    seq,
    snapshot: () => ({ phase, question_index: null, players: [] }),
    onMessage: (message) => messages.push(message),
    onStatus: (next) => statuses.push(next),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  sent = [];
  released = 0;
  statuses = [];
  messages = [];
  phase = "lobby";
  vi.mocked(publishState).mockImplementation((_pin, _token, snapshot, signal) => {
    sent.push(snapshot);
    return new Promise((resolve, reject) => {
      pending.push({ snapshot, succeed: () => resolve({ ok: true }), fail: reject });
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
  vi.mocked(subscribeToMessages).mockImplementation((_pin, _token, onMessage, onStatus, onRefused) => {
    inbox = { message: onMessage, status: onStatus!, refuse: onRefused!, closed: false };
    return () => (inbox.closed = true);
  });
  vi.mocked(endSession).mockImplementation(async () => {
    released++;
  });
});

afterEach(() => {
  link.stop();
  vi.useRealTimers();
});

describe("broadcasting", () => {
  it("starts at once, numbering snapshots past the ones sent before a reload", async () => {
    const before = Date.now() + 60_000;
    open(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].seq).toBe(before + 1);
    await answerAll();
    phase = "question";
    void link.broadcastNow();
    expect(sent[1]).toMatchObject({ phase: "question", seq: before + 2 });
    expect(link.seq).toBe(before + 2);
  });

  it("confirms a burst of messages with one snapshot", async () => {
    open();
    await answerAll();
    for (let i = 0; i < 5; i++) {
      link.broadcastSoon();
      await vi.advanceTimersByTimeAsync(80);
    }
    expect(sent).toHaveLength(1);
    // Within the window of the first message, not of the last.
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(2);
    await answerAll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(2);
  });

  it("keeps one broadcast under way and sends a change made meanwhile right after it", async () => {
    open();
    phase = "question";
    void link.broadcastNow();
    void link.broadcastNow();
    expect(sent).toHaveLength(1);
    await answerAll();
    expect(sent).toHaveLength(2);
    expect(sent[1].phase).toBe("question");
    await answerAll();
    expect(sent).toHaveLength(2);
  });

  it("repeats the snapshot on a heartbeat", async () => {
    open();
    await answerAll();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(2);
  });

  it("retries a failed broadcast soon, and shows the banner only if it lasts", async () => {
    open();
    inbox.status("open");
    pending.shift()!.fail(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(status()).toMatchObject({ broadcast: "reconnecting", down: false });
    expect(answersAtRisk(status(), Infinity)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(2);
    pending.shift()!.fail(new Error("offline"));
    await vi.advanceTimersByTimeAsync(4000);
    expect(status().down).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await answerAll();
    expect(status()).toMatchObject({ broadcast: "open", down: false });
  });

  it("calls a broadcast that hangs slow before it fails", async () => {
    open();
    await vi.advanceTimersByTimeAsync(1999);
    expect(status().slow).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(status().slow).toBe(true);
    await answerAll();
    expect(status().slow).toBe(false);
  });
});

describe("the inbox", () => {
  it("passes messages on", () => {
    open();
    const message: IncomingMessage = { player_id: "ada", payload: { type: "join", nickname: "Ada" } };
    inbox.message(message);
    expect(messages).toEqual([message]);
  });

  it("counts its first opening as a recovery, for a while", async () => {
    open();
    await answerAll();
    expect(status().inbox).toBe("reconnecting");
    const openedAt = Date.now();
    inbox.status("open");
    expect(status()).toMatchObject({ inbox: "open", inboxBackAt: openedAt });
    expect(answersAtRisk(status(), openedAt - 1)).toBe(true);
    // A question started after it has lost nothing to the outage.
    expect(answersAtRisk(status(), openedAt + 1)).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(status().inboxBackAt).toBeNull();
    expect(answersAtRisk(status(), 0)).toBe(false);
  });
});

describe("stopping", () => {
  it("stops for good once the relay refuses the token", async () => {
    open();
    pending.shift()!.fail(new RelayError("refused", 403));
    await vi.advanceTimersByTimeAsync(0);
    expect(status()).toMatchObject({ refused: true, down: false, inbox: "open" });
    expect(inbox.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
    link.end({ phase: "finished", question_index: null, players: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(released).toBe(0);
  });

  it("stops when the inbox is refused", async () => {
    open();
    inbox.refuse();
    expect(status().refused).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
  });

  it("leaves the session to another tab without releasing the pin", async () => {
    open();
    link.stop();
    inbox.message({ player_id: "ada", payload: { type: "join", nickname: "Ada" } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
    expect(messages).toEqual([]);
    expect(released).toBe(0);
  });

  it("says farewell, then releases the pin, and nothing after", async () => {
    open();
    await answerAll();
    link.end({ phase: "finished", question_index: null, players: [] });
    expect(sent.at(-1)).toMatchObject({ phase: "finished", players: [] });
    expect(sent.at(-1)!.seq).toBeGreaterThan(sent[0].seq!);
    expect(released).toBe(0);
    await answerAll();
    expect(released).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(2);
  });

  it("releases the pin even when the farewell fails", async () => {
    open();
    await answerAll();
    link.end({ phase: "finished", question_index: null, players: [] });
    pending.shift()!.fail(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toBe(1);
  });

  it("drops the broadcast under way and the banner", async () => {
    open();
    pending.shift()!.fail(new Error("offline"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(status().down).toBe(true);
    link.end();
    expect(status()).toMatchObject(IDLE_LINK);
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toBe(1);
  });
});
