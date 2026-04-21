// Client-side Vue app for /ui. Bundled by scripts/build-ui.mjs into
// src/ui/client-bundle.gen.ts and inlined into the HTML response.
//
// Ports the VariantE design from design_handoff_habit_tracker/ into Vue
// render functions. Render functions (no templates) are required because
// the response CSP forbids 'unsafe-eval', which Vue's runtime template
// compiler needs.
//
// All layout lives in inline style objects, mirroring the design source;
// the only global CSS lives in src/ui/page.ts (reset + @font-face).

import {
  type VNode,
  createApp,
  defineComponent,
  h,
} from "vue";

interface UiHabit {
  id: number;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
}

interface UiCheckIn {
  habitId: number;
  done: boolean;
  note: string | null;
}

interface UiDay {
  date: string;
  comment: string;
  checkIns: UiCheckIn[];
}

interface UiData {
  habits: UiHabit[];
  days: UiDay[];
  from: string;
  to: string;
}

// ---- design tokens (mirror of ui-kit.jsx `T`) -------------------------

const T = {
  bg: "#f6f3ed",
  panel: "#ffffff",
  panelAlt: "#faf7f1",
  rule: "#e8e2d6",
  ruleSoft: "#efebe0",
  ink: "#1c1a17",
  ink2: "#3a362f",
  ink3: "#6b6558",
  muted: "#9a9384",
  mutedSoft: "#bfb8a8",
  a0: "#ebe7dc",
  a1: "#b8d4b1",
  a2: "#7eb87a",
  a3: "#4a9a58",
  a4: "#2a7a3f",
  missStrong: "#8a6a5c",
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  sans: 'Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
} as const;

const HABIT_COLORS = [T.a1, T.a2, T.a3, T.a4] as const;

// ---- pure helpers ------------------------------------------------------

const ONE_DAY = 86_400_000;

function parseIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso: string, n: number): string {
  return toIso(new Date(parseIso(iso).getTime() + n * ONE_DAY));
}

function todayIso(): string {
  return toIso(new Date());
}

function fmtMD(iso: string): string {
  return parseIso(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtMonthYear(iso: string): string {
  return parseIso(iso).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtHabitId(id: number): string {
  return `#${String(id).padStart(3, "0")}`;
}

// Grid starts on the Sunday of the week containing `gridEnd`'s DOW-shift,
// matching variant-e.jsx: gridEnd = today + (6 - endDow)*day (next Saturday),
// gridStart = gridEnd - 7*53 + 1.
function computeGridRange(today: string): { gridStart: string; gridEnd: string } {
  const end = parseIso(today);
  const endDow = end.getUTCDay();
  const gridEnd = toIso(new Date(end.getTime() + (6 - endDow) * ONE_DAY));
  const gridStart = addDaysIso(gridEnd, -7 * 53 + 1);
  return { gridStart, gridEnd };
}

function monthLabels(gridStart: string): { col: number; label: string }[] {
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

// ---- selectors ---------------------------------------------------------

type CheckInLite = { done: boolean; note: string | null };
type ByHabitDate = Map<number, Map<string, CheckInLite>>;

function buildByHabitDate(days: UiDay[]): ByHabitDate {
  const out: ByHabitDate = new Map();
  for (const d of days) {
    for (const c of d.checkIns) {
      let inner = out.get(c.habitId);
      if (!inner) {
        inner = new Map();
        out.set(c.habitId, inner);
      }
      inner.set(d.date, { done: c.done, note: c.note });
    }
  }
  return out;
}

interface Streaks {
  current: number;
  longest: number;
  total: number;
  done: number;
  rate: number;
}

// Clamp a habit's active window to the slice of the timeline for which the
// server actually sent us data. `[viewStart, viewEnd]` is `[data.from,
// min(data.to, realToday)]` — outside that range we have no check_ins, so
// treating it as "missed" would silently inflate totals and drop rates.
function habitWindow(
  habit: UiHabit,
  viewStart: string,
  viewEnd: string,
): { start: string; end: string } | null {
  const start =
    habit.startDate > viewStart ? habit.startDate : viewStart;
  const end =
    habit.endDate && habit.endDate < viewEnd ? habit.endDate : viewEnd;
  if (start > end) return null;
  return { start, end };
}

function computeStreaks(
  habit: UiHabit,
  byHabitDate: ByHabitDate,
  viewStart: string,
  viewEnd: string,
): Streaks {
  const win = habitWindow(habit, viewStart, viewEnd);
  if (!win) return { current: 0, longest: 0, total: 0, done: 0, rate: 0 };
  const ci = byHabitDate.get(habit.id) ?? new Map<string, CheckInLite>();
  let total = 0;
  let done = 0;
  let longest = 0;
  let run = 0;
  for (let d = win.start; d <= win.end; d = addDaysIso(d, 1)) {
    total++;
    const c = ci.get(d);
    if (c && c.done) {
      done++;
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  let current = 0;
  for (let d = win.end; d >= win.start; d = addDaysIso(d, -1)) {
    const c = ci.get(d);
    if (c && c.done) current++;
    else break;
  }
  return { current, longest, total, done, rate: total ? done / total : 0 };
}

interface WeekRate {
  weekStart: string;
  weekEnd: string;
  done: number;
  total: number;
  rate: number | null;
}

function computeWeeklyRates(
  habit: UiHabit,
  byHabitDate: ByHabitDate,
  viewStart: string,
  viewEnd: string,
  nWeeks: number,
): WeekRate[] {
  const win = habitWindow(habit, viewStart, viewEnd);
  const ci = byHabitDate.get(habit.id) ?? new Map<string, CheckInLite>();
  const end = parseIso(viewEnd);
  const endDow = end.getUTCDay();
  const lastWeekEnd = toIso(new Date(end.getTime() + (6 - endDow) * ONE_DAY));
  const out: WeekRate[] = [];
  for (let w = 0; w < nWeeks; w++) {
    const wkEnd = addDaysIso(lastWeekEnd, -w * 7);
    const wkStart = addDaysIso(wkEnd, -6);
    let done = 0;
    let total = 0;
    if (win) {
      for (let i = 0; i < 7; i++) {
        const d = addDaysIso(wkStart, i);
        if (d < win.start || d > win.end) continue;
        total++;
        const c = ci.get(d);
        if (c && c.done) done++;
      }
    }
    out.push({
      weekStart: wkStart,
      weekEnd: wkEnd,
      done,
      total,
      rate: total ? done / total : null,
    });
  }
  return out.reverse();
}

interface DowEntry {
  dow: number;
  rate: number;
  done: number;
  total: number;
}

function computeDowProfile(
  habit: UiHabit,
  byHabitDate: ByHabitDate,
  viewStart: string,
  viewEnd: string,
): DowEntry[] {
  const buckets = Array.from({ length: 7 }, () => ({ done: 0, total: 0 }));
  const win = habitWindow(habit, viewStart, viewEnd);
  if (!win) {
    return buckets.map((b, i) => ({ dow: i, rate: 0, done: 0, total: 0 }));
  }
  const ci = byHabitDate.get(habit.id) ?? new Map<string, CheckInLite>();
  for (let d = win.start; d <= win.end; d = addDaysIso(d, 1)) {
    const dow = parseIso(d).getUTCDay();
    const b = buckets[dow]!;
    b.total++;
    const c = ci.get(d);
    if (c && c.done) b.done++;
  }
  return buckets.map((b, i) => ({
    dow: i,
    rate: b.total ? b.done / b.total : 0,
    done: b.done,
    total: b.total,
  }));
}

interface HeatCell {
  date: string;
  doneCount: number;
  activeHabits: number;
  // True when we have no check-in data for this cell — either past the
  // view window (`data.to` or real today, whichever is earlier) or before
  // `data.from`. Visually rendered the same as "future".
  noData: boolean;
  hasComment: boolean;
}

function computeHeatCells(
  habits: UiHabit[],
  byHabitDate: ByHabitDate,
  commentSet: Set<string>,
  gridStart: string,
  viewStart: string,
  viewEnd: string,
): HeatCell[][] {
  const cols: HeatCell[][] = [];
  for (let w = 0; w < 53; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDaysIso(gridStart, w * 7 + d);
      const noData = date < viewStart || date > viewEnd;
      let doneCount = 0;
      let activeHabits = 0;
      if (!noData) {
        for (const h of habits) {
          if (date < h.startDate) continue;
          if (h.endDate && date > h.endDate) continue;
          activeHabits++;
          const c = byHabitDate.get(h.id)?.get(date);
          if (c && c.done) doneCount++;
        }
      }
      col.push({
        date,
        doneCount,
        activeHabits,
        noData,
        hasComment: !noData && commentSet.has(date),
      });
    }
    cols.push(col);
  }
  return cols;
}

// ---- reusable components ----------------------------------------------

const Stat = defineComponent({
  name: "Stat",
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
    sub: { type: String, default: "" },
  },
  setup(props) {
    return () =>
      h("div", null, [
        h(
          "div",
          {
            style: {
              fontFamily: T.mono,
              fontSize: "9.5px",
              letterSpacing: "1.2px",
              textTransform: "uppercase",
              color: T.muted,
              marginBottom: "4px",
            },
          },
          props.label,
        ),
        h(
          "div",
          {
            style: {
              fontFamily: T.mono,
              fontSize: "22px",
              fontWeight: "500",
              color: T.ink,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.5px",
              lineHeight: "1",
            },
          },
          props.value,
        ),
        props.sub
          ? h(
              "div",
              {
                style: {
                  fontFamily: T.mono,
                  fontSize: "10.5px",
                  color: T.ink3,
                  marginTop: "4px",
                  fontVariantNumeric: "tabular-nums",
                },
              },
              props.sub,
            )
          : null,
      ]);
  },
});

// ---- layout components ------------------------------------------------

interface Totals {
  done: number;
  total: number;
}

const Header = defineComponent({
  name: "Header",
  props: {
    habits: { type: Array as () => UiHabit[], required: true },
    totals: { type: Object as () => Totals, required: true },
    commentDays: { type: Number, required: true },
    activeDays: { type: Number, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    today: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const titleRange = `${fmtMonthYear(props.from)} — ${fmtMonthYear(props.to)}`;
      const rate = props.totals.total
        ? Math.round((props.totals.done / props.totals.total) * 100)
        : 0;
      const weekday = parseIso(props.today).toLocaleString("en-US", {
        weekday: "long",
        timeZone: "UTC",
      });
      return h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "24px",
          },
        },
        [
          h("div", null, [
            h(
              "div",
              {
                style: {
                  fontFamily: T.mono,
                  fontSize: "11px",
                  letterSpacing: "1.4px",
                  textTransform: "uppercase",
                  color: T.muted,
                  marginBottom: "6px",
                },
              },
              "habit tracker · combined year",
            ),
            h(
              "div",
              {
                style: {
                  fontSize: "28px",
                  fontWeight: "600",
                  letterSpacing: "-0.6px",
                  color: T.ink,
                },
              },
              titleRange,
            ),
            h(
              "div",
              {
                style: {
                  fontSize: "13px",
                  color: T.ink3,
                  marginTop: "4px",
                },
              },
              `${props.habits.length} habits · ${props.totals.done.toLocaleString()} check-ins · ${props.commentDays} comments · ${props.activeDays} active days`,
            ),
          ]),
          h(
            "div",
            {
              style: { display: "flex", gap: "32px" },
            },
            [
              h(Stat, {
                label: "Overall rate",
                value: `${rate}%`,
                sub: `${props.totals.done} / ${props.totals.total}`,
              }),
              h(Stat, {
                label: "Today",
                value: fmtMD(props.today),
                sub: weekday,
              }),
            ],
          ),
        ],
      );
    };
  },
});

const CombinedHeat = defineComponent({
  name: "CombinedHeat",
  props: {
    cols: { type: Array as () => HeatCell[][], required: true },
    gridStart: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const cell = 14;
      const gap = 3;
      const labels = monthLabels(props.gridStart);
      let totalDone = 0;
      let totalSlots = 0;
      for (const col of props.cols) {
        for (const c of col) {
          if (c.noData) continue;
          if (c.activeHabits === 0) continue;
          totalDone += c.doneCount;
          totalSlots += c.activeHabits;
        }
      }
      const pct = totalSlots ? Math.round((totalDone / totalSlots) * 100) : 0;

      const legendSwatches: VNode[] = [
        h("div", {
          style: { width: `${cell}px`, height: `${cell}px`, background: T.a0 },
        }),
        ...HABIT_COLORS.map((c) =>
          h("div", {
            style: { width: `${cell}px`, height: `${cell}px`, background: c },
          }),
        ),
      ];

      const dowCol = h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: `${gap}px`,
            width: "24px",
          },
        },
        ["", "Mon", "", "Wed", "", "Fri", ""].map((lbl) =>
          h(
            "div",
            {
              style: {
                height: `${cell}px`,
                fontFamily: T.mono,
                fontSize: "10px",
                color: T.muted,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
              },
            },
            lbl,
          ),
        ),
      );

      const gridCols = props.cols.map((col, ci) =>
        h(
          "div",
          {
            key: ci,
            style: {
              display: "flex",
              flexDirection: "column",
              gap: `${gap}px`,
            },
          },
          col.map((c) => {
            const unshaded = c.noData || c.activeHabits === 0;
            const fill = unshaded
              ? "transparent"
              : c.doneCount === 0
                ? T.a0
                : HABIT_COLORS[Math.min(c.doneCount - 1, HABIT_COLORS.length - 1)];
            const tooltipParts = c.noData
              ? [c.date]
              : [`${c.date} · ${c.doneCount}/${c.activeHabits} done`];
            if (c.hasComment) tooltipParts.push("has comment");
            return h(
              "div",
              {
                key: c.date,
                "data-testid": "heatcell",
                "data-date": c.date,
                title: tooltipParts.join(" · "),
                style: {
                  width: `${cell}px`,
                  height: `${cell}px`,
                  position: "relative",
                  background: fill,
                  border: unshaded ? `1px dashed ${T.ruleSoft}` : "none",
                  boxSizing: "border-box",
                },
              },
              c.hasComment
                ? [
                    h("div", {
                      style: {
                        position: "absolute",
                        bottom: "1.5px",
                        right: "1.5px",
                        width: "3px",
                        height: "3px",
                        background: c.doneCount >= 2 ? "#fff" : T.missStrong,
                        borderRadius: "2px",
                      },
                    }),
                  ]
                : [],
            );
          }),
        ),
      );

      return h(
        "div",
        {
          style: {
            background: T.panel,
            border: `1px solid ${T.rule}`,
          },
        },
        [
          h(
            "div",
            {
              style: {
                padding: "16px 22px 12px",
                borderBottom: `1px solid ${T.ruleSoft}`,
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              },
            },
            [
              h("div", null, [
                h(
                  "div",
                  {
                    style: {
                      fontFamily: T.mono,
                      fontSize: "10.5px",
                      letterSpacing: "1.2px",
                      textTransform: "uppercase",
                      color: T.muted,
                      marginBottom: "2px",
                    },
                  },
                  "all check-ins · 53 weeks × 7 days",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontSize: "17px",
                      fontWeight: "600",
                      letterSpacing: "-0.3px",
                      color: T.ink,
                    },
                  },
                  "Combined completion across all habits",
                ),
              ]),
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontFamily: T.mono,
                    fontSize: "10.5px",
                    color: T.ink3,
                  },
                },
                [
                  h("span", null, "none"),
                  h(
                    "div",
                    { style: { display: "flex", gap: "2px" } },
                    legendSwatches,
                  ),
                  h("span", null, "all 3"),
                ],
              ),
            ],
          ),
          h("div", { style: { padding: "18px 22px 20px" } }, [
            h(
              "div",
              {
                style: {
                  position: "relative",
                  height: `${cell}px`,
                  marginLeft: "30px",
                },
              },
              labels.map((l) =>
                h(
                  "div",
                  {
                    key: l.col,
                    style: {
                      position: "absolute",
                      left: `${l.col * (cell + gap)}px`,
                      fontFamily: T.mono,
                      fontSize: "10.5px",
                      letterSpacing: "0.5px",
                      color: T.ink3,
                      textTransform: "uppercase",
                    },
                  },
                  l.label,
                ),
              ),
            ),
            h("div", { style: { display: "flex", gap: "8px" } }, [
              dowCol,
              h("div", { style: { display: "flex", gap: `${gap}px` } }, gridCols),
            ]),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: "14px",
                  fontFamily: T.mono,
                  fontSize: "10.5px",
                  color: T.muted,
                },
              },
              [
                h(
                  "span",
                  null,
                  "shade = habits completed that day · dot = day has a free-text comment",
                ),
                h(
                  "span",
                  { style: { color: T.ink3 } },
                  `${totalDone.toLocaleString()} check-ins of ${totalSlots.toLocaleString()} possible · ${pct}%`,
                ),
              ],
            ),
          ]),
        ],
      );
    };
  },
});

const WeeklySpark = defineComponent({
  name: "WeeklySpark",
  props: {
    weekly: { type: Array as () => WeekRate[], required: true },
  },
  setup(props) {
    return () => {
      const H = 34;
      const gap = 2;
      return h(
        "div",
        {
          style: { display: "flex", gap: `${gap}px`, alignItems: "flex-end" },
        },
        props.weekly.map((w, i) => {
          const rate = w.rate ?? 0;
          return h(
            "div",
            {
              key: i,
              title: `${w.weekStart} · ${w.done}/${w.total}`,
              style: {
                flex: "1",
                height: `${H}px`,
                display: "flex",
                alignItems: "flex-end",
                background: T.a0,
              },
            },
            [
              h("div", {
                style: {
                  width: "100%",
                  height: `${rate * 100}%`,
                  background: i === props.weekly.length - 1 ? T.a4 : T.a3,
                },
              }),
            ],
          );
        }),
      );
    };
  },
});

const DowStrip = defineComponent({
  name: "DowStrip",
  props: {
    dow: { type: Array as () => DowEntry[], required: true },
  },
  setup(props) {
    const labels = ["S", "M", "T", "W", "T", "F", "S"];
    return () =>
      h(
        "div",
        { style: { display: "flex", gap: "3px" } },
        props.dow.map((d) =>
          h(
            "div",
            {
              key: d.dow,
              style: {
                flex: "1",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
              },
            },
            [
              h(
                "div",
                {
                  style: {
                    width: "100%",
                    height: "26px",
                    background: T.a0,
                    position: "relative",
                  },
                },
                [
                  h("div", {
                    style: {
                      position: "absolute",
                      inset: "auto 0 0 0",
                      height: `${d.rate * 100}%`,
                      background: T.a3,
                    },
                  }),
                ],
              ),
              h(
                "div",
                {
                  style: {
                    fontFamily: T.mono,
                    fontSize: "9.5px",
                    color: T.ink3,
                  },
                },
                labels[d.dow] ?? "",
              ),
            ],
          ),
        ),
      );
  },
});

interface HabitPanel {
  habit: UiHabit;
  streaks: Streaks;
  weekly: WeekRate[];
  dow: DowEntry[];
}

const HabitStrip = defineComponent({
  name: "HabitStrip",
  props: {
    panels: { type: Array as () => HabitPanel[], required: true },
  },
  setup(props) {
    return () =>
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(1, props.panels.length)}, 1fr)`,
            gap: "20px",
          },
        },
        props.panels.map((p) =>
          h(
            "div",
            {
              key: p.habit.id,
              "data-testid": "habitcard",
              style: {
                background: T.panel,
                border: `1px solid ${T.rule}`,
                padding: "16px 20px",
              },
            },
            [
              h(
                "div",
                {
                  style: {
                    fontFamily: T.mono,
                    fontSize: "10px",
                    letterSpacing: "1.2px",
                    textTransform: "uppercase",
                    color: T.muted,
                  },
                },
                `${fmtHabitId(p.habit.id)} · since ${fmtMD(p.habit.startDate)}`,
              ),
              h(
                "div",
                {
                  style: {
                    fontSize: "17px",
                    fontWeight: "600",
                    letterSpacing: "-0.2px",
                    marginTop: "3px",
                    color: T.ink,
                  },
                },
                p.habit.name,
              ),
              p.habit.description
                ? h(
                    "div",
                    {
                      style: {
                        fontSize: "12.5px",
                        color: T.ink3,
                        marginTop: "4px",
                        lineHeight: "1.5",
                      },
                    },
                    p.habit.description,
                  )
                : null,
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    gap: "24px",
                    marginTop: "14px",
                    paddingTop: "14px",
                    borderTop: `1px solid ${T.ruleSoft}`,
                  },
                },
                [
                  h(Stat, {
                    label: "Current",
                    value: `${p.streaks.current}d`,
                  }),
                  h(Stat, {
                    label: "Longest",
                    value: `${p.streaks.longest}d`,
                  }),
                  h(Stat, {
                    label: "Rate",
                    value: `${Math.round(p.streaks.rate * 100)}%`,
                    sub: `${p.streaks.done}/${p.streaks.total}`,
                  }),
                ],
              ),
              h("div", { style: { marginTop: "14px" } }, [
                h(
                  "div",
                  {
                    style: {
                      fontFamily: T.mono,
                      fontSize: "9.5px",
                      letterSpacing: "1.2px",
                      textTransform: "uppercase",
                      color: T.muted,
                      marginBottom: "6px",
                    },
                  },
                  "26-week rate",
                ),
                h(WeeklySpark, { weekly: p.weekly }),
              ]),
              h("div", { style: { marginTop: "14px" } }, [
                h(
                  "div",
                  {
                    style: {
                      fontFamily: T.mono,
                      fontSize: "9.5px",
                      letterSpacing: "1.2px",
                      textTransform: "uppercase",
                      color: T.muted,
                      marginBottom: "6px",
                    },
                  },
                  "by day of week",
                ),
                h(DowStrip, { dow: p.dow }),
              ]),
            ],
          ),
        ),
      );
  },
});

const SectionRule = defineComponent({
  name: "SectionRule",
  props: {
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
  },
  setup(props) {
    return () =>
      h(
        "div",
        {
          style: {
            marginTop: "14px",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          },
        },
        [
          h("div", null, [
            h(
              "div",
              {
                style: {
                  fontFamily: T.mono,
                  fontSize: "11px",
                  letterSpacing: "1.4px",
                  textTransform: "uppercase",
                  color: T.muted,
                  marginBottom: "4px",
                },
              },
              props.title,
            ),
            props.subtitle
              ? h(
                  "div",
                  {
                    style: { fontSize: "13px", color: T.ink3 },
                  },
                  props.subtitle,
                )
              : null,
          ]),
          h("div", {
            style: {
              flex: "1",
              height: "1px",
              background: T.rule,
              marginLeft: "24px",
              marginBottom: "8px",
            },
          }),
        ],
      );
  },
});

const DayRow = defineComponent({
  name: "DayRow",
  props: {
    day: { type: Object as () => UiDay, required: true },
    habits: { type: Array as () => UiHabit[], required: true },
  },
  setup(props) {
    return () => {
      const dt = parseIso(props.day.date);
      const dow = dt.toLocaleString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      });
      const dayNum = dt.getUTCDate();
      const doneCount = props.day.checkIns.filter((c) => c.done).length;
      const activeCount = props.habits.filter(
        (h) =>
          props.day.date >= h.startDate &&
          (h.endDate === null || props.day.date <= h.endDate),
      ).length;

      const ciByHabit = new Map<number, UiCheckIn>();
      for (const c of props.day.checkIns) ciByHabit.set(c.habitId, c);

      const notes = props.day.checkIns
        .filter((c) => c.note && c.note.trim() !== "")
        .map((c) => {
          const habit = props.habits.find((h) => h.id === c.habitId);
          return h(
            "div",
            {
              key: c.habitId,
              style: {
                marginTop: "8px",
                display: "flex",
                gap: "10px",
                alignItems: "flex-start",
              },
            },
            [
              h(
                "div",
                {
                  style: {
                    fontFamily: T.mono,
                    fontSize: "9.5px",
                    color: T.muted,
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                    paddingTop: "2px",
                    minWidth: "104px",
                  },
                },
                `↳ ${habit?.name ?? fmtHabitId(c.habitId)}`,
              ),
              h(
                "div",
                {
                  style: {
                    fontSize: "12.5px",
                    color: T.ink3,
                    fontStyle: "italic",
                  },
                },
                c.note ?? "",
              ),
            ],
          );
        });

      return h(
        "div",
        {
          "data-testid": "dayrow",
          "data-date": props.day.date,
          style: {
            display: "grid",
            gridTemplateColumns: "76px 110px 1fr auto",
            padding: "14px 24px",
            gap: "20px",
            borderBottom: `1px solid ${T.ruleSoft}`,
            alignItems: "flex-start",
          },
        },
        [
          h("div", null, [
            h(
              "div",
              {
                style: {
                  fontFamily: T.mono,
                  fontSize: "26px",
                  fontWeight: "500",
                  color: T.ink,
                  lineHeight: "1",
                  fontVariantNumeric: "tabular-nums",
                },
              },
              String(dayNum).padStart(2, "0"),
            ),
            h(
              "div",
              {
                style: {
                  fontFamily: T.mono,
                  fontSize: "10px",
                  color: T.muted,
                  marginTop: "4px",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                },
              },
              dow,
            ),
          ]),
          h("div", { style: { paddingTop: "2px" } }, [
            h(
              "div",
              {
                style: {
                  fontFamily: T.mono,
                  fontSize: "10px",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  color: T.muted,
                  marginBottom: "4px",
                },
              },
              "done",
            ),
            h(
              "div",
              {
                style: {
                  fontFamily: T.mono,
                  fontSize: "15px",
                  color: T.ink,
                  fontVariantNumeric: "tabular-nums",
                },
              },
              [
                String(doneCount),
                h(
                  "span",
                  { style: { color: T.muted } },
                  `/${activeCount}`,
                ),
              ],
            ),
          ]),
          h(
            "div",
            { style: { minWidth: "0" } },
            [
              props.day.comment
                ? h(
                    "div",
                    {
                      style: {
                        fontSize: "14px",
                        color: T.ink2,
                        lineHeight: "1.55",
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      },
                    },
                    props.day.comment,
                  )
                : h(
                    "div",
                    {
                      style: {
                        fontFamily: T.mono,
                        fontSize: "11px",
                        color: T.mutedSoft,
                        fontStyle: "italic",
                      },
                    },
                    "(no day comment)",
                  ),
              ...notes,
            ],
          ),
          h(
            "div",
            { style: { display: "flex", gap: "4px" } },
            props.habits.map((hab) => {
              const ci = ciByHabit.get(hab.id);
              const inRange =
                props.day.date >= hab.startDate &&
                (hab.endDate === null || props.day.date <= hab.endDate);
              const title = `${hab.name}${
                ci && ci.done ? " · done" : inRange ? " · missed" : " · pre-start"
              }`;
              return h("div", {
                key: hab.id,
                title,
                style: {
                  width: "18px",
                  height: "18px",
                  background: !inRange
                    ? "transparent"
                    : ci && ci.done
                      ? T.a3
                      : T.a0,
                  border: !inRange ? `1px dashed ${T.ruleSoft}` : "none",
                  boxSizing: "border-box",
                },
              });
            }),
          ),
        ],
      );
    };
  },
});

interface JournalGroup {
  key: string;
  label: string;
  days: UiDay[];
  done: number;
  total: number;
}

const Journal = defineComponent({
  name: "Journal",
  props: {
    groups: { type: Array as () => JournalGroup[], required: true },
    habits: { type: Array as () => UiHabit[], required: true },
  },
  setup(props) {
    return () => {
      if (props.groups.length === 0) {
        return h(
          "div",
          {
            style: {
              background: T.panel,
              border: `1px solid ${T.rule}`,
              padding: "24px",
              fontFamily: T.mono,
              fontSize: "11px",
              color: T.muted,
              textTransform: "uppercase",
              letterSpacing: "1.2px",
            },
          },
          "No activity in this range.",
        );
      }
      return h(
        "div",
        {
          style: { background: T.panel, border: `1px solid ${T.rule}` },
        },
        props.groups.map((g, gi) =>
          h(
            "div",
            {
              key: g.key,
              style: {
                borderBottom:
                  gi < props.groups.length - 1
                    ? `1px solid ${T.rule}`
                    : "none",
              },
            },
            [
              h(
                "div",
                {
                  style: {
                    background: T.panelAlt,
                    padding: "10px 24px",
                    borderBottom: `1px solid ${T.ruleSoft}`,
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                  },
                },
                [
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: T.mono,
                        fontSize: "11px",
                        letterSpacing: "1.4px",
                        textTransform: "uppercase",
                        color: T.ink2,
                      },
                    },
                    g.label,
                  ),
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: T.mono,
                        fontSize: "10.5px",
                        color: T.muted,
                      },
                    },
                    `${g.days.length} entries · ${g.done}/${g.total} check-ins · ${
                      g.total ? Math.round((g.done / g.total) * 100) : 0
                    }%`,
                  ),
                ],
              ),
              ...g.days.map((d) =>
                h(DayRow, { key: d.date, day: d, habits: props.habits }),
              ),
            ],
          ),
        ),
      );
    };
  },
});

// ---- app root ---------------------------------------------------------

const App = defineComponent({
  name: "App",
  props: {
    data: { type: Object as () => UiData, required: true },
  },
  setup(props) {
    return () => {
      const data = props.data;
      // The view's effective "today" — the later edge of the data we were
      // actually served. For the default view this is real today; for
      // `?to=<past date>` requests we use `data.to` so stats don't count
      // the un-served gap as "missed". We also clamp against real today
      // in case `data.to` is ahead of it.
      const realToday = todayIso();
      const viewEnd = data.to < realToday ? data.to : realToday;
      const viewStart = data.from;

      const habits = [...data.habits].sort((a, b) => a.id - b.id);

      const dayMap = new Map<string, UiDay>();
      for (const d of data.days) dayMap.set(d.date, d);

      const byHabitDate = buildByHabitDate(data.days);

      const commentSet = new Set<string>();
      for (const d of data.days) {
        if (d.comment && d.comment.trim() !== "") commentSet.add(d.date);
      }

      const { gridStart } = computeGridRange(viewEnd);
      const heatCells = computeHeatCells(
        habits,
        byHabitDate,
        commentSet,
        gridStart,
        viewStart,
        viewEnd,
      );

      let totalsDone = 0;
      let totalsTotal = 0;
      const panels: HabitPanel[] = habits.map((habit) => {
        const s = computeStreaks(habit, byHabitDate, viewStart, viewEnd);
        totalsDone += s.done;
        totalsTotal += s.total;
        return {
          habit,
          streaks: s,
          weekly: computeWeeklyRates(habit, byHabitDate, viewStart, viewEnd, 26),
          dow: computeDowProfile(habit, byHabitDate, viewStart, viewEnd),
        };
      });

      const activeDays = data.days.filter(
        (d) => d.checkIns.length > 0 || (d.comment && d.comment.trim() !== ""),
      ).length;

      // Journal: month-grouped, most recent first.
      const byMonth = new Map<string, UiDay[]>();
      for (const d of data.days) {
        const key = d.date.slice(0, 7);
        const arr = byMonth.get(key) ?? [];
        arr.push(d);
        byMonth.set(key, arr);
      }
      const groupKeys = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
      const groups: JournalGroup[] = groupKeys.map((key) => {
        const days = (byMonth.get(key) ?? []).sort((a, b) =>
          b.date.localeCompare(a.date),
        );
        let done = 0;
        let total = 0;
        for (const d of days) {
          for (const c of d.checkIns) {
            total++;
            if (c.done) done++;
          }
        }
        const label = parseIso(`${key}-01`).toLocaleString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
        return { key, label, days, done, total };
      });

      return h(
        "div",
        {
          style: {
            width: "100%",
            minHeight: "100vh",
            background: T.bg,
            fontFamily: T.sans,
            color: T.ink,
            padding: "28px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          },
        },
        [
          h(Header, {
            habits,
            totals: { done: totalsDone, total: totalsTotal },
            commentDays: commentSet.size,
            activeDays,
            from: data.from,
            to: data.to,
            today: viewEnd,
          }),
          h(CombinedHeat, { cols: heatCells, gridStart }),
          habits.length > 0 ? h(HabitStrip, { panels }) : null,
          h(SectionRule, {
            title: "day by day",
            subtitle:
              "Only days with a comment or ≥1 check-in — that's what listDays returns.",
          }),
          h(Journal, { groups, habits }),
        ],
      );
    };
  },
});

const dataEl = document.getElementById("ui-data");
const raw = dataEl?.textContent ?? "{}";
const data = JSON.parse(raw) as UiData;

createApp(App, { data }).mount("#app");
