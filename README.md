# @stackbilt/evals

Edge-native evaluation framework for AI agents and classifiers.

Built to solve the gap between production agent telemetry and verifiable accuracy numbers — specifically for systems running on Cloudflare Workers with service bindings, streaming dispatch, and multi-executor pipelines.

## Why

Existing eval frameworks (OpenAI Evals, lm-evaluation-harness, Promptfoo) assume Python runtimes or synchronous REST APIs. They don't model:

- Service binding invocation (zero-HTTP classification)
- Multi-executor dispatch pipelines
- Sub-50ms CPU budgets on Workers

This repo provides the dataset format and runner protocol. Adapters for specific systems (classify-cast, BizOps, etc.) live in their respective private repos.

## Packages

| Package | Description |
|---|---|
| `@stackbilt/evals` | Core schemas (Zod) + async runner |

## Dataset format

`.jsonl` — one `EvalCase` per line:

```json
{"id":"uuid","input":"user message","expected":"intent_class"}
```

## Quick start

```bash
npm install @stackbilt/evals
```

```typescript
import { loadDataset, runEval, exactMatch } from '@stackbilt/evals';

const dataset = await loadDataset('./datasets/classify-cast.jsonl');

const report = await runEval(
  dataset,
  async (input) => myClassifier(input),  // your target
  'classify-cast',
  { runner: 'classify-cast@1.37.0', scorer: exactMatch }
);

console.log(`Accuracy: ${(report.summary.accuracy * 100).toFixed(1)}%`);
console.log(`p50: ${report.summary.p50_latency_ms}ms`);
```

## License

Apache-2.0
