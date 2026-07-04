import { describe, expect, it } from "vitest";
import {
  computeHealthScore,
  coverageSubscore,
  duplicationSubscore,
  freshnessSubscore,
  qualitySubscore,
  riskSubscore,
} from "../src/health";
import type { HealthSubscores } from "../src/schemas/report";

describe("computeHealthScore", () => {
  const cases: {
    name: string;
    subscores: HealthSubscores;
    expected: number;
  }[] = [
    {
      name: "all subscores 100 → 100",
      subscores: {
        freshness: 100,
        duplication: 100,
        quality: 100,
        risk: 100,
        coverage: 100,
      },
      expected: 100,
    },
    {
      name: "all subscores 0 → 0",
      subscores: {
        freshness: 0,
        duplication: 0,
        quality: 0,
        risk: 0,
        coverage: 0,
      },
      expected: 0,
    },
    {
      name: "weighted mix with all measured",
      subscores: {
        freshness: 100,
        duplication: 50,
        quality: 50,
        risk: 0,
        coverage: 100,
      },
      // 0.3*100 + 0.2*50 + 0.2*50 + 0.1*0 + 0.2*100 = 70
      expected: 70,
    },
    {
      name: "null freshness and coverage redistribute weight proportionally",
      subscores: {
        freshness: null,
        duplication: 80,
        quality: 60,
        risk: 100,
        coverage: null,
      },
      // (0.2*80 + 0.2*60 + 0.1*100) / 0.5 = 76
      expected: 76,
    },
    {
      name: "null coverage only",
      subscores: {
        freshness: 40,
        duplication: 100,
        quality: 100,
        risk: 100,
        coverage: null,
      },
      // (0.3*40 + 0.2*100 + 0.2*100 + 0.1*100) / 0.8 = 77.5 → 78
      expected: 78,
    },
    {
      name: "rounds to nearest integer",
      subscores: {
        freshness: 33,
        duplication: 33,
        quality: 33,
        risk: 33,
        coverage: 33,
      },
      expected: 33,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(computeHealthScore(testCase.subscores)).toBe(testCase.expected);
    });
  }
});

describe("subscore formulas", () => {
  it("freshness = 100 − min(100, stale_pct*2)", () => {
    expect(freshnessSubscore(0)).toBe(100);
    expect(freshnessSubscore(10)).toBe(80);
    expect(freshnessSubscore(50)).toBe(0);
    expect(freshnessSubscore(90)).toBe(0);
  });

  it("duplication = 100 − min(100, (exact+near)*2.5)", () => {
    expect(duplicationSubscore(0, 0)).toBe(100);
    expect(duplicationSubscore(10, 0)).toBe(75);
    expect(duplicationSubscore(10, 5)).toBe(62.5);
    expect(duplicationSubscore(30, 30)).toBe(0);
  });

  it("quality = 100 − min(100, thin_pct*2)", () => {
    expect(qualitySubscore(0)).toBe(100);
    expect(qualitySubscore(8)).toBe(84);
    expect(qualitySubscore(60)).toBe(0);
  });

  it("risk = 100 − 25/critical − 5/warning, floor 0", () => {
    expect(riskSubscore(0, 0)).toBe(100);
    expect(riskSubscore(1, 2)).toBe(65);
    expect(riskSubscore(2, 0)).toBe(50);
    expect(riskSubscore(5, 0)).toBe(0);
    expect(riskSubscore(0, 25)).toBe(0);
  });

  it("coverage = passed/total*100, null when no tests", () => {
    expect(coverageSubscore(3, 4)).toBe(75);
    expect(coverageSubscore(0, 4)).toBe(0);
    expect(coverageSubscore(4, 4)).toBe(100);
    expect(coverageSubscore(0, 0)).toBeNull();
  });
});
