import { z } from 'zod';
import { EvalRunReportSchema } from './types.js';
import type { EvalRunReport } from './types.js';

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const DigestSchema = z.string().regex(SHA256_HEX, 'expected a lowercase SHA-256 hex digest');

export const EvaluationGateSchema = z.object({
  /** Deployment is a policy decision, deliberately separate from eval pass/fail. */
  decision: z.enum(['allow', 'block', 'review']),
  policy: z.string().min(1),
  reasons: z.array(z.string().min(1)).default([]),
});

export const EvaluationReceiptSchema = z.object({
  schema_version: z.literal('evaluation-receipt.v1'),
  receipt_id: z.string().uuid(),
  issued_at: z.string().datetime(),
  evaluation: z.object({
    name: z.string().min(1),
    version: z.string().min(1).optional(),
    dataset_digest: DigestSchema,
    rubric_digest: DigestSchema.optional(),
  }),
  subject: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    artifact_digest: DigestSchema.optional(),
  }),
  report: z.object({
    run_id: z.string().uuid(),
    digest: DigestSchema,
    started_at: z.string().datetime(),
    finished_at: z.string().datetime(),
    summary: EvalRunReportSchema.shape.summary,
  }),
  runner: z.string().min(1),
  gate: EvaluationGateSchema,
  evidence_refs: z.array(z.object({
    kind: z.string().min(1),
    uri: z.string().min(1),
    digest: DigestSchema.optional(),
  })).optional(),
});

export const EvaluationReceiptArtifactSchema = z.object({
  receipt: EvaluationReceiptSchema,
  digest: DigestSchema,
});

export type EvaluationGate = z.infer<typeof EvaluationGateSchema>;
export type EvaluationReceipt = z.infer<typeof EvaluationReceiptSchema>;
export type EvaluationReceiptArtifact = z.infer<typeof EvaluationReceiptArtifactSchema>;

export interface CreateEvaluationReceiptOptions {
  evaluation: {
    name: string;
    version?: string;
    datasetDigest: string;
    rubricDigest?: string;
  };
  subject: {
    name: string;
    version: string;
    artifactDigest?: string;
  };
  gate: EvaluationGate;
  evidenceRefs?: Array<{ kind: string; uri: string; digest?: string }>;
  /** Injectable for deterministic tests and offline reproducibility. */
  receiptId?: string;
  issuedAt?: string;
}

/**
 * Canonical JSON for content addressing. Object keys are sorted recursively;
 * array order is preserved because eval cases and evidence lists are ordered.
 */
export function canonicalStringify(value: unknown): string {
  const canonicalize = (current: unknown): unknown => {
    if (current === null || typeof current !== 'object') return current;
    if (Array.isArray(current)) return current.map(canonicalize);

    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(current as Record<string, unknown>).sort()) {
      const item = (current as Record<string, unknown>)[key];
      if (item !== undefined) sorted[key] = canonicalize(item);
    }
    return sorted;
  };

  return JSON.stringify(canonicalize(value));
}

export async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalStringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Produce a public-safe, content-addressed receipt from a private eval report.
 * Raw cases and failure payloads are intentionally excluded from the receipt.
 */
export async function createEvaluationReceipt(
  rawReport: EvalRunReport,
  options: CreateEvaluationReceiptOptions,
): Promise<EvaluationReceiptArtifact> {
  const report = EvalRunReportSchema.parse(rawReport);
  const reportDigest = await sha256Canonical(report);

  const receipt = EvaluationReceiptSchema.parse({
    schema_version: 'evaluation-receipt.v1',
    receipt_id: options.receiptId ?? crypto.randomUUID(),
    issued_at: options.issuedAt ?? new Date().toISOString(),
    evaluation: {
      name: options.evaluation.name,
      version: options.evaluation.version,
      dataset_digest: options.evaluation.datasetDigest,
      rubric_digest: options.evaluation.rubricDigest,
    },
    subject: {
      name: options.subject.name,
      version: options.subject.version,
      artifact_digest: options.subject.artifactDigest,
    },
    report: {
      run_id: report.run_id,
      digest: reportDigest,
      started_at: report.started_at,
      finished_at: report.finished_at,
      summary: report.summary,
    },
    runner: report.runner,
    gate: options.gate,
    evidence_refs: options.evidenceRefs,
  });

  return EvaluationReceiptArtifactSchema.parse({
    receipt,
    digest: await sha256Canonical(receipt),
  });
}

export async function verifyEvaluationReceiptArtifact(
  artifact: EvaluationReceiptArtifact,
): Promise<boolean> {
  const parsed = EvaluationReceiptArtifactSchema.safeParse(artifact);
  if (!parsed.success) return false;
  return (await sha256Canonical(parsed.data.receipt)) === parsed.data.digest;
}

/** Shape-compatible input for @stackbilt/audit-chain writeRecord(). */
export function toEvaluationAuditEvent(
  artifact: EvaluationReceiptArtifact,
  options: { namespace: string; actor: string },
): {
  namespace: string;
  event_type: 'evaluation.receipt.issued';
  actor: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const parsed = EvaluationReceiptArtifactSchema.parse(artifact);
  const { receipt, digest } = parsed;

  return {
    namespace: options.namespace,
    event_type: 'evaluation.receipt.issued',
    actor: options.actor,
    payload: {
      schema_version: receipt.schema_version,
      receipt_id: receipt.receipt_id,
      receipt_digest: digest,
      evaluation: receipt.evaluation,
      subject: receipt.subject,
      report: receipt.report,
      gate: receipt.gate,
    },
    metadata: {
      run_id: receipt.report.run_id,
      runner: receipt.runner,
    },
  };
}
