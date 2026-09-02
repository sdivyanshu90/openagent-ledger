import { createHash } from "node:crypto";
import type { LedgerEntry, LedgerState } from "./schemas.js";

const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function entryIntegrityPayload(entry: LedgerEntry) {
  return {
    id: entry.id,
    runId: entry.runId,
    scenarioId: entry.scenarioId,
    sessionId: entry.sessionId,
    actor: entry.actor,
    tool: entry.tool,
    toolVersion: entry.toolVersion,
    schemaFingerprint: entry.schemaFingerprint,
    createdAt: entry.createdAt,
    arguments: entry.arguments,
    reason: entry.reason,
    risk: entry.risk,
    affectedResources: entry.affectedResources,
    sideEffects: entry.sideEffects,
    reversible: entry.reversible,
    confirmation: entry.confirmation,
    preview: entry.preview,
    approvalExpiresAt: entry.approvalExpiresAt,
    approvalRevision: entry.approvalRevision,
    correlationId: entry.correlationId,
    traceId: entry.traceId,
    previousHash: entry.previousHash,
    idempotencyKey: entry.idempotencyKey,
  };
}

export function calculateEntryIntegrityHash(entry: LedgerEntry): string {
  return sha256(entryIntegrityPayload(entry));
}

export function transitionEvidence(
  entry: LedgerEntry,
  state: LedgerState,
): unknown {
  if (state === "EXECUTED" || state === "VERIFIED")
    return entry.executionResult;
  if (state === "FAILED") return entry.error;
  if (state === "ROLLED_BACK") return entry.rollback;
  if (state === "ROLLBACK_FAILED") return entry.rollbackError;
  return undefined;
}

export interface IntegrityFailure {
  entryId: string;
  transitionIndex?: number;
  reason: string;
  expected: string;
  actual: string;
}

export interface IntegrityReport {
  valid: boolean;
  checkedEntries: number;
  checkedTransitions: number;
  broken?: IntegrityFailure;
  fixture?: boolean;
}

export function verifyLedgerIntegrity(
  ledger: LedgerEntry[],
  fixture = false,
): IntegrityReport {
  const entries = structuredClone(ledger);
  if (fixture) {
    if (entries[0]) entries[0].reason = `${entries[0].reason} [tampered]`;
    else
      return {
        valid: false,
        checkedEntries: 0,
        checkedTransitions: 0,
        fixture: true,
        broken: {
          entryId: "safe-fixture",
          reason: "Safe fixture contains an intentionally invalid entry hash.",
          expected: "valid-fixture-hash",
          actual: "tampered-fixture-hash",
        },
      };
  }

  let expectedPreviousHash = "GENESIS";
  let checkedTransitions = 0;
  for (const entry of entries) {
    if (entry.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        checkedEntries: entries.indexOf(entry),
        checkedTransitions,
        fixture,
        broken: {
          entryId: entry.id,
          reason: "Entry does not link to the previous ledger hash.",
          expected: expectedPreviousHash,
          actual: entry.previousHash,
        },
      };
    }
    const expectedEntryHash = calculateEntryIntegrityHash(entry);
    if (entry.integrityHash !== expectedEntryHash) {
      return {
        valid: false,
        checkedEntries: entries.indexOf(entry),
        checkedTransitions,
        fixture,
        broken: {
          entryId: entry.id,
          reason: "Immutable entry evidence was modified.",
          expected: expectedEntryHash,
          actual: entry.integrityHash,
        },
      };
    }

    let expectedTransitionPrevious = entry.integrityHash;
    for (const [transitionIndex, event] of entry.transitions.entries()) {
      if (event.previousHash !== expectedTransitionPrevious) {
        return {
          valid: false,
          checkedEntries: entries.indexOf(entry) + 1,
          checkedTransitions,
          fixture,
          broken: {
            entryId: entry.id,
            transitionIndex,
            reason: "Transition does not link to the previous evidence hash.",
            expected: expectedTransitionPrevious,
            actual: event.previousHash,
          },
        };
      }
      const expectedTransitionHash = sha256({
        state: event.state,
        at: event.at,
        actor: event.actor,
        detail: event.detail,
        previousHash: event.previousHash,
        evidenceHash: event.evidenceHash,
      });
      const evidence = transitionEvidence(entry, event.state);
      const expectedEvidenceHash =
        evidence === undefined ? undefined : sha256(evidence);
      if (event.evidenceHash !== expectedEvidenceHash) {
        return {
          valid: false,
          checkedEntries: entries.indexOf(entry) + 1,
          checkedTransitions,
          fixture,
          broken: {
            entryId: entry.id,
            transitionIndex,
            reason: "Transition result evidence was modified.",
            expected: expectedEvidenceHash ?? "no-evidence",
            actual: event.evidenceHash ?? "no-evidence",
          },
        };
      }
      if (event.integrityHash !== expectedTransitionHash) {
        return {
          valid: false,
          checkedEntries: entries.indexOf(entry) + 1,
          checkedTransitions,
          fixture,
          broken: {
            entryId: entry.id,
            transitionIndex,
            reason: "Transition evidence was modified.",
            expected: expectedTransitionHash,
            actual: event.integrityHash,
          },
        };
      }
      expectedTransitionPrevious = event.integrityHash;
      checkedTransitions += 1;
    }
    expectedPreviousHash = expectedTransitionPrevious;
  }

  return {
    valid: true,
    checkedEntries: entries.length,
    checkedTransitions,
    fixture,
  };
}
