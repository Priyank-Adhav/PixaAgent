import { describe, it, expect } from "vitest";
import { startIndexingMetrics, formatIndexingMetrics } from "../src/indexer/indexingMetrics";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function blockFor(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait: simulates a synchronous JSON.stringify / readFileSync stall
  }
}

describe("startIndexingMetrics", () => {
  it("records a synchronous stall as event-loop lag", async () => {
    const recorder = startIndexingMetrics();
    await sleep(30);
    blockFor(250);
    await sleep(30);
    const m = recorder.stop();
    expect(m.lagMaxMs).toBeGreaterThanOrEqual(150);
    expect(m.durationMs).toBeGreaterThanOrEqual(250);
  });

  it("reports little lag when the loop stays free", async () => {
    const recorder = startIndexingMetrics();
    await sleep(100);
    const m = recorder.stop();
    expect(m.lagMaxMs).toBeLessThan(100);
  });

  it("stop is idempotent", async () => {
    const recorder = startIndexingMetrics();
    await sleep(20);
    const first = recorder.stop();
    await sleep(20);
    expect(recorder.stop()).toBe(first);
  });

  it("formats a readable summary", () => {
    expect(formatIndexingMetrics({ durationMs: 1200, lagP50Ms: 1, lagP99Ms: 40, lagMaxMs: 310 })).toBe(
      "took 1200ms; event-loop lag p50=1ms p99=40ms max=310ms"
    );
  });
});
