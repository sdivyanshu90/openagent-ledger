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

  it("exposes actual application capabilities through the guarded API", async () => {
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
        action: z.object({ state: z.string() }),
        approvalToken: z.string(),
      })
      .parse(response.json());
    expect(body.action.state).toBe("AWAITING_CONFIRMATION");
    expect(body.approvalToken.length).toBeGreaterThan(20);
  });
});
