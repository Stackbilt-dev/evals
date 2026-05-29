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

`expected` may be any JSON value. Classification datasets usually store a
string label; structured-output datasets can store objects or arrays.

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

## Structured outputs

Targets can return typed objects, and scorers can return metric details in
addition to pass/fail.

```typescript
import { runEval, type EvalCase, type ScorerResult } from '@stackbilt/evals';

type Plan = {
  meals: string[];
  shoppingList: string[];
};

const dataset: EvalCase<Plan>[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    input: 'make a simple plan',
    expected: { meals: ['oats'], shoppingList: ['oats'] },
  },
];

const report = await runEval(dataset, async (): Promise<Plan> => {
  return { meals: ['oats'], shoppingList: ['oats', 'berries'] };
}, 'synthetic-plan', {
  scorer: (c, actual): ScorerResult => {
    const shoppingCoverage =
      c.expected.shoppingList.filter((item) => actual.shoppingList.includes(item)).length /
      c.expected.shoppingList.length;

    return {
      passed: shoppingCoverage >= 1,
      metrics: { shopping_coverage: shoppingCoverage },
    };
  },
});

console.log(report.summary.pass_rate);
console.log(report.summary.metrics?.shopping_coverage?.avg);
```

## OSS/private boundary

This repository carries generic eval primitives, runner behavior, public schemas,
and synthetic examples only.

Product-specific prompts, private corpora, golden cases, benchmark evidence,
competitive outputs, and scoring weights belong in private product repos. Keep
those datasets out of this package and publish only sanitized or synthetic
fixtures here.

## License

Apache-2.0
