// The connection between the host page and the relay while this tab hosts a
// quiz: reading the inbox, broadcasting snapshots, and telling HostApp.vue how
// both are doing. It knows nothing about the quiz itself -- what to broadcast
// comes from a callback, and what arrives goes to one.
//
// Nothing here remembers what was sent (see quizClient.ts): the current
// snapshot goes out on every change and on a heartbeat regardless, which is
// what lets a player who missed something catch up.

import { debugLog, describeError } from "../debug/debugLog";
import {
  endSession,
  publishState,
  reportAfterGrace,
  subscribeToMessages,
  HEARTBEAT_MS,
  RelayError,
  type ConnectionStatus,
  type IncomingMessage,
  type SessionSnapshot,
} from "./quizClient";

// Player messages arrive in bursts (a class joining, everyone answering), and
// each snapshot goes out to every player: one per message would be quadratic.
// All messages within this window are confirmed by a single snapshot instead.
export const BROADCAST_THROTTLE_MS = 500;
// A failed broadcast is repeated this soon rather than at the next heartbeat,
// so a single lost request heals before it is worth a banner.
export const BROADCAST_RETRY_MS = 1000;
// After the inbox comes back, answers sent while it was down still have to
// arrive: players re-send every 2 s until they see their answer land
// (PlayerApp's RETRY_MS). Until then a reveal would miss them.
export const SETTLE_AFTER_RECONNECT_MS = 3000;
// A broadcast that takes this long has not failed yet, but the connection
// that carries the answers is in trouble too.
export const SLOW_BROADCAST_MS = 2000;

/** How the link is doing, as HostApp shows it. */
export interface LinkStatus {
  /** Worth a banner: the inbox or the broadcasts have been failing for
   * longer than RECONNECT_GRACE_MS. */
  down: boolean;
  /** The relay refused the host token: it has expired, a day after the quiz
   * was created, or the pin has gone to another session. Retrying cannot
   * change that, so the link has stopped for good. */
  refused: boolean;
  /** The inbox and the broadcasts as they are right now, without the
   * banner's grace period: the reveal must not wait five seconds to learn
   * that answers cannot arrive. They fail independently, and a successful
   * broadcast says nothing about whether messages still arrive. */
  inbox: ConnectionStatus;
  broadcast: ConnectionStatus;
  /** A broadcast has been under way for longer than SLOW_BROADCAST_MS. */
  slow: boolean;
  /** When the inbox last came back, for SETTLE_AFTER_RECONNECT_MS after it;
   * null otherwise. Only the inbox's recovery counts: answers come in through
   * it alone, so a broadcast that failed and recovered has lost none. */
  inboxBackAt: number | null;
}

/** Nothing to report: before a link is opened, and after it was ended. */
export const IDLE_LINK: Readonly<LinkStatus> = {
  down: false,
  refused: false,
  inbox: "open",
  broadcast: "open",
  slow: false,
  inboxBackAt: null,
};

/** Whether answers on their way may not reach the host right now: the inbox
 * or the broadcasts are failing or stuck, or the inbox only just came back
 * after `since` -- typically when the current question started, as answers
 * cannot have been sent before that. */
export function answersAtRisk(status: LinkStatus, since: number): boolean {
  return (
    status.inbox !== "open" ||
    status.broadcast !== "open" ||
    status.slow ||
    (status.inboxBackAt !== null && status.inboxBackAt > since)
  );
}

export interface HostLinkOptions {
  pin: string;
  hostToken: string;
  /** The number of the latest snapshot sent before a reload of the page
   * (StoredHostSession.seq), which the next one must exceed. */
  seq?: number;
  /** What players are to be told right now. The link numbers it. */
  snapshot: () => SessionSnapshot;
  onMessage: (message: IncomingMessage) => void;
  onStatus: (status: LinkStatus) => void;
}

export interface HostLink {
  /** Broadcasts the current snapshot at once: after the teacher moved on. */
  broadcastNow(): Promise<void>;
  /** Broadcasts within BROADCAST_THROTTLE_MS, together with whatever else
   * changes until then: after a player's message. The first message of a
   * burst starts the clock and the later ones ride along, so no sender
   * waits longer than the window. */
  broadcastSoon(): void;
  /** The number of the latest snapshot, for storing with the session. */
  readonly seq: number;
  /** Stops at once and leaves the session to whoever carries on with it:
   * another tab, or this one after a reload. */
  stop(): void;
  /** Ends the session: stops at once, then tells the players `farewell`, if
   * given, and releases the pin -- in that order, as a snapshot arriving
   * after the release would claim the pin again. Best effort: a pupil this
   * does not reach is told that the teacher has no connection, and a pin the
   * relay never hears about expires by itself. */
  end(farewell?: SessionSnapshot): void;
}

/** Starts reading the inbox and broadcasting, the first snapshot at once. */
export function openHostLink(options: HostLinkOptions): HostLink {
  const { pin, hostToken } = options;
  const status: LinkStatus = { ...IDLE_LINK };
  let stopped = false;

  function update(change: Partial<LinkStatus>) {
    const before = { ...status };
    Object.assign(status, change);
    if ((Object.keys(change) as (keyof LinkStatus)[]).some((key) => status[key] !== before[key])) {
      options.onStatus({ ...status });
    }
  }

  // ── The banner ──────────────────────────────────────────────────────────

  const shown: { inbox: ConnectionStatus; broadcast: ConnectionStatus } = { inbox: "open", broadcast: "open" };
  const reportInbox = reportAfterGrace((state) => showState({ inbox: state }));
  const reportBroadcast = reportAfterGrace((state) => showState({ broadcast: state }));

  function showState(change: Partial<typeof shown>) {
    Object.assign(shown, change);
    const down = shown.inbox !== "open" || shown.broadcast !== "open";
    // The banner, not the raw stream events: those are logged by quizClient.
    if (down !== status.down) debugLog(down ? "banner shown" : "banner hidden", { ...shown });
    update({ down });
  }

  // ── Reading the inbox ───────────────────────────────────────────────────

  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function setInbox(state: ConnectionStatus) {
    if (state === "open" && status.inbox !== "open") {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => update({ inboxBackAt: null }), SETTLE_AFTER_RECONNECT_MS);
      update({ inbox: state, inboxBackAt: Date.now() });
    } else {
      update({ inbox: state });
    }
    reportInbox(state);
  }

  // Not connected until the stream says so. Its first opening counts as a
  // recovery: after a reload, answers sent meanwhile still have to arrive.
  update({ inbox: "reconnecting" });
  const unsubscribe = subscribeToMessages(
    pin,
    hostToken,
    (message) => {
      if (!stopped) options.onMessage(message);
    },
    setInbox,
    refused,
  );

  // ── Broadcasting ────────────────────────────────────────────────────────

  // The number of the latest snapshot (SessionSnapshot.seq). Based on the
  // clock, so that it keeps growing across a reload of the page, and on the
  // previous number, so that it does so even if the clock is set back.
  let lastSeq = options.seq ?? 0;
  const nextSeq = () => (lastSeq = Math.max(lastSeq + 1, Date.now()));

  let pendingBroadcast: ReturnType<typeof setTimeout> | null = null;
  // The broadcast under way, if any. There is only ever one: on a stalled
  // connection, more would pile up and then all arrive at once, the oldest
  // last.
  let broadcasting: AbortController | null = null;
  let broadcastAgain = false;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  function setBroadcast(state: ConnectionStatus) {
    update({ broadcast: state });
    reportBroadcast(state);
  }

  async function broadcastNow(): Promise<void> {
    // Whatever a scheduled broadcast was going to confirm is in this one.
    cancelPendingBroadcast();
    if (stopped) return;
    // A change made meanwhile goes out as soon as this broadcast is done, in
    // the snapshot built then.
    if (broadcasting) {
      broadcastAgain = true;
      return;
    }
    const controller = new AbortController();
    broadcasting = controller;
    slowTimer = setTimeout(() => update({ slow: true }), SLOW_BROADCAST_MS);
    const snapshot = { ...options.snapshot(), seq: nextSeq() };
    try {
      await publishState(pin, hostToken, snapshot, controller.signal);
      // Repeats collapse into one line, so an unchanged heartbeat costs nothing.
      debugLog("broadcast", { phase: snapshot.phase, q: snapshot.question_index, players: snapshot.players.length });
      setBroadcast("open");
    } catch (e) {
      // Canceled because the link has stopped: nothing to retry.
      if (controller.signal.aborted) return;
      if (e instanceof RelayError && e.status === 403) {
        refused();
        return;
      }
      console.warn("Snapshot broadcast failed", e);
      setBroadcast("reconnecting");
      scheduleBroadcast(BROADCAST_RETRY_MS);
    } finally {
      if (broadcasting === controller) {
        broadcasting = null;
        clearTimeout(slowTimer);
        update({ slow: false });
      }
    }
    if (broadcastAgain) {
      broadcastAgain = false;
      void broadcastNow();
    }
  }

  function scheduleBroadcast(delayMs = BROADCAST_THROTTLE_MS) {
    if (stopped || pendingBroadcast !== null) return;
    pendingBroadcast = setTimeout(() => void broadcastNow(), delayMs);
  }

  function cancelPendingBroadcast() {
    if (pendingBroadcast === null) return;
    clearTimeout(pendingBroadcast);
    pendingBroadcast = null;
  }

  const heartbeat = setInterval(() => void broadcastNow(), HEARTBEAT_MS);

  // ── Stopping ────────────────────────────────────────────────────────────

  function stop() {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    clearInterval(heartbeat);
    cancelPendingBroadcast();
    // Dropped, so that it cannot arrive after whatever comes next -- the end
    // of the session, say.
    broadcasting?.abort();
    broadcasting = null;
    broadcastAgain = false;
    clearTimeout(slowTimer);
    clearTimeout(settleTimer);
    reportInbox.cancel();
    reportBroadcast.cancel();
    showState({ inbox: "open", broadcast: "open" });
    update({ inbox: "open", broadcast: "open", slow: false, inboxBackAt: null });
  }

  function refused() {
    if (stopped) return;
    debugLog("session refused", { pin });
    stop();
    update({ refused: true });
  }

  function end(farewell?: SessionSnapshot) {
    // A refused token would be refused again.
    const refusedBefore = status.refused;
    stop();
    if (!refusedBefore) void sayFarewell(farewell && { ...farewell, seq: nextSeq() });
  }

  async function sayFarewell(farewell: SessionSnapshot | undefined) {
    if (farewell) {
      try {
        await publishState(pin, hostToken, farewell);
      } catch (e) {
        debugLog("farewell failed", { error: describeError(e) });
      }
    }
    await endSession(pin, hostToken).catch((e) => console.warn("Releasing the pin failed", e));
  }

  void broadcastNow();

  return {
    broadcastNow,
    broadcastSoon: () => scheduleBroadcast(),
    get seq() {
      return lastSeq;
    },
    stop,
    end,
  };
}
