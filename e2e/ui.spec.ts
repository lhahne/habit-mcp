import { expect, seed, signE2eJwt, test } from "./fixtures.js";

function todayUtcIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftIso(iso: string, days: number): string {
  const p = iso.split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

let nextSuffix = 0;
function uniqueName(prefix: string): string {
  nextSuffix += 1;
  return `${prefix}-${Date.now()}-${nextSuffix}`;
}

test("returns 401 without Cf-Access header", async ({ request }) => {
  const res = await request.get("/ui", { failOnStatusCode: false });
  expect(res.status()).toBe(401);
});

test("allowlist mismatch yields 401", async ({ browser }) => {
  const jwt = await signE2eJwt("stranger@example.com");
  const ctx = await browser.newContext({
    extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": jwt },
  });
  const res = await ctx.request.get("/ui", { failOnStatusCode: false });
  expect(res.status()).toBe(401);
  await ctx.close();
});

test("renders the VariantE shell with eyebrow and title", async ({
  authedPage,
}) => {
  const res = await authedPage.goto("/ui");
  expect(res?.status()).toBe(200);
  await expect(
    authedPage.getByText("habit tracker · combined year"),
  ).toBeVisible();
  await expect(
    authedPage.getByText("Combined completion across all habits"),
  ).toBeVisible();
  await expect(authedPage.getByText("day by day")).toBeVisible();
});

test("heatmap renders 53x7 cells", async ({ authedPage }) => {
  await authedPage.goto("/ui");
  await expect(
    authedPage.locator('[data-testid="heatcell"]'),
  ).toHaveCount(53 * 7);
});

test("seeded habit appears in the habit strip", async ({
  authedPage,
  request,
}) => {
  const habit = uniqueName("Meditate");
  const today = todayUtcIso();
  await seed(request, {
    habits: [{ name: habit, startDate: shiftIso(today, -30) }],
  });

  await authedPage.goto("/ui");
  const card = authedPage
    .locator('[data-testid="habitcard"]')
    .filter({ hasText: habit });
  await expect(card).toBeVisible();
  await expect(card.getByText("Current", { exact: true })).toBeVisible();
  await expect(card.getByText("Longest", { exact: true })).toBeVisible();
  await expect(card.getByText("Rate", { exact: true })).toBeVisible();
});

test("a done check-in shows up as a non-empty heatmap cell and a journal row", async ({
  authedPage,
  request,
}) => {
  const habit = uniqueName("Run");
  const today = todayUtcIso();
  await seed(request, {
    habits: [{ name: habit, startDate: shiftIso(today, -10) }],
    checkIns: [{ habitName: habit, date: today, done: true, note: "5k easy" }],
  });

  await authedPage.goto("/ui");
  const cell = authedPage.locator(`[data-testid="heatcell"][data-date="${today}"]`);
  await expect(cell).toHaveAttribute("title", new RegExp(`^${today} · 1/\\d`));

  const row = authedPage.locator(`[data-testid="dayrow"][data-date="${today}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(habit);
  await expect(row).toContainText("5k easy");
});

test("a day comment renders in the journal and marks the cell", async ({
  authedPage,
  request,
}) => {
  const today = todayUtcIso();
  const comment = "Deliberate rest day. Slept 9 hours.";
  await seed(request, {
    comments: [{ date: today, comment }],
  });

  await authedPage.goto("/ui");
  const cell = authedPage.locator(`[data-testid="heatcell"][data-date="${today}"]`);
  await expect(cell).toHaveAttribute("title", /has comment$/);

  const row = authedPage.locator(`[data-testid="dayrow"][data-date="${today}"]`);
  await expect(row).toContainText(comment);
});

test("XSS inside a comment stays inert", async ({ authedPage, request }) => {
  const today = todayUtcIso();
  const payload = '<img src=x onerror="window.__xssFired=true">';
  await seed(request, {
    comments: [{ date: today, comment: payload }],
  });

  await authedPage.goto("/ui");
  const row = authedPage.locator(`[data-testid="dayrow"][data-date="${today}"]`);
  await expect(row).toContainText(payload);
  const fired = await authedPage.evaluate(
    () => (window as unknown as { __xssFired?: boolean }).__xssFired,
  );
  expect(fired).toBeUndefined();
});

test("health endpoint is reachable (webServer sanity)", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBe(true);
});
