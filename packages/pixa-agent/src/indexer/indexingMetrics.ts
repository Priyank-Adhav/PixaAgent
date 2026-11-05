import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Event-loop responsiveness during an indexing run. Lag is how late timers
 * fire: a 300ms lagMax means the extension host could not respond to
 * anything (commands, chat, other extensions) for ~300ms at least once.
 */
export interface IndexingMetrics {
  durationMs: number;
  lagP50Ms: number;
  lagP99Ms: number;
  lagMaxMs: number;
}

export interface IndexingMetricsRecorder {
  /** Stops sampling and returns the result. Safe to call more than once. */
  stop(): IndexingMetrics;
}

const NS_PER_MS = 1e6;

/** Starts sampling event-loop delay. Node-only — no vscode dependency. */
export function startIndexingMetrics(resolutionMs = 10): IndexingMetricsRecorder {
  const histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  const start = performance.now();
  histogram.enable();
  let result: IndexingMetrics | null = null;

  return {
    stop(): IndexingMetrics {
      if (result) return result;
      histogram.disable();
      // The histogram includes the sampling resolution itself; subtract it so
      // an idle loop reports ~0 rather than ~resolutionMs.
      const lag = (ns: number) => Math.max(0, Math.round(ns / NS_PER_MS - resolutionMs));
      const sampled = histogram.count > 0;
      result = {
        durationMs: Math.round(performance.now() - start),
        lagP50Ms: sampled ? lag(histogram.percentile(50)) : 0,
        lagP99Ms: sampled ? lag(histogram.percentile(99)) : 0,
        lagMaxMs: sampled ? lag(histogram.max) : 0,
      };
      return result;
    },
  };
}

export function formatIndexingMetrics(m: IndexingMetrics): string {
  return `took ${m.durationMs}ms; event-loop lag p50=${m.lagP50Ms}ms p99=${m.lagP99Ms}ms max=${m.lagMaxMs}ms`;
}
