// Client-side Vue app for /ui. Bundled by scripts/build-ui.mjs into
// src/ui/client-bundle.gen.ts and inlined into the HTML response.
//
// Written with render functions (h()) rather than template strings so
// the runtime-only Vue build suffices — the response CSP forbids
// 'unsafe-eval', which would be required by Vue's runtime template
// compiler.
//
// The DOM this produces intentionally matches the old vanilla-JS
// version (ids, classes, data-* attrs, aria-pressed) so existing unit
// and Playwright tests continue to target the same selectors.

import {
  Fragment,
  computed,
  createApp,
  defineComponent,
  h,
  ref,
  type VNode,
} from "vue";

interface UiHabit {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
}

interface UiCheckIn {
  habitId: string;
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

function addDays(d: Date, n: number): Date {
  const c = new Date(d.getTime());
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

function todayIso(): string {
  return toIso(new Date());
}

function tierFor(day: UiDay | undefined): number {
  if (!day) return 0;
  let done = 0;
  for (const c of day.checkIns) if (c.done) done++;
  if (done === 0) return 0;
  if (done === 1) return 1;
  if (done <= 3) return 2;
  return 3;
}

const App = defineComponent({
  props: {
    data: { type: Object as () => UiData, required: true },
  },
  setup(props) {
    const selected = ref<string | null>(null);
    const today = todayIso();

    const dayMap = computed(() => {
      const m = new Map<string, UiDay>();
      for (const d of props.data.days) m.set(d.date, d);
      return m;
    });

    const cells = computed(() => {
      const from = parseIso(props.data.from);
      const to = parseIso(props.data.to);
      const out: Array<{
        iso: string;
        tier: number;
        hasComment: boolean;
        isToday: boolean;
      }> = [];
      for (
        let d = new Date(from.getTime());
        d.getTime() <= to.getTime();
        d = addDays(d, 1)
      ) {
        const iso = toIso(d);
        const day = dayMap.value.get(iso);
        out.push({
          iso,
          tier: tierFor(day),
          hasComment: !!(day && day.comment),
          isToday: iso === today,
        });
      }
      return out;
    });

    const selectedDay = computed<UiDay | null>(() => {
      const iso = selected.value;
      if (!iso) return null;
      return (
        dayMap.value.get(iso) ?? {
          date: iso,
          comment: "",
          checkIns: [],
        }
      );
    });

    const visibleHabits = computed(() => {
      const iso = selected.value;
      const day = selectedDay.value;
      if (!iso || !day) return [];
      const ciByHabit = new Map<string, UiCheckIn>();
      for (const c of day.checkIns) ciByHabit.set(c.habitId, c);
      return props.data.habits
        .filter(
          (hab) =>
            hab.startDate <= iso &&
            (hab.endDate === null || hab.endDate >= iso),
        )
        .map((hab) => {
          const ci = ciByHabit.get(hab.id);
          return {
            id: hab.id,
            name: hab.name,
            done: ci ? ci.done : false,
            note: ci?.note ?? null,
          };
        });
    });

    const range = computed(() => `${props.data.from} → ${props.data.to}`);

    const prevHref = computed(() => {
      const from = addDays(parseIso(props.data.from), -90);
      const to = addDays(parseIso(props.data.to), -90);
      return `?from=${toIso(from)}&to=${toIso(to)}`;
    });

    const nextHref = computed(() => {
      const from = addDays(parseIso(props.data.from), 90);
      const to = addDays(parseIso(props.data.to), 90);
      return `?from=${toIso(from)}&to=${toIso(to)}`;
    });

    return () => {
      const header = h("header", null, [
        h("h1", null, "habit-mcp"),
        h("span", { class: "range", id: "range-label" }, range.value),
        h("div", { class: "legend", "aria-hidden": "true" }, [
          h("span", null, "less"),
          h("span", { class: "cell tier-0" }),
          h("span", { class: "cell tier-1" }),
          h("span", { class: "cell tier-2" }),
          h("span", { class: "cell tier-3" }),
          h("span", null, "more"),
        ]),
        h("nav", { class: "nav" }, [
          h("a", { id: "prev", href: prevHref.value }, "← Prev 90"),
          h("a", { id: "next", href: nextHref.value }, "Next 90 →"),
        ]),
      ]);

      const gridChildren = cells.value.map((c) =>
        h("button", {
          key: c.iso,
          type: "button",
          class: [
            "cell",
            `tier-${c.tier}`,
            { "has-comment": c.hasComment, today: c.isToday },
          ],
          "data-date": c.iso,
          "aria-label": `${c.iso} — ${c.tier} done`,
          "aria-pressed": selected.value === c.iso ? "true" : "false",
          onClick: () => {
            selected.value = c.iso;
          },
        }),
      );

      const habitItems: VNode[] = visibleHabits.value.map((hab) => {
        const body: VNode[] = [h("div", { class: "name" }, hab.name)];
        if (hab.note) {
          body.push(h("div", { class: "note" }, hab.note));
        }
        return h("li", { key: hab.id }, [
          h(
            "span",
            { class: ["status", hab.done ? "done" : "undone"] },
            hab.done ? "✓" : "·",
          ),
          h("div", { class: "habit-body" }, body),
        ]);
      });

      const panel = h(
        "section",
        {
          id: "panel",
          class: { open: selected.value !== null },
          "aria-live": "polite",
        },
        [
          h("h2", { id: "panel-date" }, selected.value ?? ""),
          h("pre", { id: "comment" }, selectedDay.value?.comment ?? ""),
          h("ul", { class: "habits", id: "habits" }, habitItems),
        ],
      );

      const grid = h(
        "div",
        { id: "grid", "aria-label": "Check-in heatmap" },
        gridChildren,
      );

      return h(Fragment, null, [header, h("main", null, [grid, panel])]);
    };
  },
});

const dataEl = document.getElementById("ui-data");
const raw = dataEl?.textContent ?? "{}";
const data = JSON.parse(raw) as UiData;

createApp(App, { data }).mount("#app");
