<script setup lang="ts">
import { T } from "../lib/tokens.js";
import { fmtMD, fmtMonthYear, parseIso } from "../lib/date.js";
import type { Totals, UiHabit } from "../lib/types.js";
import Stat from "./Stat.vue";

const props = defineProps<{
  habits: UiHabit[];
  totals: Totals;
  commentDays: number;
  activeDays: number;
  from: string;
  to: string;
  today: string;
}>();

// Data is frozen for the mount's lifetime — plain consts, no computed().
const titleRange = `${fmtMonthYear(props.from)} — ${fmtMonthYear(props.to)}`;
const rate = props.totals.total
  ? Math.round((props.totals.done / props.totals.total) * 100)
  : 0;
const weekday = parseIso(props.today).toLocaleString("en-US", {
  weekday: "long",
  timeZone: "UTC",
});
const summary = `${props.habits.length} habits · ${props.totals.done.toLocaleString()} check-ins · ${props.commentDays} comments · ${props.activeDays} active days`;
</script>

<template>
  <div
    :style="{
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: '24px',
    }"
  >
    <div>
      <div
        :style="{
          fontFamily: T.mono,
          fontSize: '11px',
          letterSpacing: '1.4px',
          textTransform: 'uppercase',
          color: T.muted,
          marginBottom: '6px',
        }"
      >
        habit tracker · combined year
      </div>
      <div
        :style="{
          fontSize: '28px',
          fontWeight: '600',
          letterSpacing: '-0.6px',
          color: T.ink,
        }"
      >
        {{ titleRange }}
      </div>
      <div :style="{ fontSize: '13px', color: T.ink3, marginTop: '4px' }">
        {{ summary }}
      </div>
    </div>
    <div :style="{ display: 'flex', gap: '32px' }">
      <Stat
        label="Overall rate"
        :value="`${rate}%`"
        :sub="`${totals.done} / ${totals.total}`"
      />
      <Stat label="Today" :value="fmtMD(today)" :sub="weekday" />
    </div>
  </div>
</template>
