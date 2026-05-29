import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { EvalCaseSchema, EvalRunReportSchema, ScorerResultSchema } from './types.js';
import type { EvalCase, EvalFailure, EvalRunReport, MetricSummary, ScorerResult } from './types.js';

export type { EvalCase, EvalFailure, EvalRunReport, MetricSummary, ScorerResult };

// ── Scorer ────────────────────────────────────────────────────────────────────

/** A scorer takes a single eval case + the actual output and returns pass/fail plus optional metrics. */
export type ScorerValue = boolean | ScorerResult;
export type Scorer<TActual = string, TExpected = TActual> = (
  c: EvalCase<TExpected>,
  actual: TActual,
) => ScorerValue | Promise<ScorerValue>;

/** Default scorer: exact value equality. */
export const exactMatch: Scorer<unknown, unknown> = (c, actual) => Object.is(c.expected, actual);

/** Case-insensitive exact match. */
export const exactMatchCI: Scorer<unknown, unknown> = (c, actual) =>
  typeof c.expected === 'string' &&
  typeof actual === 'string' &&
  c.expected.toLowerCase() === actual.toLowerCase().trim();

// ── Target ────────────────────────────────────────────────────────────────────

/** A target is the system under test. Takes an input, returns an eval output. */
export type Target<TActual = string> = (input: string) => Promise<TActual>;

// ── Dataset loader ────────────────────────────────────────────────────────────

export async function loadDataset<TExpected = unknown>(
  pathOrLines: string | string[],
): Promise<EvalCase<TExpected>[]> {
  if (Array.isArray(pathOrLines)) {
    return pathOrLines.map((line) => EvalCaseSchema.parse(JSON.parse(line)) as EvalCase<TExpected>);
  }

  const cases: EvalCase<TExpected>[] = [];
  const rl = createInterface({ input: createReadStream(pathOrLines), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    cases.push(EvalCaseSchema.parse(JSON.parse(line)) as EvalCase<TExpected>);
  }
  return cases;
}

// ── Percentile ────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function normalizeScorerResult(result: ScorerValue): ScorerResult {
  return typeof result === 'boolean' ? { passed: result } : ScorerResultSchema.parse(result);
}

function summarizeMetrics(metricValues: Map<string, number[]>): Record<string, MetricSummary> | undefined {
  const summary: Record<string, MetricSummary> = {};

  for (const [name, values] of metricValues.entries()) {
    if (values.length === 0) continue;
    const sum = values.reduce((total, value) => total + value, 0);
    summary[name] = {
      count: values.length,
      sum,
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

// ── Runner ────────────────────────────────────────────────────────────────────

export interface RunOptions<TActual = string, TExpected = TActual> {
  /** Runner identifier shown in the report (e.g. 'classify-cast@1.37.0') */
  runner?: string;
  /** Scorer function. Defaults to exactMatch. May return pass/fail or detailed metrics. */
  scorer?: Scorer<TActual, TExpected>;
  /** Concurrency limit. Defaults to 1 (serial). */
  concurrency?: number;
  /** Progress callback — called after each case. */
  onProgress?: (done: number, total: number) => void;
}

export async function runEval<TActual = string, TExpected = TActual>(
  dataset: EvalCase<TExpected>[],
  target: Target<TActual>,
  datasetName: string,
  options: RunOptions<TActual, TExpected> = {},
): Promise<EvalRunReport> {
  const {
    runner = 'unknown',
    scorer = exactMatch as Scorer<TActual, TExpected>,
    concurrency = 1,
    onProgress,
  } = options;

  const startedAt = new Date().toISOString();
  const failures: EvalFailure<TExpected, TActual>[] = [];
  const latencies: number[] = [];
  const metricValues = new Map<string, number[]>();
  let passed = 0;

  // Serial or bounded-concurrency execution
  const queue: EvalCase<TExpected>[] = [...dataset];
  let done = 0;

  async function runCase(c: EvalCase<TExpected>): Promise<void> {
    const t0 = Date.now();
    const actual = await target(c.input);
    latencies.push(Date.now() - t0);

    const score = normalizeScorerResult(await scorer(c, actual));
    if (score.metrics) {
      for (const [name, value] of Object.entries(score.metrics)) {
        const values = metricValues.get(name) ?? [];
        values.push(value);
        metricValues.set(name, values);
      }
    }

    if (score.passed) {
      passed++;
    } else {
      failures.push({ case_id: c.id, input: c.input, expected: c.expected, actual, score });
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
      pass_rate: total === 0 ? 0 : passed / total,
      p50_latency_ms: percentile(sorted, 50),
      p90_latency_ms: percentile(sorted, 90),
      p95_latency_ms: percentile(sorted, 95),
      metrics: summarizeMetrics(metricValues),
    },
    failures,
  });
}
