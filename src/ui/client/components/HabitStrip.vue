<script setup lang="ts">
import { T } from "../lib/tokens.js";
import { fmtHabitId, fmtMD } from "../lib/date.js";
import type { HabitPanel } from "../lib/types.js";
import Stat from "./Stat.vue";
import WeeklySpark from "./WeeklySpark.vue";
import DowStrip from "./DowStrip.vue";

const props = defineProps<{
  panels: HabitPanel[];
}>();

const gridTemplateColumns = `repeat(${Math.max(1, props.panels.length)}, 1fr)`;
</script>

<template>
  <div
    :style="{
      display: 'grid',
      gridTemplateColumns,
      gap: '20px',
    }"
  >
    <div
      v-for="p in panels"
      :key="p.habit.id"
      data-testid="habitcard"
      :style="{
        background: T.panel,
        border: `1px solid ${T.rule}`,
        padding: '16px 20px',
      }"
    >
      <div
        :style="{
          fontFamily: T.mono,
          fontSize: '10px',
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          color: T.muted,
        }"
      >
        {{ fmtHabitId(p.habit.id) }} · since {{ fmtMD(p.habit.startDate) }}
      </div>
      <div
        :style="{
          fontSize: '17px',
          fontWeight: '600',
          letterSpacing: '-0.2px',
          marginTop: '3px',
          color: T.ink,
        }"
      >
        {{ p.habit.name }}
      </div>
      <div
        v-if="p.habit.description"
        :style="{
          fontSize: '12.5px',
          color: T.ink3,
          marginTop: '4px',
          lineHeight: '1.5',
        }"
      >
        {{ p.habit.description }}
      </div>
      <div
        :style="{
          display: 'flex',
          gap: '24px',
          marginTop: '14px',
          paddingTop: '14px',
          borderTop: `1px solid ${T.ruleSoft}`,
        }"
      >
        <Stat label="Current" :value="`${p.streaks.current}d`" />
        <Stat label="Longest" :value="`${p.streaks.longest}d`" />
        <Stat
          label="Rate"
          :value="`${Math.round(p.streaks.rate * 100)}%`"
          :sub="`${p.streaks.done}/${p.streaks.total}`"
        />
      </div>
      <div :style="{ marginTop: '14px' }">
        <div
          :style="{
            fontFamily: T.mono,
            fontSize: '9.5px',
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            color: T.muted,
            marginBottom: '6px',
          }"
        >
          26-week rate
        </div>
        <WeeklySpark :weekly="p.weekly" />
      </div>
      <div :style="{ marginTop: '14px' }">
        <div
          :style="{
            fontFamily: T.mono,
            fontSize: '9.5px',
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            color: T.muted,
            marginBottom: '6px',
          }"
        >
          by day of week
        </div>
        <DowStrip :dow="p.dow" />
      </div>
    </div>
  </div>
</template>
