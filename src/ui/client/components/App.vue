<script setup lang="ts">
import { T } from "../lib/tokens.js";
import { computeGridRange, parseIso, todayIso } from "../lib/date.js";
import { buildByHabitDate, computeStreaks } from "../lib/habits.js";
import {
  computeDowProfile,
  computeHeatCells,
  computeWeeklyRates,
} from "../lib/stats.js";
import type {
  HabitPanel,
  JournalGroup,
  UiData,
  UiDay,
} from "../lib/types.js";
import Header from "./Header.vue";
import CombinedHeat from "./CombinedHeat.vue";
import HabitStrip from "./HabitStrip.vue";
import SectionRule from "./SectionRule.vue";
import Journal from "./Journal.vue";

const props = defineProps<{
  data: UiData;
}>();

const data = props.data;

// The view's effective "today" — the later edge of the data we were actually
// served. For `?to=<past date>` requests we use `data.to` so stats don't count
// the un-served gap as "missed"; we also clamp against real today in case
// `data.to` is ahead of it.
const realToday = todayIso();
const viewEnd = data.to < realToday ? data.to : realToday;
const viewStart = data.from;

const habits = [...data.habits].sort((a, b) => a.id - b.id);

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
const totals = { done: totalsDone, total: totalsTotal };

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
</script>

<template>
  <div
    :style="{
      width: '100%',
      minHeight: '100vh',
      background: T.bg,
      fontFamily: T.sans,
      color: T.ink,
      padding: '28px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
    }"
  >
    <Header
      :habits="habits"
      :totals="totals"
      :comment-days="commentSet.size"
      :active-days="activeDays"
      :from="data.from"
      :to="data.to"
      :today="viewEnd"
    />
    <CombinedHeat :cols="heatCells" :grid-start="gridStart" />
    <HabitStrip v-if="habits.length > 0" :panels="panels" />
    <SectionRule
      title="day by day"
      subtitle="Only days with a comment or ≥1 check-in — that's what listDays returns."
    />
    <Journal :groups="groups" :habits="habits" />
  </div>
</template>
