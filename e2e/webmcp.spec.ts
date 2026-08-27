import { expect, test } from "@playwright/test";

interface CapturedSiteTool {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    __siteTools: Map<string, CapturedSiteTool>;
  }
}

test.beforeEach(async ({ request, page }) => {
  await request.post("/api/demo/reset");
  await page.addInitScript(() => {
    const captured = new Map<string, CapturedSiteTool>();
    Object.defineProperty(window, "__siteTools", { value: captured });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: CapturedSiteTool) {
          captured.set(tool.name, tool);
        },
      },
    });
  });
  await page.goto("/");
});

test("registers real capabilities and exposes verifiable read results", async ({
  page,
}) => {
  await expect(page.getByText("4 site tools live")).toBeVisible();
  const registration = await page.evaluate(() =>
    [...window.__siteTools].map(([name, tool]) => ({
      name,
      readOnly: tool.annotations?.readOnlyHint ?? false,
    })),
  );
  expect(registration).toEqual([
    { name: "search_issues", readOnly: true },
    { name: "get_issue", readOnly: true },
    { name: "close_issue", readOnly: false },
    { name: "delete_issue", readOnly: false },
  ]);

  const result = await page.evaluate(() =>
    window.__siteTools
      .get("search_issues")!
      .execute({ query: "login", status: "resolved" }),
  );
  expect(result).toMatchObject({ tool: "search_issues", count: 2 });
  await expect(page.getByLabel("Site tool activity")).toContainText(
    "Found 2 matching issues.",
  );
});

test("keeps a mutating site-tool proposal under human control", async ({
  page,
  request,
}) => {
  await expect
    .poll(() => page.evaluate(() => window.__siteTools.has("close_issue")))
    .toBe(true);
  const result = await page.evaluate(() =>
    window.__siteTools.get("close_issue")!.execute({
      issueId: 42,
      reason: "Close the resolved login issue requested by the user.",
      idempotencyKey: "chatgpt-close-issue-42",
    }),
  );
  expect(result).toMatchObject({
    status: "awaiting_human_confirmation",
    tool: "close_issue",
    reversible: true,
  });
  expect(result).not.toHaveProperty("approvalToken");
  await expect(page.getByRole("dialog")).toContainText(
    "Agent proposed an action",
  );

  let snapshot = (await (await request.get("/api/snapshot")).json()) as {
    issues: { id: number; status: string }[];
    ledger: unknown[];
  };
  expect(snapshot.issues.find(({ id }) => id === 42)?.status).toBe("resolved");
  expect(snapshot.ledger).toHaveLength(1);

  await page.getByRole("button", { name: "Approve & execute" }).click();
  await expect(
    page.getByText("Action executed once and verified."),
  ).toBeVisible();
  snapshot = (await (
    await request.get("/api/snapshot")
  ).json()) as typeof snapshot;
  expect(snapshot.issues.find(({ id }) => id === 42)?.status).toBe("closed");
  await page.getByRole("button", { name: /Tools/ }).click();
  await expect(page.getByLabel("Site tool activity")).toContainText(
    "Human approved close_issue",
  );
});
