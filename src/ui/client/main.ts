// Client-side Vue app for /ui. Bundled by scripts/build-ui.mjs into
// src/ui/client-bundle.gen.ts and inlined into the HTML response.
//
// The DOM this produces intentionally matches the old vanilla-JS
// version (ids, classes, data-* attrs, aria-pressed) so existing unit
// and Playwright tests continue to target the same selectors.

import { computed, createApp, defineComponent, ref } from "vue";

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
          (h) =>
            h.startDate <= iso && (h.endDate === null || h.endDate >= iso),
        )
        .map((h) => {
          const ci = ciByHabit.get(h.id);
          return {
            id: h.id,
            name: h.name,
            done: ci ? ci.done : false,
            note: ci?.note ?? null,
          };
        });
    });

    const range = computed(
      () => `${props.data.from} → ${props.data.to}`,
    );

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

    return {
      selected,
      cells,
      selectedDay,
      visibleHabits,
      range,
      prevHref,
      nextHref,
    };
  },
  template: `
    <header>
      <h1>habit-mcp</h1>
      <span class="range" id="range-label">{{ range }}</span>
      <div class="legend" aria-hidden="true">
        <span>less</span>
        <span class="cell tier-0"></span>
        <span class="cell tier-1"></span>
        <span class="cell tier-2"></span>
        <span class="cell tier-3"></span>
        <span>more</span>
      </div>
      <nav class="nav">
        <a id="prev" :href="prevHref">&larr; Prev 90</a>
        <a id="next" :href="nextHref">Next 90 &rarr;</a>
      </nav>
    </header>
    <main>
      <div id="grid" aria-label="Check-in heatmap">
        <button
          v-for="c in cells"
          :key="c.iso"
          type="button"
          class="cell"
          :class="['tier-' + c.tier, { 'has-comment': c.hasComment, 'today': c.isToday }]"
          :data-date="c.iso"
          :aria-label="c.iso + ' — ' + c.tier + ' done'"
          :aria-pressed="selected === c.iso ? 'true' : 'false'"
          @click="selected = c.iso"
        ></button>
      </div>
      <section id="panel" :class="{ open: selected !== null }" aria-live="polite">
        <h2 id="panel-date">{{ selected ?? '' }}</h2>
        <pre id="comment">{{ selectedDay && selectedDay.comment ? selectedDay.comment : '' }}</pre>
        <ul class="habits" id="habits">
          <li v-for="h in visibleHabits" :key="h.id">
            <span class="status" :class="h.done ? 'done' : 'undone'">{{ h.done ? '✓' : '·' }}</span>
            <div class="habit-body">
              <div class="name">{{ h.name }}</div>
              <div v-if="h.note" class="note">{{ h.note }}</div>
            </div>
          </li>
        </ul>
      </section>
    </main>
  `,
});

const dataEl = document.getElementById("ui-data");
const raw = dataEl?.textContent ?? "{}";
const data = JSON.parse(raw) as UiData;

createApp(App, { data }).mount("#app");
