export const ONE_DAY = 86_400_000;

export function parseIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysIso(iso: string, n: number): string {
  return toIso(new Date(parseIso(iso).getTime() + n * ONE_DAY));
}

export function todayIso(): string {
  return toIso(new Date());
}

export function fmtMD(iso: string): string {
  return parseIso(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function fmtMonthYear(iso: string): string {
  return parseIso(iso).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function fmtHabitId(id: number): string {
  return `#${String(id).padStart(3, "0")}`;
}

// Grid starts on the Sunday of the week containing `gridEnd`'s DOW-shift,
// matching variant-e.jsx: gridEnd = today + (6 - endDow)*day (next Saturday),
// gridStart = gridEnd - 7*53 + 1.
export function computeGridRange(today: string): {
  gridStart: string;
  gridEnd: string;
} {
  const end = parseIso(today);
  const endDow = end.getUTCDay();
  const gridEnd = toIso(new Date(end.getTime() + (6 - endDow) * ONE_DAY));
  const gridStart = addDaysIso(gridEnd, -7 * 53 + 1);
  return { gridStart, gridEnd };
}

export function monthLabels(
  gridStart: string,
): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < 53; w++) {
    const d = parseIso(addDaysIso(gridStart, w * 7));
    const m = d.getUTCMonth();
    if (m !== lastMonth) {
      out.push({
        col: w,
        label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      });
      lastMonth = m;
    }
  }
  return out;
}
