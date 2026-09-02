import { verify as verifySignature } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionRuntime, RuntimeError } from "./runtime";
import { MemoryStore } from "./store";

describe("ActionRuntime", () => {
  let store: MemoryStore;
  let runtime: ActionRuntime;

  beforeEach(() => {
    store = new MemoryStore();
    runtime = new ActionRuntime(store);
  });

  it("enforces confirmation at the execution boundary", async () => {
    const { action } = await runtime.runScenario("delete-issue-183");
    await expect(
      runtime.approve(action.id, "attacker-session", "183"),
    ).rejects.toMatchObject({
      code: "INVALID_APPROVAL",
      statusCode: 403,
    });
    expect(
      (await store.read()).issues.find(({ id }) => id === 183)?.status,
    ).toBe("resolved");
  });

  it("executes at most once under concurrent approval and rejects credential reuse", async () => {
    const { action } = await runtime.runScenario("close-issue-42");
    const approvals = await Promise.allSettled([
      runtime.approve(action.id),
      runtime.approve(action.id),
    ]);
    expect(
      approvals.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      approvals.filter(({ status }) => status === "rejected"),
    ).toHaveLength(1);
    await expect(runtime.approve(action.id)).rejects.toMatchObject({
      code: "APPROVAL_USED",
    });
    expect(
      (await store.read()).issues.find(({ id }) => id === 42)?.revision,
    ).toBe(2);
  });

  it("records rejection without mutating application state", async () => {
    const { action } = await runtime.runScenario("delete-issue-183");
    await runtime.reject(action.id);
    const database = await store.read();
    expect(database.ledger[0]?.state).toBe("REJECTED");
    expect(database.issues.find(({ id }) => id === 183)?.status).toBe(
      "resolved",
    );
  });

  it("requires explicit server-side acknowledgement for irreversible deletion", async () => {
    const { action } = await runtime.runScenario("delete-issue-183");
    await expect(runtime.approve(action.id)).rejects.toMatchObject({
      code: "IRREVERSIBLE_ACK_REQUIRED",
    });
    expect(
      (await store.read()).issues.find(({ id }) => id === 183)?.status,
    ).toBe("resolved");

    await runtime.approve(action.id, "test-human-session", "183");
    const database = await store.read();
    expect(database.issues.find(({ id }) => id === 183)?.status).toBe(
      "deleted",
    );
    await expect(runtime.undo(action.id)).rejects.toMatchObject({
      code: "NOT_REVERSIBLE",
    });
  });

  it("performs a real, idempotent rollback", async () => {
    const { action } = await runtime.runScenario("close-issue-42");
    await runtime.approve(action.id);
    const first = await runtime.undo(action.id);
    const second = await runtime.undo(action.id);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(
      (await store.read()).issues.find(({ id }) => id === 42)?.status,
    ).toBe("resolved");
  });

  it("records rollback failure instead of reporting restoration", async () => {
    const { action } = await runtime.runScenario("close-issue-42");
    await runtime.approve(action.id);
    await store.transaction((database) => {
      database.issues.find(({ id }) => id === 42)!.revision += 1;
    });
    await expect(runtime.undo(action.id)).rejects.toMatchObject({
      code: "STALE_ROLLBACK",
    });
    const failedRollback = (await store.read()).ledger[0];
    expect(failedRollback?.state).toBe("ROLLBACK_FAILED");
    expect(failedRollback?.rollbackError).toContain("resource changed");
  });

  it("blocks and records an execution based on a stale preview", async () => {
    const { action } = await runtime.runScenario("close-issue-42");
    await store.transaction((database) => {
      database.issues.find(({ id }) => id === 42)!.revision += 1;
    });
    await expect(runtime.approve(action.id)).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "STALE_PREVIEW" }),
    );
    const database = await store.read();
    expect(database.ledger[0]?.state).toBe("FAILED");
    expect(database.issues.find(({ id }) => id === 42)?.status).toBe(
      "resolved",
    );
  });

  it("records explicit FAILED states for execution and verification failures", async () => {
    const executionStore = new MemoryStore();
    const executionRuntime = new ActionRuntime(executionStore, {
      beforeExecution: () => {
        throw new Error("Synthetic adapter outage");
      },
    });
    const execution = await executionRuntime.runScenario("close-issue-42");
    await expect(
      executionRuntime.approve(execution.action.id),
    ).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
    expect((await executionStore.read()).ledger[0]).toMatchObject({
      state: "FAILED",
      error: "Synthetic adapter outage",
    });

    const verificationStore = new MemoryStore();
    const verificationRuntime = new ActionRuntime(verificationStore, {
      beforeVerification: ({ issue }) => {
        issue.status = "resolved";
      },
    });
    const verification =
      await verificationRuntime.runScenario("close-issue-42");
    await expect(
      verificationRuntime.approve(verification.action.id),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    const failedVerification = (await verificationStore.read()).ledger[0];
    expect(failedVerification?.state).toBe("FAILED");
    expect(failedVerification?.error).toContain("Expected issue status closed");
  });

  it("redacts secrets before persistence", async () => {
    await runtime.runScenario("close-issue-42");
    expect(JSON.stringify(await store.read())).not.toContain(
      "fixture-secret-never-persist",
    );
  });

  it("expires approval grants and excludes credentials from public evidence", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-02T10:00:00.000Z"));
      const { action } = await runtime.runScenario("close-issue-42");
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      await expect(runtime.approve(action.id)).rejects.toMatchObject({
        code: "APPROVAL_EXPIRED",
      });
      const snapshot = await runtime.snapshot();
      const exported = await runtime.exportLedger();
      expect(JSON.stringify(snapshot)).not.toContain("approvalToken");
      expect(JSON.stringify(exported)).not.toContain("approvalToken");
      expect(exported.algorithm).toBe("Ed25519");
      expect(exported.publicKey).toContain("BEGIN PUBLIC KEY");
      expect(exported.signature.length).toBeGreaterThan(40);
      const { publicKey, signature, ...signedPayload } = exported;
      expect(
        verifySignature(
          null,
          Buffer.from(JSON.stringify(signedPayload)),
          publicKey,
          Buffer.from(signature, "base64"),
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("verifies the persisted hash chain and detects a safe broken fixture", async () => {
    const { action } = await runtime.runScenario("close-issue-42");
    await runtime.approve(action.id);
    await expect(runtime.verifyIntegrity()).resolves.toMatchObject({
      valid: true,
      checkedEntries: 1,
    });
    await expect(runtime.verifyIntegrity(true)).resolves.toMatchObject({
      valid: false,
      fixture: true,
      broken: { reason: "Immutable entry evidence was modified." },
    });
  });

  it("invokes read-only site capabilities and records observable activity", async () => {
    const search = await runtime.invokeCapability("search_issues", {
      query: "login",
      status: "resolved",
    });
    const detail = await runtime.invokeCapability("get_issue", { issueId: 42 });
    expect(search).toMatchObject({
      tool: "search_issues",
      total: 2,
      count: 2,
      filters: { query: "login", status: "resolved", limit: 20 },
    });
    expect(detail).toMatchObject({
      tool: "get_issue",
      issue: { id: 42, revision: 1 },
    });
    const database = await store.read();
    expect(database.activities).toHaveLength(2);
    expect(database.ledger).toHaveLength(0);
  });

  it("supports keyword-only, status-only, combined, limited, and empty searches", async () => {
    await expect(
      runtime.invokeCapability("search_issues", { query: "login" }),
    ).resolves.toMatchObject({ total: 2, count: 2 });
    await expect(
      runtime.invokeCapability("search_issues", { query: "resolved login" }),
    ).resolves.toMatchObject({
      total: 2,
      filters: { query: "login", status: "resolved" },
    });
    await expect(
      runtime.invokeCapability("search_issues", { status: "open" }),
    ).resolves.toMatchObject({
      total: 1,
      issues: [{ id: 201, status: "open" }],
    });
    await expect(
      runtime.invokeCapability("search_issues", {
        query: "login",
        status: "resolved",
        limit: 1,
      }),
    ).resolves.toMatchObject({ total: 2, count: 1, issues: [{ id: 42 }] });
    await expect(
      runtime.invokeCapability("search_issues", {
        query: "does-not-exist",
        status: "resolved",
      }),
    ).resolves.toMatchObject({ total: 0, count: 0, issues: [] });
    await expect(
      runtime.invokeCapability("search_issues", { status: "invalid" }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("turns a direct mutating site tool into an idempotent guarded proposal", async () => {
    const input = {
      issueId: 42,
      reason: "Close the resolved login issue.",
      idempotencyKey: "site-call-42-close",
    };
    const first = await runtime.invokeCapability("close_issue", input);
    const second = await runtime.invokeCapability("close_issue", input);
    if (!("action" in first) || !("action" in second))
      throw new Error("Expected guarded action proposals.");
    expect(first).toMatchObject({
      tool: "close_issue",
      action: { state: "AWAITING_CONFIRMATION" },
      idempotent: false,
    });
    expect(second).toMatchObject({
      action: { id: first.action.id },
      idempotent: true,
    });
    const database = await store.read();
    expect(database.ledger).toHaveLength(1);
    expect(database.activities[0]).toMatchObject({
      source: "webmcp",
      phase: "proposed",
      actionId: first.action.id,
    });
    expect(database.issues.find(({ id }) => id === 42)?.status).toBe(
      "resolved",
    );
  });

  it("replays an idempotency key without creating or executing another action", async () => {
    const input = {
      issueId: 42,
      reason: "Close the resolved login issue.",
      idempotencyKey: "stable-close-42",
    };
    const proposed = await runtime.invokeCapability("close_issue", input);
    if (!("action" in proposed)) throw new Error("Expected a proposal.");
    await runtime.approve(proposed.action.id);
    const replay = await runtime.invokeCapability("close_issue", input);
    expect(replay).toMatchObject({
      idempotent: true,
      action: { id: proposed.action.id, state: "VERIFIED" },
    });
    const database = await store.read();
    expect(database.ledger).toHaveLength(1);
    expect(database.issues.find(({ id }) => id === 42)?.revision).toBe(2);
  });

  it("rejects malformed or unsupported site capability requests", async () => {
    await expect(
      runtime.invokeCapability("delete_issue", { issueId: 183 }),
    ).rejects.toMatchObject({
      name: "ZodError",
    });
    await expect(
      runtime.invokeCapability("approve_issue", {}),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    expect((await store.read()).ledger).toHaveLength(0);
  });
});
