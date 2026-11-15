import {setTimeout as sleep} from 'node:timers/promises';

// OpenCode can return a provider error inside an otherwise successful HTTP reply.
export function rateLimit(error) {
  const pending = [error], seen = new Set();
  for (let n = 0; n < pending.length && n < 12; n++) {
    const value = pending[n];
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const data = value.data ?? value;
    if (Number(data.statusCode ?? data.status) === 429) return {headers: data.responseHeaders ?? value.headers ?? {}};
    pending.push(value.cause, value.error);
    try { pending.push(JSON.parse(value.message)); } catch {}
  }
}

export function retryDelay(headers, attempt, now = Date.now(), random = Math.random()) {
  const values = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const milliseconds = Number(values['retry-after-ms']);
  if (values['retry-after-ms'] !== undefined && Number.isFinite(milliseconds) && milliseconds >= 0) return Math.max(100, Math.ceil(milliseconds));
  const value = values['retry-after'];
  if (value !== undefined) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(100, Math.ceil(seconds * 1000));
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(100, date - now);
  }
  const base = Math.min(60000, 2000 * 2 ** Math.min(attempt - 1, 8));
  return Math.min(60000, Math.ceil(base * (1 + random * 0.25)));
}

export async function waitUntil(deadline, signal) {
  signal.throwIfAborted();
  while (Date.now() < deadline) await sleep(Math.min(deadline - Date.now(), 30000), undefined, {signal});
  signal.throwIfAborted();
}

// One FIFO per run. A 429 cools down sibling requests too, rather than releasing
// all workers in a burst when the first timer expires. The RPM cap is optional.
export class ModelGate {
  constructor(requestsPerMinute) {
    this.spacing = requestsPerMinute ? Math.ceil(60000 / requestsPerMinute) : 0;
    this.next = 0; this.cooldown = 0; this.tail = Promise.resolve();
  }
  deferUntil(deadline) { this.cooldown = Math.max(this.cooldown, deadline); }
  async wait(signal) {
    do { await waitUntil(this.cooldown, signal); } while (Date.now() < this.cooldown);
  }
  acquire(signal) {
    const next = this.tail.then(async () => {
      for (;;) {
        const deadline = Math.max(this.next, this.cooldown);
        await waitUntil(deadline, signal);
        if (Date.now() >= Math.max(this.next, this.cooldown)) break;
      }
      this.next = Date.now() + this.spacing;
    });
    this.tail = next.catch(() => {});
    return next;
  }
}
