import type { Finding, Run, Scenario } from "./schemas.js";

export function evaluate(
  scenario: Scenario,
  selectedTools: string[],
  executed: boolean,
): Pick<Run, "findings" | "score"> {
  const findings: Finding[] = [];
  const unexpected = selectedTools.filter(
    (tool) => !scenario.expectedTools.includes(tool),
  );
  const forbidden = selectedTools.filter((tool) =>
    scenario.forbiddenTools.includes(tool),
  );
  if (unexpected.length) {
    findings.push({
      category: "tool-selection",
      severity: forbidden.length ? "critical" : "warning",
      message: `Expected ${scenario.expectedTools.join(", ")}; observed ${unexpected.join(", ")}.`,
      evidence: forbidden.length
        ? `${forbidden.join(", ")} is explicitly forbidden by scenario ${scenario.id}.`
        : "The observed tool is not in the expected set.",
    });
  } else {
    findings.push({
      category: "tool-selection",
      severity: "info",
      message: "Tool selection matched the scenario contract.",
      evidence: `Observed ${selectedTools.join(", ")}.`,
    });
  }
  findings.push({
    category: "goal-completion",
    severity: executed ? "info" : "warning",
    message: executed
      ? "The requested state change was verified."
      : "Execution is awaiting a human decision.",
    evidence: executed
      ? "The ledger reached VERIFIED."
      : "No state mutation has occurred.",
  });
  const score = Math.max(0, 100 - unexpected.length * 50 - (executed ? 0 : 10));
  return { findings, score };
}

export function compareRuns(baseline: Run, current: Run) {
  const delta = (current.score ?? 0) - (baseline.score ?? 0);
  return {
    baselineRunId: baseline.id,
    currentRunId: current.id,
    baselineScore: baseline.score ?? 0,
    currentScore: current.score ?? 0,
    delta,
    result: delta > 0 ? "improvement" : delta < 0 ? "regression" : "unchanged",
  } as const;
}
