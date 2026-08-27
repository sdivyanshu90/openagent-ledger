import { expect, test } from "@playwright/test";

interface ApiSnapshot {
  issues: { id: number; status: string }[];
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

test("approval executes exactly once and undo restores state", async ({
  page,
  request,
}) => {
  await page.getByRole("button", { name: /Scenarios/ }).click();
  const scenario = page
    .locator("article")
    .filter({ hasText: "Close resolved issue 42" });
  await scenario.getByRole("button", { name: /Run scenario/ }).click();
  await expect(page.getByRole("dialog")).toContainText("resolved");
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
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/rollback recorded/)).toBeVisible();
  snapshot = (await (await request.get("/api/snapshot")).json()) as ApiSnapshot;
  expect(snapshot.issues.find((issue) => issue.id === 42)?.status).toBe(
    "resolved",
  );
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
