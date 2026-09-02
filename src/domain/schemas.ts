import { z } from "zod";

export const riskSchema = z.enum(["low", "medium", "high", "critical"]);
export const confirmationSchema = z.enum(["none", "recommended", "required"]);
export const ledgerStateSchema = z.enum([
  "PROPOSED",
  "PREVIEWED",
  "AWAITING_CONFIRMATION",
  "APPROVED",
  "REJECTED",
  "EXECUTING",
  "EXECUTED",
  "FAILED",
  "VERIFIED",
  "ROLLED_BACK",
  "ROLLBACK_FAILED",
]);

export const jsonSchemaSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

export const toolDefinitionSchema = z.object({
  version: z.literal("1"),
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(12),
  inputSchema: jsonSchemaSchema,
  risk: riskSchema,
  sideEffects: z.array(z.string()),
  reversible: z.boolean(),
  confirmation: confirmationSchema,
  dataScopes: z.array(z.string()).default([]),
  reasonRequired: z.boolean().default(false),
});

export const issueSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  status: z.enum(["open", "resolved", "closed", "deleted"]),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
});

export const scenarioSchema = z.object({
  version: z.literal("1"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(3).max(80),
  goal: z.string().min(3).max(500),
  expectedTools: z.array(z.string()).min(1),
  forbiddenTools: z.array(z.string()).default([]),
  mustConfirm: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  risk: riskSchema,
  timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
});

export const transitionSchema = z.object({
  state: ledgerStateSchema,
  at: z.string().datetime(),
  actor: z.string(),
  detail: z.string().optional(),
  previousHash: z.string(),
  integrityHash: z.string(),
  evidenceHash: z.string().optional(),
});

export const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  scenarioId: z.string(),
  sessionId: z.string().uuid(),
  actor: z.string(),
  tool: z.string(),
  toolVersion: z.string(),
  schemaFingerprint: z.string(),
  createdAt: z.string().datetime(),
  arguments: z.record(z.string(), z.unknown()),
  reason: z.string(),
  risk: riskSchema,
  affectedResources: z.array(z.string()),
  sideEffects: z.array(z.string()),
  reversible: z.boolean(),
  confirmation: confirmationSchema,
  preview: z.object({
    before: z.unknown(),
    after: z.unknown(),
    resourceRevision: z.number().int(),
  }),
  state: ledgerStateSchema,
  transitions: z.array(transitionSchema),
  approvalTokenHash: z.string().optional(),
  approvalExpiresAt: z.string().datetime().optional(),
  approvalRevision: z.number().int().positive().optional(),
  approvedBy: z.string().optional(),
  executionResult: z.unknown().optional(),
  error: z.string().optional(),
  rollback: z
    .object({ before: issueSchema, rolledBackAt: z.string().datetime() })
    .optional(),
  rollbackError: z.string().optional(),
  correlationId: z.string().uuid(),
  traceId: z.string().uuid(),
  previousHash: z.string(),
  integrityHash: z.string(),
  idempotencyKey: z.string().optional(),
});

export const findingSchema = z.object({
  category: z.enum([
    "tool-selection",
    "confirmation",
    "goal-completion",
    "ledger-completeness",
  ]),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string(),
  evidence: z.string(),
});

export const activitySchema = z.object({
  id: z.string().uuid(),
  at: z.string().datetime(),
  source: z.enum(["webmcp", "workbench", "deterministic-local"]),
  tool: z.string(),
  phase: z.enum(["invoked", "completed", "proposed", "failed"]),
  summary: z.string(),
  actionId: z.string().uuid().optional(),
});

export const runSchema = z.object({
  id: z.string().uuid(),
  scenarioId: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  status: z.enum([
    "running",
    "awaiting_confirmation",
    "passed",
    "failed",
    "rejected",
  ]),
  adapter: z.enum([
    "deterministic-local",
    "deterministic-contract",
    "native-webmcp",
    "workbench-simulation",
  ]),
  selectedTools: z.array(z.string()),
  ledgerEntryIds: z.array(z.string().uuid()),
  findings: z.array(findingSchema),
  score: z.number().int().min(0).max(100).optional(),
  source: z
    .enum(["webmcp", "workbench", "deterministic-local"])
    .default("deterministic-local"),
  goal: z.string().optional(),
  discoveredContracts: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        schemaFingerprint: z.string(),
      }),
    )
    .default([]),
  actionOutcome: z
    .enum([
      "AWAITING_CONFIRMATION",
      "REJECTED",
      "VERIFIED",
      "FAILED",
      "ROLLED_BACK",
    ])
    .default("AWAITING_CONFIRMATION"),
  evaluationVerdict: z
    .enum(["NOT_EVALUATED", "PASSED", "FAILED"])
    .default("NOT_EVALUATED"),
  evaluationReason: z.string().default("Evaluation is not complete."),
});

export const databaseSchema = z.object({
  version: z.literal("1"),
  contractMode: z.enum(["ambiguous", "improved"]),
  issues: z.array(issueSchema),
  scenarios: z.array(scenarioSchema),
  runs: z.array(runSchema),
  ledger: z.array(ledgerEntrySchema),
  activities: z.array(activitySchema).default([]),
});

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type LedgerState = z.infer<typeof ledgerStateSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Run = z.infer<typeof runSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Database = z.infer<typeof databaseSchema>;
