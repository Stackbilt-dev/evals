import { z } from 'zod';

export const EvalCaseSchema = z.object({
  id: z.string().uuid(),
  source_id: z.number().int().optional().describe('Row ID in the source system (for traceability)'),
  input: z.string().min(1).describe('Raw prompt or user message fed to the classifier'),
  expected: z
    .unknown()
    .refine((value) => value !== undefined, 'expected is required')
    .describe('Ground-truth output for this input'),
  metadata: z.record(z.unknown()).optional().describe('Arbitrary context (model, channel, executor, etc.)'),
});

export const ScorerResultSchema = z.object({
  passed: z.boolean(),
  metrics: z.record(z.number().finite()).optional(),
  details: z.unknown().optional(),
  reason: z.string().optional(),
});

export const MetricSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  sum: z.number(),
  avg: z.number(),
  min: z.number(),
  max: z.number(),
});

export const EvalFailureSchema = z.object({
  case_id: z.string().uuid(),
  input: z.string(),
  expected: z.unknown(),
  actual: z.unknown(),
  score: ScorerResultSchema.optional(),
});

export const EvalRunReportSchema = z.object({
  run_id: z.string().uuid(),
  dataset: z.string().describe('Dataset name or path'),
  runner: z.string().describe('Runner identifier (e.g. classify-cast@1.37.0)'),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    accuracy: z.number().min(0).max(1),
    pass_rate: z.number().min(0).max(1),
    p50_latency_ms: z.number().nonnegative(),
    p90_latency_ms: z.number().nonnegative(),
    p95_latency_ms: z.number().nonnegative(),
    metrics: z.record(MetricSummarySchema).optional(),
  }),
  failures: z.array(EvalFailureSchema),
});

export type ScorerResult = z.infer<typeof ScorerResultSchema>;
export type MetricSummary = z.infer<typeof MetricSummarySchema>;
export type EvalCase<TExpected = unknown> = Omit<z.infer<typeof EvalCaseSchema>, 'expected'> & {
  expected: TExpected;
};
export type EvalFailure<TExpected = unknown, TActual = unknown> =
  Omit<z.infer<typeof EvalFailureSchema>, 'expected' | 'actual'> & {
    expected: TExpected;
    actual: TActual;
  };
export type EvalRunReport = z.infer<typeof EvalRunReportSchema>;
