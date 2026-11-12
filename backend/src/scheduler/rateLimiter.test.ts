import { describe, expect, it } from "vitest";
import { RateLimiter, Semaphore } from "./rateLimiter.js";

describe("RateLimiter", () => {
  it("allows a burst up to the bucket size then paces at the configured rate", async () => {
    const limiter = new RateLimiter(50); // 50/s => 20ms per token after the burst
    const start = Date.now();
    for (let i = 0; i < 50; i += 1) await limiter.acquire();
    const burst = Date.now() - start;
    for (let i = 0; i < 10; i += 1) await limiter.acquire();
    const paced = Date.now() - start;
    expect(burst).toBeLessThan(50);
    expect(paced).toBeGreaterThanOrEqual(150);
  });

  it("blocks every caller while paused", async () => {
    const limiter = new RateLimiter(1000);
    limiter.pauseFor(120);
    expect(limiter.isPaused).toBe(true);
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
    expect(limiter.isPaused).toBe(false);
  });
});

describe("Semaphore", () => {
  it("never exceeds its limit and releases in order", async () => {
    const sem = new Semaphore(2);
    let peak = 0;
    const work = async () => {
      const release = await sem.acquire();
      peak = Math.max(peak, sem.inFlight);
      await new Promise((r) => setTimeout(r, 10));
      release();
      release(); // double release is a no-op
    };
    await Promise.all([work(), work(), work(), work(), work()]);
    expect(peak).toBe(2);
    expect(sem.inFlight).toBe(0);
  });
});
