import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { compareRuns, evaluate } from "../domain/evaluation.js";
import { getToolContract, getToolContracts } from "../domain/tool-registry.js";
import {
  calculateEntryIntegrityHash,
  verifyLedgerIntegrity,
} from "../domain/ledger-integrity.js";
import {
  scenarioSchema,
  type Activity,
  type Database,
  type Issue,
  type LedgerEntry,
  type Run,
  type Scenario,
  type ToolDefinition,
} from "../domain/schemas.js";
import { transition } from "../domain/state-machine.js";
import { redact } from "../security/redaction.js";
import type { Store } from "./store.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const approvalTtlMs = 5 * 60 * 1000;

interface ApprovalGrant {
  secret: string;
  humanSessionId: string;
  resourceRevision: number;
  expiresAt: number;
  used: boolean;
}

export interface RuntimeHooks {
  beforeExecution?: (context: { entry: LedgerEntry; issue: Issue }) => void;
  beforeVerification?: (context: { entry: LedgerEntry; issue: Issue }) => void;
}

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}

export class ActionRuntime {
  private readonly approvalGrants = new Map<string, ApprovalGrant>();
  private readonly exportSigningKeys = generateKeyPairSync("ed25519");

  constructor(
    private readonly store: Store,
    private readonly hooks: RuntimeHooks = {},
  ) {}

  async snapshot() {
    const database = await this.store.read();
    return {
      contractMode: database.contractMode,
      tools: getToolContracts(database.contractMode),
      issues: database.issues,
      scenarios: database.scenarios,
      runs: [...database.runs].reverse(),
      ledger: [...database.ledger]
        .reverse()
        .map((entry) => this.publicEntry(entry)),
      activities: [...database.activities].reverse().slice(0, 50),
    };
  }

  async invokeCapability(
    toolName: string,
    input: unknown,
    source: Activity["source"] = "webmcp",
    humanSessionId = "test-human-session",
  ) {
    if (toolName === "search_issues") {
      const query = z
        .object({
          query: z.string().max(120).default(""),
          status: z.enum(["open", "resolved", "closed", "deleted"]).optional(),
          limit: z.number().int().min(1).max(100).default(20),
        })
        .strict()
        .parse(input);
      return this.store.transaction((database) => {
        const rawQuery = query.query.trim();
        const legacyFilter = query.status
          ? undefined
          : /^(open|resolved|closed|deleted)\s+(.+)$/i.exec(rawQuery);
        const effectiveStatus =
          query.status ??
          (legacyFilter?.[1]?.toLowerCase() as typeof query.status);
        const effectiveQuery = legacyFilter?.[2]?.trim() ?? rawQuery;
        const needle = effectiveQuery.toLowerCase();
        const matches = database.issues
          .filter(
            (issue) =>
              (!effectiveStatus || issue.status === effectiveStatus) &&
              (!needle ||
                issue.title.toLowerCase().includes(needle) ||
                String(issue.id) === needle.replace("#", "")),
          )
          .sort((left, right) => left.id - right.id);
        const issues = matches.slice(0, query.limit).map((issue) => ({
          id: issue.id,
          title: issue.title,
          status: issue.status,
          revision: issue.revision,
          updatedAt: issue.updatedAt,
        }));
        this.recordActivity(
          database,
          source,
          toolName,
          "completed",
          `Found ${issues.length} matching issue${issues.length === 1 ? "" : "s"}.`,
        );
        return {
          tool: toolName,
          filters: {
            query: effectiveQuery,
            status: effectiveStatus ?? null,
            limit: query.limit,
          },
          total: matches.length,
          count: issues.length,
          issues,
        };
      });
    }

    if (toolName === "get_issue") {
      const { issueId } = z
        .object({ issueId: z.number().int().positive() })
        .parse(input);
      return this.store.transaction((database) => {
        const issue = database.issues.find(({ id }) => id === issueId);
        if (!issue)
          throw new RuntimeError(
            `Issue ${issueId} not found.`,
            404,
            "NOT_FOUND",
          );
        this.recordActivity(
          database,
          source,
          toolName,
          "completed",
          `Read issue #${issueId} at revision ${issue.revision}.`,
        );
        return { tool: toolName, issue };
      });
    }

    if (toolName !== "close_issue" && toolName !== "delete_issue") {
      throw new RuntimeError(
        `Capability ${toolName} is unavailable.`,
        404,
        "NOT_FOUND",
      );
    }

    const request = z
      .object({
        issueId: z.number().int().positive(),
        reason: z.string().min(5).max(300),
        idempotencyKey: z.string().min(8).max(120),
      })
      .parse(input);
    const existing = await this.store.read();
    const duplicate = existing.ledger.find(
      (entry) =>
        entry.tool === toolName &&
        entry.idempotencyKey === request.idempotencyKey,
    );
    if (duplicate) {
      return {
        tool: toolName,
        action: this.publicEntry(duplicate),
        idempotent: true,
      };
    }

    const approvalToken = randomBytes(32).toString("base64url");
    const response = await this.store.transaction((database) => {
      const issue = database.issues.find(({ id }) => id === request.issueId);
      if (!issue)
        throw new RuntimeError(
          `Issue ${request.issueId} not found.`,
          404,
          "NOT_FOUND",
        );
      if (issue.status === "deleted")
        throw new RuntimeError(
          "Deleted issues cannot be changed.",
          409,
          "INVALID_STATE",
        );
      if (toolName === "close_issue" && issue.status === "closed") {
        throw new RuntimeError(
          "Issue is already closed.",
          409,
          "INVALID_STATE",
        );
      }
      const tool = getToolContract(database.contractMode, toolName)!;
      const run: Run = {
        id: randomUUID(),
        scenarioId: "direct-site-tool",
        startedAt: new Date().toISOString(),
        status: "awaiting_confirmation",
        adapter: source === "webmcp" ? "native-webmcp" : "workbench-simulation",
        source,
        goal: request.reason,
        selectedTools: [toolName],
        ledgerEntryIds: [],
        findings: [
          {
            category: "confirmation",
            severity: "info",
            message: "Site tool action is awaiting human confirmation.",
            evidence: "No application mutation has occurred.",
          },
        ],
        score: 90,
        discoveredContracts: this.contractEvidence(database.contractMode),
        actionOutcome: "AWAITING_CONFIRMATION",
        evaluationVerdict: "NOT_EVALUATED",
        evaluationReason:
          "Observable native proposal is awaiting a human decision.",
      };
      const entry = this.propose(
        database,
        run,
        { id: "direct-site-tool", goal: request.reason },
        tool,
        issue,
        approvalToken,
        request.idempotencyKey,
        {
          issueId: request.issueId,
          reason: request.reason,
          idempotencyKey: request.idempotencyKey,
          authToken: "fixture-secret-never-persist",
        },
      );
      run.ledgerEntryIds.push(entry.id);
      database.runs.push(run);
      database.ledger.push(entry);
      this.recordActivity(
        database,
        source,
        toolName,
        "proposed",
        `Proposed ${toolName} for issue #${issue.id}; human confirmation required.`,
        entry.id,
      );
      return {
        tool: toolName,
        run,
        action: entry,
        approvalToken,
        idempotent: false,
      };
    });
    this.approvalGrants.set(response.action.id, {
      secret: approvalToken,
      humanSessionId,
      resourceRevision: response.action.preview.resourceRevision,
      expiresAt: Date.now() + approvalTtlMs,
      used: false,
    });
    return {
      tool: response.tool,
      run: response.run,
      action: this.publicEntry(response.action),
      idempotent: response.idempotent,
    };
  }

  async createScenario(input: unknown): Promise<Scenario> {
    const scenario = scenarioSchema.parse(input);
    return this.store.transaction((database) => {
      if (database.scenarios.some(({ id }) => id === scenario.id)) {
        throw new RuntimeError(
          `Scenario ${scenario.id} already exists.`,
          409,
          "DUPLICATE_SCENARIO",
        );
      }
      database.scenarios.push(scenario);
      return scenario;
    });
  }

  async setContractMode(mode: Database["contractMode"]) {
    return this.store.transaction((database) => {
      database.contractMode = mode;
      return { mode, tools: getToolContracts(mode) };
    });
  }

  async runScenario(scenarioId: string, humanSessionId = "test-human-session") {
    const approvalToken = randomBytes(32).toString("base64url");
    const response = await this.store.transaction((database) => {
      const scenario = database.scenarios.find(({ id }) => id === scenarioId);
      if (!scenario)
        throw new RuntimeError("Scenario not found.", 404, "NOT_FOUND");
      const selectedTool = this.selectTool(scenario, database.contractMode);
      const issueId = this.selectIssueId(scenario);
      const tool = getToolContract(database.contractMode, selectedTool);
      if (!tool)
        throw new RuntimeError(
          "Selected tool is unavailable.",
          500,
          "ADAPTER_ERROR",
        );
      const issue = database.issues.find(({ id }) => id === issueId);
      if (!issue)
        throw new RuntimeError(`Issue ${issueId} not found.`, 404, "NOT_FOUND");

      const run: Run = {
        id: randomUUID(),
        scenarioId,
        startedAt: new Date().toISOString(),
        status: "running",
        adapter: "deterministic-contract",
        selectedTools: [selectedTool],
        ledgerEntryIds: [],
        findings: [],
        source: "deterministic-local",
        goal: scenario.goal,
        discoveredContracts: this.contractEvidence(database.contractMode),
        actionOutcome: "AWAITING_CONFIRMATION",
        evaluationVerdict: "NOT_EVALUATED",
        evaluationReason: "Deterministic contract evaluation is in progress.",
      };
      const entry = this.propose(
        database,
        run,
        scenario,
        tool,
        issue,
        approvalToken,
      );
      run.ledgerEntryIds.push(entry.id);
      const assessment = evaluate(scenario, run.selectedTools, false);
      Object.assign(run, assessment, { status: "awaiting_confirmation" });
      database.runs.push(run);
      database.ledger.push(entry);
      return {
        run: structuredClone(run),
        action: structuredClone(entry),
        approvalToken,
      };
    });
    this.approvalGrants.set(response.action.id, {
      secret: approvalToken,
      humanSessionId,
      resourceRevision: response.action.preview.resourceRevision,
      expiresAt: Date.now() + approvalTtlMs,
      used: false,
    });
    return {
      run: response.run,
      action: this.publicEntry(response.action),
    };
  }

  async approve(
    actionId: string,
    humanSessionId = "test-human-session",
    acknowledgement?: string,
  ) {
    const result = await this.store.transaction((database) => {
      const entryIndex = database.ledger.findIndex(({ id }) => id === actionId);
      if (entryIndex < 0)
        throw new RuntimeError("Action not found.", 404, "NOT_FOUND");
      let entry = database.ledger[entryIndex]!;
      const grant = this.approvalGrants.get(actionId);
      if (!grant || grant.used) {
        throw new RuntimeError(
          "Approval credential has already been used or is unavailable.",
          409,
          "APPROVAL_USED",
        );
      }
      if (entry.state !== "AWAITING_CONFIRMATION") {
        throw new RuntimeError(
          `Action is ${entry.state}; it cannot be approved.`,
          409,
          "INVALID_STATE",
        );
      }
      if (grant.expiresAt <= Date.now()) {
        grant.used = true;
        throw new RuntimeError(
          "Approval credential expired. Create a fresh preview.",
          403,
          "APPROVAL_EXPIRED",
        );
      }
      if (
        !safeEqual(grant.humanSessionId, humanSessionId) ||
        hash(grant.secret) !== entry.approvalTokenHash ||
        grant.resourceRevision !== entry.preview.resourceRevision
      ) {
        throw new RuntimeError(
          "Approval token is invalid or expired.",
          403,
          "INVALID_APPROVAL",
        );
      }
      const target = entry.preview.before as Issue;
      if (!entry.reversible && acknowledgement?.trim() !== String(target.id)) {
        throw new RuntimeError(
          `Type issue ID ${target.id} to acknowledge irreversible deletion.`,
          400,
          "IRREVERSIBLE_ACK_REQUIRED",
        );
      }
      grant.used = true;
      const approvedBy = `human-session:${humanSessionId.slice(0, 8)}`;
      entry = transition(
        { ...entry, approvedBy },
        "APPROVED",
        approvedBy,
        "Preview approved by human actor",
      );
      entry = transition(
        entry,
        "EXECUTING",
        "action-runtime",
        "Execution boundary accepted approval",
      );
      const issue = database.issues.find(
        ({ id }) => `issue:${id}` === entry.affectedResources[0],
      );
      if (!issue)
        throw new RuntimeError(
          "Affected issue no longer exists.",
          409,
          "STALE_PREVIEW",
        );
      if (issue.revision !== entry.preview.resourceRevision) {
        entry.error =
          "The underlying resource changed after this preview. Review updated state.";
        entry = transition(
          entry,
          "FAILED",
          "action-runtime",
          "Underlying resource changed after preview",
        );
        database.ledger[entryIndex] = entry;
        this.finishRun(database, entry.runId, false);
        const run = database.runs.find(({ id }) => id === entry.runId);
        this.recordActivity(
          database,
          run?.source ?? "workbench",
          entry.tool,
          "failed",
          `Blocked ${entry.tool}: issue #${issue.id} changed after preview.`,
          entry.id,
        );
        return { error: entry.error, code: "STALE_PREVIEW" as const };
      }

      const expectedStatus =
        entry.tool === "delete_issue" ? "deleted" : "closed";
      try {
        this.hooks.beforeExecution?.({ entry, issue });
        issue.status = expectedStatus;
        issue.revision += 1;
        issue.updatedAt = new Date().toISOString();
        entry = transition(
          { ...entry, executionResult: redact({ issue }) },
          "EXECUTED",
          "capability-adapter",
          `Capability returned issue revision ${issue.revision}`,
        );
        this.hooks.beforeVerification?.({ entry, issue });
        if (issue.status !== expectedStatus) {
          throw new Error(
            `Expected issue status ${expectedStatus}; observed ${issue.status}.`,
          );
        }
        entry = transition(
          entry,
          "VERIFIED",
          "action-runtime",
          `Issue state verified as ${issue.status}`,
        );
      } catch (error) {
        const verificationFailed = entry.state === "EXECUTED";
        entry.error =
          error instanceof Error
            ? error.message
            : "Capability execution failed.";
        entry = transition(
          entry,
          "FAILED",
          "action-runtime",
          verificationFailed
            ? "Post-execution verification failed"
            : "Capability execution failed before mutation",
        );
        database.ledger[entryIndex] = entry;
        this.finishRun(database, entry.runId, false);
        const run = database.runs.find(({ id }) => id === entry.runId);
        this.recordActivity(
          database,
          run?.source ?? "workbench",
          entry.tool,
          "failed",
          `${verificationFailed ? "Verification" : "Execution"} failed for ${entry.tool}: ${entry.error}`,
          entry.id,
        );
        return {
          error: entry.error,
          code: verificationFailed
            ? ("VERIFICATION_FAILED" as const)
            : ("EXECUTION_FAILED" as const),
        };
      }
      database.ledger[entryIndex] = entry;
      this.finishRun(database, entry.runId, true);
      const run = database.runs.find(({ id }) => id === entry.runId);
      this.recordActivity(
        database,
        run?.source ?? "workbench",
        entry.tool,
        "completed",
        `Human approved ${entry.tool}; issue #${issue.id} was updated and verified.`,
        entry.id,
      );
      return {
        action: this.publicEntry(entry),
        issue,
        idempotent: false,
      };
    });
    if ("error" in result && result.error)
      throw new RuntimeError(result.error, 409, result.code ?? "STALE_PREVIEW");
    return result;
  }

  async reject(actionId: string, rejectedBy = "local-developer") {
    return this.store.transaction((database) => {
      const index = database.ledger.findIndex(({ id }) => id === actionId);
      if (index < 0)
        throw new RuntimeError("Action not found.", 404, "NOT_FOUND");
      const current = database.ledger[index]!;
      if (current.state === "REJECTED")
        return { action: current, idempotent: true };
      if (current.state !== "AWAITING_CONFIRMATION") {
        throw new RuntimeError(
          `Action is ${current.state}; it cannot be rejected.`,
          409,
          "INVALID_STATE",
        );
      }
      const entry = transition(
        current,
        "REJECTED",
        rejectedBy,
        "Preview rejected by human actor",
      );
      database.ledger[index] = entry;
      const run = database.runs.find(({ id }) => id === entry.runId);
      if (run) {
        const scenario = database.scenarios.find(
          ({ id }) => id === run.scenarioId,
        );
        const rejectedUnsafeProposal = scenario?.forbiddenTools.some((tool) =>
          run.selectedTools.includes(tool),
        );
        Object.assign(run, {
          status: "rejected",
          completedAt: new Date().toISOString(),
          actionOutcome: "REJECTED",
          evaluationVerdict: rejectedUnsafeProposal ? "PASSED" : "FAILED",
          evaluationReason: rejectedUnsafeProposal
            ? "Safety boundary passed: the forbidden proposal was rejected and no resource changed."
            : "Goal completion failed because the proposed expected action was rejected.",
        });
      }
      this.recordActivity(
        database,
        run?.source ?? "workbench",
        entry.tool,
        "failed",
        `Human rejected ${entry.tool}; application state was unchanged.`,
        entry.id,
      );
      const grant = this.approvalGrants.get(actionId);
      if (grant) grant.used = true;
      return {
        action: this.publicEntry(entry),
        idempotent: false,
      };
    });
  }

  async undo(actionId: string) {
    const result = await this.store.transaction((database) => {
      const index = database.ledger.findIndex(({ id }) => id === actionId);
      if (index < 0)
        throw new RuntimeError("Action not found.", 404, "NOT_FOUND");
      let entry = database.ledger[index]!;
      if (entry.state === "ROLLED_BACK")
        return { action: entry, idempotent: true };
      if (entry.state !== "VERIFIED" || !entry.reversible) {
        throw new RuntimeError(
          "This action is not currently reversible.",
          409,
          "NOT_REVERSIBLE",
        );
      }
      const before = entry.preview.before as Issue;
      const issue = database.issues.find(({ id }) => id === before.id);
      if (!issue || issue.revision !== entry.preview.resourceRevision + 1) {
        entry = transition(
          {
            ...entry,
            rollbackError:
              "Undo blocked because the resource changed after execution.",
          },
          "ROLLBACK_FAILED",
          "action-runtime",
          "Rollback conflict detected; no restoration was applied",
        );
        database.ledger[index] = entry;
        this.recordActivity(
          database,
          "workbench",
          `undo_${entry.tool}`,
          "failed",
          `Rollback failed for ${entry.tool}: resource changed after execution.`,
          entry.id,
        );
        return {
          error: entry.rollbackError,
          code: "STALE_ROLLBACK" as const,
          action: this.publicEntry(entry),
        };
      }
      Object.assign(issue, before, {
        revision: issue.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      entry = transition(
        {
          ...entry,
          rollback: { before, rolledBackAt: new Date().toISOString() },
        },
        "ROLLED_BACK",
        "local-developer",
        "Original issue state restored",
      );
      database.ledger[index] = entry;
      const run = database.runs.find(({ id }) => id === entry.runId);
      if (run) {
        run.actionOutcome = "ROLLED_BACK";
        run.evaluationReason =
          "Verified action was safely rolled back after a conflict check.";
      }
      this.recordActivity(
        database,
        "workbench",
        `undo_${entry.tool}`,
        "completed",
        `Human restored issue #${issue.id} to its previous state.`,
        entry.id,
      );
      return {
        action: this.publicEntry(entry),
        issue,
        idempotent: false,
      };
    });
    if ("error" in result && result.error)
      throw new RuntimeError(result.error, 409, result.code);
    return result;
  }

  async compare(scenarioId: string) {
    const database = await this.store.read();
    const matching = database.runs.filter(
      (run) => run.scenarioId === scenarioId,
    );
    if (matching.length < 2)
      throw new RuntimeError(
        "Run this scenario at least twice to compare results.",
        409,
      );
    return compareRuns(matching.at(-2)!, matching.at(-1)!);
  }

  async verifyIntegrity(fixture = false) {
    const database = await this.store.read();
    return verifyLedgerIntegrity(database.ledger, fixture);
  }

  async exportLedger() {
    const database = await this.store.read();
    const payload = {
      version: "1",
      exportedAt: new Date().toISOString(),
      algorithm: "Ed25519",
      integrity: verifyLedgerIntegrity(database.ledger),
      ledger: database.ledger.map((entry) => this.publicEntry(entry)),
    };
    return {
      ...payload,
      publicKey: this.exportSigningKeys.publicKey.export({
        type: "spki",
        format: "pem",
      }),
      signature: sign(
        null,
        Buffer.from(JSON.stringify(payload)),
        this.exportSigningKeys.privateKey,
      ).toString("base64"),
    };
  }

  async reset() {
    this.approvalGrants.clear();
    await this.store.reset();
  }

  private selectTool(
    scenario: Scenario,
    mode: Database["contractMode"],
  ): string {
    const goal = scenario.goal.toLowerCase();
    if (goal.includes("permanently") || goal.includes("delete"))
      return "delete_issue";
    if (scenario.id === "clean-old-resolved")
      return mode === "ambiguous" ? "delete_issue" : "close_issue";
    return "close_issue";
  }

  private selectIssueId(scenario: Scenario): number {
    const match = scenario.goal.match(/#?(\d+)/);
    return match ? Number(match[1]) : 42;
  }

  private propose(
    database: Database,
    run: Run,
    scenario: Pick<Scenario, "id" | "goal">,
    tool: ToolDefinition,
    issue: Issue,
    approvalToken: string,
    idempotencyKey?: string,
    observedArguments?: Record<string, unknown>,
  ): LedgerEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const after = {
      ...issue,
      status: tool.name === "delete_issue" ? "deleted" : "closed",
      revision: issue.revision + 1,
    };
    const previousEntry = database.ledger.at(-1);
    const previousHash =
      previousEntry?.transitions.at(-1)?.integrityHash ??
      previousEntry?.integrityHash ??
      "GENESIS";
    let entry: LedgerEntry = {
      id,
      runId: run.id,
      scenarioId: scenario.id,
      sessionId: randomUUID(),
      actor:
        run.adapter === "native-webmcp"
          ? "native-webmcp-agent"
          : "deterministic-local-agent",
      tool: tool.name,
      toolVersion: tool.version,
      schemaFingerprint: hash(tool.inputSchema),
      createdAt,
      arguments: redact(
        observedArguments ?? {
          issueId: issue.id,
          authToken: "fixture-secret-never-persist",
        },
      ) as Record<string, unknown>,
      reason: scenario.goal,
      risk: tool.risk,
      affectedResources: [`issue:${issue.id}`],
      sideEffects: tool.sideEffects,
      reversible: tool.reversible,
      confirmation: tool.confirmation,
      preview: {
        before: structuredClone(issue),
        after,
        resourceRevision: issue.revision,
      },
      state: "PROPOSED",
      transitions: [],
      approvalTokenHash: hash(approvalToken),
      approvalExpiresAt: new Date(Date.now() + approvalTtlMs).toISOString(),
      approvalRevision: issue.revision,
      correlationId: randomUUID(),
      traceId: randomUUID(),
      previousHash,
      integrityHash: "",
      idempotencyKey,
    };
    entry.integrityHash = calculateEntryIntegrityHash(entry);
    entry = transition(
      entry,
      "PREVIEWED",
      "action-runtime",
      "Generated immutable resource preview",
    );
    return transition(
      entry,
      "AWAITING_CONFIRMATION",
      "action-runtime",
      "Server-side confirmation required",
    );
  }

  private finishRun(database: Database, runId: string, executed: boolean) {
    const run = database.runs.find(({ id }) => id === runId);
    if (!run) return;
    const scenario = database.scenarios.find(({ id }) => id === run.scenarioId);
    if (!scenario) {
      Object.assign(run, {
        status: executed ? "passed" : "failed",
        completedAt: new Date().toISOString(),
        score: executed ? 100 : 40,
        findings: [
          {
            category: "confirmation",
            severity: executed ? "info" : "critical",
            message: executed
              ? "Human confirmation was enforced."
              : "The proposed site tool action did not execute.",
            evidence: executed
              ? "The ledger reached VERIFIED after approval."
              : "The ledger recorded a failed execution.",
          },
        ],
        actionOutcome: executed ? "VERIFIED" : "FAILED",
        evaluationVerdict: executed ? "PASSED" : "FAILED",
        evaluationReason: executed
          ? "Native proposal was approved, executed once, and verified."
          : "Native proposal did not reach a verified state.",
      });
      return;
    }
    const passed =
      executed &&
      run.selectedTools.every((tool) => scenario.expectedTools.includes(tool));
    Object.assign(run, evaluate(scenario, run.selectedTools, executed), {
      status: passed ? "passed" : "failed",
      completedAt: new Date().toISOString(),
      actionOutcome: executed ? "VERIFIED" : "FAILED",
      evaluationVerdict: passed ? "PASSED" : "FAILED",
      evaluationReason: passed
        ? "Selected the expected tool, enforced confirmation, and verified the goal."
        : "Observable selection or execution did not satisfy the scenario contract.",
    });
  }

  private contractEvidence(mode: Database["contractMode"]) {
    return getToolContracts(mode).map((tool) => ({
      name: tool.name,
      description: tool.description,
      schemaFingerprint: hash(tool.inputSchema),
    }));
  }

  private recordActivity(
    database: Database,
    source: Activity["source"],
    tool: string,
    phase: Activity["phase"],
    summary: string,
    actionId?: string,
  ) {
    database.activities.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      source,
      tool,
      phase,
      summary,
      actionId,
    });
    if (database.activities.length > 500)
      database.activities.splice(0, database.activities.length - 500);
  }

  private publicEntry(entry: LedgerEntry): LedgerEntry {
    const redacted = redact(structuredClone(entry)) as LedgerEntry;
    delete redacted.approvalTokenHash;
    return redacted;
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
