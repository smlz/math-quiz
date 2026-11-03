// Only one tab may host a quiz. A second tab on the host page restores the
// same session from localStorage, and its heartbeats would then tell players
// a state that has long moved on, with numbers just as new as the real ones.
//
// A Web Lock is what says which tab it is: the browser releases it when a tab
// closes or crashes, so nothing has to be cleaned up or timed out by hand.

import { debugLog, describeError } from "../debug/debugLog";

/** How long a tab waits for the lock. A page being reloaded may hold it for a
 * moment after its replacement has started. */
const WAIT_MS = 2000;

export interface HostLock {
  release(): void;
}

/** Resolves to the lock once this tab holds it, or to null if another tab has
 * kept it. `steal` takes it from whichever tab has it, without waiting.
 * `onLost` hears that another tab has stolen the lock from this one.
 *
 * Without Web Locks (an old browser, a page not on https) every tab counts as
 * holding it, which is how it was before. */
export function acquireHostLock(pin: string, onLost: () => void, steal = false): Promise<HostLock | null> {
  const noLock: HostLock = { release() {} };
  if (!navigator.locks) return Promise.resolve(noLock);
  return new Promise((resolve) => {
    const waiting = new AbortController();
    const timer = steal ? undefined : setTimeout(() => waiting.abort(), WAIT_MS);
    let held = false;
    let release = () => {};
    const released = new Promise<void>((done) => (release = done));
    navigator.locks
      .request(`math-quiz-host:${pin}`, steal ? { steal: true } : { signal: waiting.signal }, () => {
        held = true;
        clearTimeout(timer);
        resolve({ release });
        return released;
      })
      .catch((e) => {
        clearTimeout(timer);
        if (held) onLost();
        else if (waiting.signal.aborted) resolve(null);
        else {
          debugLog("host lock failed", { error: describeError(e) });
          resolve(noLock);
        }
      });
  });
}
