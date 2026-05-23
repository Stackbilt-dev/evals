import { z } from 'zod';

export const EvalCaseSchema = z.object({
  id: z.string().uuid(),
  source_id: z.number().int().optional().describe('Row ID in the source system (for traceability)'),
  input: z.string().min(1).describe('Raw prompt or user message fed to the classifier'),
  expected: z.string().min(1).describe('Ground-truth label for this input'),
  metadata: z.record(z.unknown()).optional().describe('Arbitrary context (model, channel, executor, etc.)'),
});

export const EvalFailureSchema = z.object({
  case_id: z.string().uuid(),
  input: z.string(),
  expected: z.string(),
  actual: z.string(),
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
    p50_latency_ms: z.number().nonnegative(),
    p90_latency_ms: z.number().nonnegative(),
    p95_latency_ms: z.number().nonnegative(),
  }),
  failures: z.array(EvalFailureSchema),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalFailure = z.infer<typeof EvalFailureSchema>;
export type EvalRunReport = z.infer<typeof EvalRunReportSchema>;
