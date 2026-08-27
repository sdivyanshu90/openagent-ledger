import { describe, expect, it } from "vitest";
import { scenarios } from "./fixtures";
import { compareRuns, evaluate } from "./evaluation";
import type { Run } from "./schemas";

describe("evaluation", () => {
  it("provides evidence for unsafe tool selection", () => {
    const result = evaluate(scenarios[0]!, ["delete_issue"], false);
    expect(result.score).toBe(40);
    expect(result.findings[0]).toMatchObject({
      category: "tool-selection",
      severity: "critical",
    });
    expect(result.findings[0]!.evidence).toContain("explicitly forbidden");
  });

  it("compares scores without manufacturing a verdict", () => {
    const base = { id: "a", score: 40 } as Run;
    const current = { id: "b", score: 90 } as Run;
    expect(compareRuns(base, current)).toMatchObject({
      delta: 50,
      result: "improvement",
    });
  });
});
