import { describe, expect, it } from 'vitest';
import { exactMatch, loadDataset, runEval } from './runner.js';
import { EvalCaseSchema } from './types.js';
import type { EvalCase, ScorerResult } from './types.js';

describe('runEval', () => {
  it('keeps exact-match classification evals working', async () => {
    const dataset: EvalCase<string>[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        input: 'route to sales',
        expected: 'sales',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        input: 'route to support',
        expected: 'support',
      },
    ];

    const report = await runEval(dataset, async (input) => {
      return input.includes('sales') ? 'sales' : 'support';
    }, 'synthetic-classify', {
      runner: 'test-runner',
      scorer: exactMatch,
    });

    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.accuracy).toBe(1);
    expect(report.summary.pass_rate).toBe(1);
    expect(report.failures).toEqual([]);
  });

  it('supports structured outputs with custom scorer metrics', async () => {
    type MealPlan = {
      days: Array<{ meals: string[] }>;
      shoppingList: string[];
    };

    const expected: MealPlan = {
      days: [{ meals: ['oats', 'salad'] }],
      shoppingList: ['oats', 'greens'],
    };
    const actual: MealPlan = {
      days: [{ meals: ['oats', 'salad'] }],
      shoppingList: ['oats', 'greens', 'berries'],
    };
    const dataset: EvalCase<MealPlan>[] = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        input: 'make a one day meal plan',
        expected,
      },
    ];

    const report = await runEval(dataset, async () => actual, 'synthetic-structured', {
      scorer: (c, output): ScorerResult => {
        const mealCoverage = output.days[0]?.meals.length === c.expected.days[0]?.meals.length ? 1 : 0;
        const shoppingCoverage =
          c.expected.shoppingList.filter((item) => output.shoppingList.includes(item)).length /
          c.expected.shoppingList.length;

        return {
          passed: mealCoverage === 1 && shoppingCoverage >= 1,
          metrics: {
            meal_coverage: mealCoverage,
            shopping_coverage: shoppingCoverage,
          },
        };
      },
    });

    expect(report.summary.passed).toBe(1);
    expect(report.summary.metrics?.meal_coverage).toEqual({
      count: 1,
      sum: 1,
      avg: 1,
      min: 1,
      max: 1,
    });
    expect(report.summary.metrics?.shopping_coverage?.avg).toBe(1);
  });

  it('records structured failures with scorer details', async () => {
    const dataset: EvalCase<{ answer: string }>[] = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        input: 'return a structured answer',
        expected: { answer: 'yes' },
      },
    ];

    const report = await runEval(dataset, async () => ({ answer: 'no' }), 'synthetic-failure', {
      scorer: () => ({
        passed: false,
        metrics: { answer_match: 0 },
        reason: 'answer did not match',
        details: { field: 'answer' },
      }),
    });

    expect(report.summary.failed).toBe(1);
    expect(report.summary.metrics?.answer_match?.avg).toBe(0);
    expect(report.failures[0]).toMatchObject({
      case_id: '44444444-4444-4444-8444-444444444444',
      expected: { answer: 'yes' },
      actual: { answer: 'no' },
      score: {
        passed: false,
        reason: 'answer did not match',
      },
    });
  });
});

describe('loadDataset', () => {
  it('loads structured expected values from jsonl lines', async () => {
    const dataset = await loadDataset<{ answer: string }>([
      JSON.stringify({
        id: '55555555-5555-4555-8555-555555555555',
        input: 'structured case',
        expected: { answer: 'yes' },
      }),
    ]);

    expect(dataset[0]?.expected.answer).toBe('yes');
  });

  it('rejects cases without expected output', () => {
    expect(() =>
      EvalCaseSchema.parse({
        id: '66666666-6666-4666-8666-666666666666',
        input: 'missing expected',
      }),
    ).toThrow(/expected is required/);
  });
});
