/**
 * Token bucket that paces outgoing requests to the source. It also supports a
 * global pause, used when the source answers 429 with Retry-After: the limit is
 * global on their side, so one 429 must stop every worker, not just the one
 * that received it.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private pausedUntil = 0;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst = Math.max(1, Math.floor(ratePerSecond)),
  ) {
    this.tokens = this.burst;
  }

  get isPaused(): boolean {
    return Date.now() < this.pausedUntil;
  }

  get pausedUntilMs(): number {
    return this.pausedUntil;
  }

  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    this.tokens = 0;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      if (now < this.pausedUntil) {
        await sleep(this.pausedUntil - now);
        continue;
      }
      this.refill(now);
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000));
    }
  }

  private refill(now: number): void {
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
    this.lastRefill = now;
  }
}

/** Limits the number of in-flight operations. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get inFlight(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      this.active += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
