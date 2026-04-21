<script setup lang="ts">
import { T } from "../lib/tokens.js";
import type { JournalGroup, UiHabit } from "../lib/types.js";
import DayRow from "./DayRow.vue";

defineProps<{
  groups: JournalGroup[];
  habits: UiHabit[];
}>();

function groupSummary(g: JournalGroup): string {
  const pct = g.total ? Math.round((g.done / g.total) * 100) : 0;
  return `${g.days.length} entries · ${g.done}/${g.total} check-ins · ${pct}%`;
}
</script>

<template>
  <div
    v-if="groups.length === 0"
    :style="{
      background: T.panel,
      border: `1px solid ${T.rule}`,
      padding: '24px',
      fontFamily: T.mono,
      fontSize: '11px',
      color: T.muted,
      textTransform: 'uppercase',
      letterSpacing: '1.2px',
    }"
  >
    No activity in this range.
  </div>
  <div
    v-else
    :style="{ background: T.panel, border: `1px solid ${T.rule}` }"
  >
    <div
      v-for="(g, gi) in groups"
      :key="g.key"
      :style="{
        borderBottom:
          gi < groups.length - 1 ? `1px solid ${T.rule}` : 'none',
      }"
    >
      <div
        :style="{
          background: T.panelAlt,
          padding: '10px 24px',
          borderBottom: `1px solid ${T.ruleSoft}`,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }"
      >
        <div
          :style="{
            fontFamily: T.mono,
            fontSize: '11px',
            letterSpacing: '1.4px',
            textTransform: 'uppercase',
            color: T.ink2,
          }"
        >
          {{ g.label }}
        </div>
        <div
          :style="{
            fontFamily: T.mono,
            fontSize: '10.5px',
            color: T.muted,
          }"
        >
          {{ groupSummary(g) }}
        </div>
      </div>
      <DayRow v-for="d in g.days" :key="d.date" :day="d" :habits="habits" />
    </div>
  </div>
</template>
