import { beforeEach, describe, expect, it } from "vitest";
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
      runtime.approve(action.id, "not-a-valid-approval-token-value"),
    ).rejects.toMatchObject({
      code: "INVALID_APPROVAL",
      statusCode: 403,
    });
    expect(
      (await store.read()).issues.find(({ id }) => id === 183)?.status,
    ).toBe("resolved");
  });

  it("executes once and makes duplicate approval idempotent", async () => {
    const { action, approvalToken } =
      await runtime.runScenario("close-issue-42");
    const first = await runtime.approve(action.id, approvalToken);
    const second = await runtime.approve(action.id, approvalToken);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
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

  it("performs a real, idempotent rollback", async () => {
    const { action, approvalToken } =
      await runtime.runScenario("close-issue-42");
    await runtime.approve(action.id, approvalToken);
    const first = await runtime.undo(action.id);
    const second = await runtime.undo(action.id);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(
      (await store.read()).issues.find(({ id }) => id === 42)?.status,
    ).toBe("resolved");
  });

  it("blocks and records an execution based on a stale preview", async () => {
    const { action, approvalToken } =
      await runtime.runScenario("close-issue-42");
    await store.transaction((database) => {
      database.issues.find(({ id }) => id === 42)!.revision += 1;
    });
    await expect(runtime.approve(action.id, approvalToken)).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "STALE_PREVIEW" }),
    );
    const database = await store.read();
    expect(database.ledger[0]?.state).toBe("FAILED");
    expect(database.issues.find(({ id }) => id === 42)?.status).toBe(
      "resolved",
    );
  });

  it("redacts secrets before persistence", async () => {
    await runtime.runScenario("close-issue-42");
    expect(JSON.stringify(await store.read())).not.toContain(
      "fixture-secret-never-persist",
    );
  });

  it("invokes read-only site capabilities and records observable activity", async () => {
    const search = await runtime.invokeCapability("search_issues", {
      query: "login",
      status: "resolved",
    });
    const detail = await runtime.invokeCapability("get_issue", { issueId: 42 });
    expect(search).toMatchObject({ tool: "search_issues", count: 2 });
    expect(detail).toMatchObject({
      tool: "get_issue",
      issue: { id: 42, revision: 1 },
    });
    const database = await store.read();
    expect(database.activities).toHaveLength(2);
    expect(database.ledger).toHaveLength(0);
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
