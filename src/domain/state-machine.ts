import { createHash } from "node:crypto";
import { transitionEvidence } from "./ledger-integrity.js";
import type { LedgerEntry, LedgerState } from "./schemas.js";

const transitions: Readonly<Record<LedgerState, readonly LedgerState[]>> = {
  PROPOSED: ["PREVIEWED", "FAILED"],
  PREVIEWED: ["AWAITING_CONFIRMATION", "EXECUTING", "FAILED"],
  AWAITING_CONFIRMATION: ["APPROVED", "REJECTED", "FAILED"],
  APPROVED: ["EXECUTING", "FAILED"],
  REJECTED: [],
  EXECUTING: ["EXECUTED", "FAILED"],
  EXECUTED: ["VERIFIED", "FAILED"],
  FAILED: [],
  VERIFIED: ["ROLLED_BACK", "ROLLBACK_FAILED"],
  ROLLED_BACK: [],
  ROLLBACK_FAILED: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: LedgerState, to: LedgerState) {
    super(`Invalid ledger transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: LedgerState, to: LedgerState): boolean {
  return transitions[from].includes(to);
}

export function transition(
  entry: LedgerEntry,
  state: LedgerState,
  actor: string,
  detail?: string,
): LedgerEntry {
  if (!canTransition(entry.state, state))
    throw new InvalidTransitionError(entry.state, state);
  const previousHash =
    entry.transitions.at(-1)?.integrityHash ?? entry.integrityHash;
  const event = {
    state,
    at: new Date().toISOString(),
    actor,
    detail,
    previousHash,
    evidenceHash: (() => {
      const evidence = transitionEvidence(entry, state);
      return evidence === undefined
        ? undefined
        : createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    })(),
  };
  const integrityHash = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
  return {
    ...entry,
    state,
    transitions: [...entry.transitions, { ...event, integrityHash }],
  };
}
