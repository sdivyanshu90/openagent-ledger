import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { compareRuns, evaluate } from "../domain/evaluation.js";
import { tools } from "../domain/fixtures.js";
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
  private readonly approvalTokens = new Map<string, string>();

  constructor(private readonly store: Store) {}

  async snapshot() {
    const database = await this.store.read();
    return {
      contractMode: database.contractMode,
      tools: tools(database.contractMode),
      issues: database.issues,
      scenarios: database.scenarios,
      runs: [...database.runs].reverse(),
      ledger: [...database.ledger].reverse(),
      activities: [...database.activities].reverse().slice(0, 50),
    };
  }

  async invokeCapability(
    toolName: string,
    input: unknown,
    source: Activity["source"] = "webmcp",
  ) {
    if (toolName === "search_issues") {
      const query = z
        .object({
          query: z.string().max(120).default(""),
          status: z.enum(["open", "resolved", "closed", "deleted"]).optional(),
        })
        .parse(input);
      return this.store.transaction((database) => {
        const needle = query.query.trim().toLowerCase();
        const issues = database.issues.filter(
          (issue) =>
            (!query.status || issue.status === query.status) &&
            (!needle ||
              issue.title.toLowerCase().includes(needle) ||
              String(issue.id) === needle.replace("#", "")),
        );
        this.recordActivity(
          database,
          source,
          toolName,
          "completed",
          `Found ${issues.length} matching issue${issues.length === 1 ? "" : "s"}.`,
        );
        return { tool: toolName, count: issues.length, issues };
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
        action: duplicate,
        approvalToken: this.approvalTokens.get(duplicate.id),
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
      const tool = tools(database.contractMode).find(
        ({ name }) => name === toolName,
      )!;
      const run: Run = {
        id: randomUUID(),
        scenarioId: "direct-site-tool",
        startedAt: new Date().toISOString(),
        status: "awaiting_confirmation",
        adapter: "deterministic-local",
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
      };
      const entry = this.propose(
        database,
        run,
        { id: "direct-site-tool", goal: request.reason },
        tool,
        issue,
        approvalToken,
        request.idempotencyKey,
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
    this.approvalTokens.set(response.action.id, approvalToken);
    return response;
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
      return { mode, tools: tools(mode) };
    });
  }

  async runScenario(scenarioId: string) {
    const approvalToken = randomBytes(32).toString("base64url");
    const response = await this.store.transaction((database) => {
      const scenario = database.scenarios.find(({ id }) => id === scenarioId);
      if (!scenario)
        throw new RuntimeError("Scenario not found.", 404, "NOT_FOUND");
      const selectedTool = this.selectTool(scenario, database.contractMode);
      const issueId = this.selectIssueId(scenario);
      const tool = tools(database.contractMode).find(
        ({ name }) => name === selectedTool,
      );
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
        adapter: "deterministic-local",
        selectedTools: [selectedTool],
        ledgerEntryIds: [],
        findings: [],
        source: "deterministic-local",
        goal: scenario.goal,
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
    this.approvalTokens.set(response.action.id, approvalToken);
    return response;
  }

  async approve(
    actionId: string,
    token: string,
    approvedBy = "local-developer",
  ) {
    const result = await this.store.transaction((database) => {
      const entryIndex = database.ledger.findIndex(({ id }) => id === actionId);
      if (entryIndex < 0)
        throw new RuntimeError("Action not found.", 404, "NOT_FOUND");
      let entry = database.ledger[entryIndex]!;
      if (["EXECUTED", "VERIFIED"].includes(entry.state))
        return { action: entry, idempotent: true };
      if (entry.state !== "AWAITING_CONFIRMATION") {
        throw new RuntimeError(
          `Action is ${entry.state}; it cannot be approved.`,
          409,
          "INVALID_STATE",
        );
      }
      const expected = this.approvalTokens.get(actionId);
      if (
        !expected ||
        !safeEqual(expected, token) ||
        hash(token) !== entry.approvalTokenHash
      ) {
        throw new RuntimeError(
          "Approval token is invalid or expired.",
          403,
          "INVALID_APPROVAL",
        );
      }
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
        entry = transition(
          entry,
          "FAILED",
          "action-runtime",
          "Underlying resource changed after preview",
        );
        entry.error =
          "The underlying resource changed after this preview. Review updated state.";
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

      issue.status = entry.tool === "delete_issue" ? "deleted" : "closed";
      issue.revision += 1;
      issue.updatedAt = new Date().toISOString();
      entry = transition(
        { ...entry, executionResult: redact({ issue }) },
        "EXECUTED",
        "capability-adapter",
      );
      entry = transition(
        entry,
        "VERIFIED",
        "action-runtime",
        `Issue state verified as ${issue.status}`,
      );
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
      this.approvalTokens.delete(actionId);
      return { action: entry, issue, idempotent: false };
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
      if (run)
        Object.assign(run, {
          status: "rejected",
          completedAt: new Date().toISOString(),
        });
      this.recordActivity(
        database,
        run?.source ?? "workbench",
        entry.tool,
        "failed",
        `Human rejected ${entry.tool}; application state was unchanged.`,
        entry.id,
      );
      this.approvalTokens.delete(actionId);
      return { action: entry, idempotent: false };
    });
  }

  async undo(actionId: string) {
    return this.store.transaction((database) => {
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
        throw new RuntimeError(
          "Undo blocked because the resource changed after execution.",
          409,
          "STALE_ROLLBACK",
        );
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
      this.recordActivity(
        database,
        "workbench",
        `undo_${entry.tool}`,
        "completed",
        `Human restored issue #${issue.id} to its previous state.`,
        entry.id,
      );
      return { action: entry, issue, idempotent: false };
    });
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

  async reset() {
    this.approvalTokens.clear();
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
  ): LedgerEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const after = {
      ...issue,
      status: tool.name === "delete_issue" ? "deleted" : "closed",
      revision: issue.revision + 1,
    };
    const previousHash = database.ledger.at(-1)?.integrityHash ?? "GENESIS";
    const base = {
      id,
      runId: run.id,
      tool: tool.name,
      createdAt,
      previousHash,
    };
    const integrityHash = hash(base);
    let entry: LedgerEntry = {
      id,
      runId: run.id,
      scenarioId: scenario.id,
      sessionId: randomUUID(),
      actor: "deterministic-local-agent",
      tool: tool.name,
      toolVersion: tool.version,
      schemaFingerprint: hash(tool.inputSchema),
      createdAt,
      arguments: redact({
        issueId: issue.id,
        authToken: "fixture-secret-never-persist",
      }) as Record<string, unknown>,
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
      correlationId: randomUUID(),
      traceId: randomUUID(),
      previousHash,
      integrityHash,
      idempotencyKey,
    };
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
      });
      return;
    }
    Object.assign(run, evaluate(scenario, run.selectedTools, executed), {
      status:
        executed &&
        run.selectedTools.every((tool) => scenario.expectedTools.includes(tool))
          ? "passed"
          : "failed",
      completedAt: new Date().toISOString(),
    });
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
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
