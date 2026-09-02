import { expect, test } from "@playwright/test";

interface ApiSnapshot {
  issues: { id: number; status: string }[];
  ledger: {
    state: string;
    tool: string;
    reversible: boolean;
    transitions: { state: string }[];
  }[];
}

test.beforeEach(async ({ request, page }) => {
  await request.post("/api/demo/reset");
  await page.goto("/");
});

test("discovers and inspects guarded tools", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Agent tools" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /delete_issue/ }).click();
  await expect(page.getByText("high risk", { exact: true })).toBeVisible();
  await expect(page.getByText("Contract ambiguity detected")).toBeVisible();
  await expect(page.getByText("required", { exact: true })).toBeVisible();
});

test("keeps normal navigation usable without native WebMCP", async ({
  page,
}) => {
  await expect(
    page.getByText("Simulation mode · native unavailable"),
  ).toBeVisible();
  await expect(page.getByText("Simulation mode · 4 contracts")).toBeVisible();
  await page.getByRole("button", { name: /Scenarios/ }).click();
  await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
  await page.getByRole("button", { name: /Runs/ }).click();
  await expect(
    page.getByRole("heading", { name: "Runs & traces" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Trace \/ Ledger/ }).click();
  await expect(
    page.getByRole("heading", { name: "Action Ledger" }),
  ).toBeVisible();
});

test("approval executes exactly once and undo restores state", async ({
  page,
  request,
}) => {
  await page.getByRole("button", { name: /Scenarios/ }).click();
  const scenario = page
    .locator("article")
    .filter({ hasText: "Close resolved issue 42" });
  await scenario.getByRole("button", { name: /Run scenario/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Issue #42 · Login redirects twice");
  await expect(dialog).toContainText("Nothing has executed yet.");
  await expect(dialog).toContainText("close_issue");
  await expect(dialog).toContainText("Can be undone after verification");
  let snapshot = (await (
    await request.get("/api/snapshot")
  ).json()) as ApiSnapshot;
  expect(snapshot.issues.find((issue) => issue.id === 42)?.status).toBe(
    "resolved",
  );
  await page.getByRole("button", { name: "Approve & execute" }).click();
  await expect(
    page.getByText("Action executed once and verified."),
  ).toBeVisible();
  snapshot = (await (await request.get("/api/snapshot")).json()) as ApiSnapshot;
  expect(snapshot.issues.find((issue) => issue.id === 42)?.status).toBe(
    "closed",
  );
  expect(snapshot.ledger[0]?.transitions.map(({ state }) => state)).toEqual([
    "PREVIEWED",
    "AWAITING_CONFIRMATION",
    "APPROVED",
    "EXECUTING",
    "EXECUTED",
    "VERIFIED",
  ]);
  await page.reload();
  await page.getByRole("button", { name: /Trace \/ Ledger/ }).click();
  await expect(
    page.locator(".ledger-row > span:first-child").filter({
      hasText: "VERIFIED",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(page.getByText(/Integrity verified:/)).toBeVisible();
  await page.getByRole("button", { name: "Test broken fixture" }).click();
  await expect(
    page.getByText(/Integrity failure in safe fixture/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/rollback recorded/)).toBeVisible();
  snapshot = (await (await request.get("/api/snapshot")).json()) as ApiSnapshot;
  expect(snapshot.issues.find((issue) => issue.id === 42)?.status).toBe(
    "resolved",
  );
  expect(snapshot.ledger[0]?.state).toBe("ROLLED_BACK");
});

test("keeps primary run evidence within a laptop viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: /Scenarios/ }).click();
  const scenario = page
    .locator("article")
    .filter({ hasText: "Close resolved issue 42" });
  await scenario.getByRole("button", { name: /Run scenario/ }).click();
  await page.getByRole("button", { name: "Approve & execute" }).click();
  await page.getByRole("button", { name: /Runs/ }).click();
  await expect(page.getByText("Action · VERIFIED")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("identifies and safely rejects an irreversible target", async ({
  page,
  request,
}) => {
  await page.getByRole("button", { name: /Scenarios/ }).click();
  const scenario = page
    .locator("article")
    .filter({ hasText: "Permanently delete issue 183" });
  await scenario.getByRole("button", { name: /Run scenario/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Issue #183 · Test fixture: obsolete webhook",
  );
  await expect(dialog).toContainText("Nothing has executed yet.");
  await expect(dialog).toContainText("This action is irreversible");
  await expect(
    page.getByRole("button", { name: "Approve & execute" }),
  ).toBeDisabled();

  const before = (await (
    await request.get("/api/snapshot")
  ).json()) as ApiSnapshot;
  expect(before.issues.find(({ id }) => id === 183)?.status).toBe("resolved");
  await page.getByRole("button", { name: "Reject" }).click();
  const after = (await (
    await request.get("/api/snapshot")
  ).json()) as ApiSnapshot;
  expect(after.issues.find(({ id }) => id === 183)).toEqual(
    before.issues.find(({ id }) => id === 183),
  );
  expect(after.ledger[0]?.state).toBe("REJECTED");
  expect(after.ledger[0]?.reversible).toBe(false);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
});

test("flagship contract improvement changes deterministic selection", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Scenarios/ }).click();
  const flagship = page
    .locator("article")
    .filter({ hasText: "Clean up old resolved issues" });
  await flagship.getByRole("button", { name: /Run scenario/ }).click();
  await expect(page.getByRole("dialog")).toContainText("delete_issue");
  await page.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("button", { name: /Tools/ }).click();
  await page.getByRole("button", { name: /delete_issue/ }).click();
  await page.getByRole("button", { name: "Apply improved contract" }).click();
  await page.getByRole("button", { name: /Scenarios/ }).click();
  await flagship.getByRole("button", { name: /Run scenario/ }).click();
  await expect(page.getByRole("dialog")).toContainText("close_issue");
});

test("@a11y confirmation can be rejected with keyboard navigation", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Scenarios/ }).click();
  const scenario = page
    .locator("article")
    .filter({ hasText: "Permanently delete issue 183" });
  await scenario.getByRole("button", { name: /Run scenario/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Reject" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/application state was unchanged/)).toBeVisible();
});
