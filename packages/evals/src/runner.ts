import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { EvalCaseSchema, EvalRunReportSchema } from './types.js';
import type { EvalCase, EvalFailure, EvalRunReport } from './types.js';

export type { EvalCase, EvalFailure, EvalRunReport };

// ── Scorer ────────────────────────────────────────────────────────────────────

/** A scorer takes a single eval case + the actual output and returns pass/fail. */
export type Scorer = (c: EvalCase, actual: string) => boolean;

/** Default scorer: exact string equality. */
export const exactMatch: Scorer = (c, actual) => c.expected === actual;

/** Case-insensitive exact match. */
export const exactMatchCI: Scorer = (c, actual) =>
  c.expected.toLowerCase() === actual.toLowerCase().trim();

// ── Target ────────────────────────────────────────────────────────────────────

/** A target is the system under test. Takes an input, returns a label. */
export type Target = (input: string) => Promise<string>;

// ── Dataset loader ────────────────────────────────────────────────────────────

export async function loadDataset(pathOrLines: string | string[]): Promise<EvalCase[]> {
  if (Array.isArray(pathOrLines)) {
    return pathOrLines.map((line) => EvalCaseSchema.parse(JSON.parse(line)));
  }

  const cases: EvalCase[] = [];
  const rl = createInterface({ input: createReadStream(pathOrLines), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    cases.push(EvalCaseSchema.parse(JSON.parse(line)));
  }
  return cases;
}

// ── Percentile ────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ── Runner ────────────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Runner identifier shown in the report (e.g. 'classify-cast@1.37.0') */
  runner?: string;
  /** Scorer function. Defaults to exactMatch. */
  scorer?: Scorer;
  /** Concurrency limit. Defaults to 1 (serial). */
  concurrency?: number;
  /** Progress callback — called after each case. */
  onProgress?: (done: number, total: number) => void;
}

export async function runEval(
  dataset: EvalCase[],
  target: Target,
  datasetName: string,
  options: RunOptions = {},
): Promise<EvalRunReport> {
  const {
    runner = 'unknown',
    scorer = exactMatch,
    concurrency = 1,
    onProgress,
  } = options;

  const startedAt = new Date().toISOString();
  const failures: EvalFailure[] = [];
  const latencies: number[] = [];
  let passed = 0;

  // Serial or bounded-concurrency execution
  const queue = [...dataset];
  let done = 0;

  async function runCase(c: EvalCase): Promise<void> {
    const t0 = Date.now();
    const actual = await target(c.input);
    latencies.push(Date.now() - t0);

    if (scorer(c, actual)) {
      passed++;
    } else {
      failures.push({ case_id: c.id, input: c.input, expected: c.expected, actual });
    }
    done++;
    onProgress?.(done, dataset.length);
  }

  if (concurrency <= 1) {
    for (const c of queue) await runCase(c);
  } else {
    // Bounded concurrency pool
    const pool: Promise<void>[] = [];
    for (const c of queue) {
      if (pool.length >= concurrency) await Promise.race(pool);
      const p = runCase(c).then(() => { pool.splice(pool.indexOf(p), 1); });
      pool.push(p);
    }
    await Promise.all(pool);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const total = dataset.length;

  return EvalRunReportSchema.parse({
    run_id: randomUUID(),
    dataset: datasetName,
    runner,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    summary: {
      total,
      passed,
      failed: total - passed,
      accuracy: total === 0 ? 0 : passed / total,
      p50_latency_ms: percentile(sorted, 50),
      p90_latency_ms: percentile(sorted, 90),
      p95_latency_ms: percentile(sorted, 95),
    },
    failures,
  });
}
