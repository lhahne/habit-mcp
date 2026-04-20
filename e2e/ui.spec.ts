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

test("returns 200 with Cf-Access header", async ({ authedPage }) => {
  const res = await authedPage.goto("/ui");
  expect(res?.status()).toBe(200);
  await expect(authedPage.locator("#grid")).toBeVisible();
});

test("renders 90 cells by default", async ({ authedPage }) => {
  await authedPage.goto("/ui");
  const count = await authedPage.locator(".cell[data-date]").count();
  expect(count).toBe(90);
});

test("cells light up for days with done check-ins", async ({
  authedPage,
  request,
}) => {
  const habit = uniqueName("Meditate");
  const today = todayUtcIso();
  await seed(request, {
    habits: [{ name: habit, startDate: shiftIso(today, -30) }],
    checkIns: [{ habitName: habit, date: today, done: true }],
  });

  await authedPage.goto("/ui");
  const cell = authedPage.locator(`.cell[data-date="${today}"]`);
  await expect(cell).toBeVisible();
  await expect(cell).toHaveClass(/tier-[1-3]/);
});

test("clicking a cell opens the side panel with a long comment", async ({
  authedPage,
  request,
}) => {
  const habit = uniqueName("Run");
  const today = todayUtcIso();
  const long =
    "prefix-".repeat(1) +
    "x".repeat(2900) +
    "\n\nnewline-section\n" +
    "-suffix";
  await seed(request, {
    habits: [{ name: habit, startDate: shiftIso(today, -5) }],
    checkIns: [
      { habitName: habit, date: today, done: true, note: "felt great" },
    ],
    comments: [{ date: today, comment: long }],
  });

  await authedPage.goto("/ui");
  await authedPage.locator(`.cell[data-date="${today}"]`).click();
  await expect(authedPage.locator("#panel")).toBeVisible();
  await expect(authedPage.locator("#panel-date")).toHaveText(today);

  const commentText = await authedPage
    .locator("#comment")
    .evaluate((el) => el.textContent ?? "");
  expect(commentText).toContain("prefix-");
  expect(commentText).toContain("-suffix");
  expect(commentText.length).toBeGreaterThan(2900);

  const { scrollH, clientH } = await authedPage
    .locator("#comment")
    .evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    }));
  expect(scrollH).toBeGreaterThan(clientH);

  await expect(authedPage.locator("#habits li").filter({ hasText: habit }))
    .toBeVisible();
  await expect(
    authedPage.locator("#habits li .note").filter({ hasText: "felt great" }),
  ).toBeVisible();
});

test("habits inactive on the clicked date are hidden", async ({
  authedPage,
  request,
}) => {
  const active = uniqueName("ActiveHabit");
  const expired = uniqueName("ExpiredHabit");
  const today = todayUtcIso();
  await seed(request, {
    habits: [
      { name: active, startDate: shiftIso(today, -30) },
      {
        name: expired,
        startDate: shiftIso(today, -30),
        endDate: shiftIso(today, -10),
      },
    ],
    comments: [{ date: today, comment: "today" }],
  });

  await authedPage.goto("/ui");
  await authedPage.locator(`.cell[data-date="${today}"]`).click();

  await expect(
    authedPage.locator("#habits li").filter({ hasText: active }),
  ).toBeVisible();
  await expect(
    authedPage.locator("#habits li").filter({ hasText: expired }),
  ).toHaveCount(0);
});

test("XSS inside a comment stays inert", async ({ authedPage, request }) => {
  const today = todayUtcIso();
  const payload = '<img src=x onerror="window.__xssFired=true">';
  await seed(request, {
    comments: [{ date: today, comment: payload }],
  });

  await authedPage.goto("/ui");
  await authedPage.locator(`.cell[data-date="${today}"]`).click();
  await expect(authedPage.locator("#comment")).toHaveText(payload);
  const fired = await authedPage.evaluate(
    () => (window as unknown as { __xssFired?: boolean }).__xssFired,
  );
  expect(fired).toBeUndefined();
});

test("prev/next navigation shifts the 90-day window", async ({
  authedPage,
}) => {
  await authedPage.goto("/ui");
  const today = todayUtcIso();
  const expectedFrom = shiftIso(today, -89 - 90);
  const expectedTo = shiftIso(today, -90);

  await authedPage.locator("#prev").click();
  await expect(authedPage).toHaveURL(
    new RegExp(`\\?from=${expectedFrom}&to=${expectedTo}`),
  );
  await expect(authedPage.locator("#range-label")).toHaveText(
    `${expectedFrom} \u2192 ${expectedTo}`,
  );
});

test("health endpoint is reachable (webServer sanity)", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBe(true);
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
