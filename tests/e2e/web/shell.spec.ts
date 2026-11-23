import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });
  await page.route("**/conversations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ conversations: [] }),
    });
  });
  await page.route("**/mailbox**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    });
  });
});

test("home shell shows health, ghost mode and the skip link", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("health-status")).toHaveText("Health: ok");
  await expect(page.getByTestId("ghost-mode")).toHaveText(
    "Ghost Mode: on (local storage only)",
  );

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toHaveCount(1);
  await expect(skipLink).toHaveAttribute("href", "#main-content");
  await expect(skipLink).toBeVisible();
});

test("conversations navigation shows the list and demo warning", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Conversations" }).click();

  await expect(page).toHaveURL(/\/conversations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Conversations" })).toBeVisible();
  await expect(page.getByText("No conversations yet.")).toBeVisible();
  await expect(page.getByText("demo / not E2EE")).toBeVisible();
  await expect(page.getByLabel("Message (demo, not encrypted)")).toBeVisible();
});
