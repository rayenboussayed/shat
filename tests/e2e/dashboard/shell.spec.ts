import { expect, test } from "@playwright/test";

/**
 * Browser coverage for the dashboard shell. All backend responses are stubbed
 * with `page.route` so the suite is deterministic and asserts only what the app
 * actually renders: the auth warning, the health states, the honest (numeric-
 * free) metrics panel and the route list.
 */
test.beforeEach(async ({ page }) => {
  await page.route("**/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ status: "ok" }),
    });
  });
});

test("shell shows the dashboard heading and the honest auth warning", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "SHAT Operations Dashboard" }),
  ).toBeVisible();
  await expect(page.getByRole("main", { name: "SHAT operations dashboard" })).toBeVisible();

  const warning = page.getByTestId("auth-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute("role", "alert");
  await expect(warning).toContainText("no built-in authentication or authorization");
  await expect(warning).toContainText(
    "must be deployed behind an authenticating reverse proxy",
  );
  await expect(warning).toContainText("must not be exposed publicly");
});

test("health status renders ok from a healthy /health response", async ({ page }) => {
  await page.goto("/");

  const health = page.getByTestId("health-status");
  await expect(health).toHaveAttribute("role", "status");
  await expect(health).toHaveText("Health: ok");
});

test("health status renders error from a failing /health response", async ({ page }) => {
  await page.route("**/health", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ status: "error" }),
    });
  });

  await page.goto("/");

  await expect(page.getByTestId("health-status")).toHaveText("Health: error");
});

test("metrics panel is honest and shows no fabricated numbers", async ({ page }) => {
  await page.goto("/");

  const panel = page.getByTestId("metrics-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("aria-label", "Operations metrics");
  await expect(panel).toContainText("Live telemetry is not wired into this dashboard yet");
  await expect(panel).toContainText("GET /telemetry/summary");
  await expect(panel).toContainText("No fabricated metrics are shown.");
  // The panel must not display any fabricated counts or latency numbers yet.
  await expect(panel).not.toContainText(/\d/);
});

test("route list is rendered and includes /health", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Backend routes (subset)" })).toBeVisible();
  await expect(page.getByText("not exhaustive", { exact: false })).toBeVisible();

  const routeList = page.getByTestId("route-list");
  await expect(routeList).toBeVisible();
  const items = routeList.getByTestId("route-item");
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(0);
  await expect(items.filter({ hasText: "/health" })).toHaveCount(1);
  await expect(items.filter({ hasText: "/conversations" })).toHaveCount(1);
  await expect(items.filter({ hasText: "/mailbox" }).first()).toBeVisible();
});
