import { verifyCfAccessJwt } from "../auth/cf-access.js";
import { listDays } from "../db/days.js";
import { listHabits } from "../db/habits.js";
import { isIsoDate } from "../util/date.js";
import { renderUiPage } from "./page.js";

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
};

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

function todayUtcIso(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftIso(iso: string, days: number): string {
  const parts = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Cap on the requested window. Renders one cell per day and embeds
// every check-in in that range, so without a cap a hostile or curious
// `?from=`/`?to=` could trigger a very large DB read and HTML payload.
const MAX_RANGE_DAYS = 366;

function daysBetweenInclusive(from: string, to: string): number {
  const f = new Date(`${from}T00:00:00Z`).getTime();
  const t = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((t - f) / 86_400_000) + 1;
}

export async function handleUiRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const email = await verifyCfAccessJwt(request, env);
  if (!email) {
    return new Response("Unauthorized", { status: 401, headers: TEXT_HEADERS });
  }

  const url = new URL(request.url);
  const today = todayUtcIso();
  const toParam = url.searchParams.get("to");
  const fromParam = url.searchParams.get("from");

  const to = toParam ?? today;
  const from = fromParam ?? shiftIso(to, -89);

  if (!isIsoDate(from) || !isIsoDate(to)) {
    return new Response("Bad Request: invalid date format", {
      status: 400,
      headers: TEXT_HEADERS,
    });
  }
  if (from > to) {
    return new Response("Bad Request: from must be <= to", {
      status: 400,
      headers: TEXT_HEADERS,
    });
  }
  if (daysBetweenInclusive(from, to) > MAX_RANGE_DAYS) {
    return new Response(
      `Bad Request: range exceeds ${MAX_RANGE_DAYS} days`,
      { status: 400, headers: TEXT_HEADERS },
    );
  }

  const [habits, days] = await Promise.all([
    listHabits(env.DB),
    listDays(env.DB, { from, to }),
  ]);

  const html = renderUiPage({ habits, days, from, to });
  return new Response(html, { status: 200, headers: HTML_HEADERS });
}
