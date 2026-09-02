import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "./app";
import { MemoryStore } from "./store";

describe("HTTP API", () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("serves a validated snapshot and creates a run", async () => {
    const app = buildApp(new MemoryStore());
    apps.push(app);
    const snapshot = await app.inject({ method: "GET", url: "/api/snapshot" });
    expect(snapshot.statusCode).toBe(200);
    const snapshotBody = z
      .object({ tools: z.array(z.unknown()) })
      .parse(snapshot.json());
    expect(snapshotBody.tools).toHaveLength(4);
    const run = await app.inject({
      method: "POST",
      url: "/api/scenarios/close-issue-42/runs",
    });
    expect(run.statusCode).toBe(201);
    const runBody = z
      .object({ action: z.object({ state: z.string() }) })
      .parse(run.json());
    expect(runBody.action.state).toBe("AWAITING_CONFIRMATION");
  });

  it("returns actionable validation errors", async () => {
    const app = buildApp(new MemoryStore());
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/scenarios",
      payload: { name: "x" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("exposes guarded proposals without returning approval credentials", async () => {
    const app = buildApp(new MemoryStore());
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/capabilities/close_issue/invoke",
      payload: {
        source: "webmcp",
        input: {
          issueId: 42,
          reason: "Close this resolved issue.",
          idempotencyKey: "browser-call-42",
        },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = z
      .object({
        action: z.object({ id: z.string().uuid(), state: z.string() }),
      })
      .parse(response.json());
    expect(body.action.state).toBe("AWAITING_CONFIRMATION");
    expect(JSON.stringify(response.json())).not.toContain("approvalToken");

    const setCookie = response.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";",
    )[0];
    expect(cookie).toContain("openagent_human_session=");
    const unscopedApproval = await app.inject({
      method: "POST",
      url: `/api/actions/${body.action.id}/approve`,
      payload: {},
    });
    expect(unscopedApproval.statusCode).toBe(403);
    expect(unscopedApproval.json()).toMatchObject({
      code: "INVALID_APPROVAL",
    });
    const approved = await app.inject({
      method: "POST",
      url: `/api/actions/${body.action.id}/approve`,
      headers: { cookie: cookie! },
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      action: { state: "VERIFIED" },
      issue: { status: "closed" },
    });
  });

  it("does not expose an unapproved execution endpoint", async () => {
    const app = buildApp(new MemoryStore());
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/actions/00000000-0000-4000-8000-000000000001/execute",
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });
});
