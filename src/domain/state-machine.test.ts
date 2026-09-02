import { describe, expect, it } from "vitest";
import { seedDatabase } from "./fixtures";
import type { LedgerEntry } from "./schemas";
import { getToolContract } from "./tool-registry";
import {
  canTransition,
  InvalidTransitionError,
  transition,
} from "./state-machine";

function proposed(): LedgerEntry {
  const issue = seedDatabase().issues[0]!;
  const tool = getToolContract("ambiguous", "close_issue")!;
  return {
    id: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    scenarioId: "test",
    sessionId: "00000000-0000-4000-8000-000000000003",
    actor: "test-agent",
    tool: tool.name,
    toolVersion: "1",
    schemaFingerprint: "schema",
    createdAt: new Date().toISOString(),
    arguments: { issueId: issue.id },
    reason: "test transition",
    risk: "medium",
    affectedResources: [`issue:${issue.id}`],
    sideEffects: tool.sideEffects,
    reversible: true,
    confirmation: "required",
    preview: {
      before: issue,
      after: { ...issue, status: "closed" },
      resourceRevision: 1,
    },
    state: "PROPOSED",
    transitions: [],
    correlationId: "00000000-0000-4000-8000-000000000004",
    traceId: "00000000-0000-4000-8000-000000000005",
    previousHash: "GENESIS",
    integrityHash: "entry-hash",
  };
}

describe("ledger state machine", () => {
  it("accepts the guarded execution lifecycle", () => {
    let entry = proposed();
    for (const state of [
      "PREVIEWED",
      "AWAITING_CONFIRMATION",
      "APPROVED",
      "EXECUTING",
      "EXECUTED",
      "VERIFIED",
    ] as const) {
      entry = transition(entry, state, "test");
    }
    expect(entry.state).toBe("VERIFIED");
    expect(entry.transitions).toHaveLength(6);
    expect(entry.transitions[1]!.previousHash).toBe(
      entry.transitions[0]!.integrityHash,
    );
  });

  it("rejects impossible transitions", () => {
    expect(canTransition("REJECTED", "EXECUTED")).toBe(false);
    const rejected = { ...proposed(), state: "REJECTED" as const };
    expect(() => transition(rejected, "EXECUTED", "attacker")).toThrow(
      InvalidTransitionError,
    );
  });
});
