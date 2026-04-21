<script setup lang="ts">
import { T } from "../lib/tokens.js";
import type { WeekRate } from "../lib/types.js";

const props = defineProps<{
  weekly: WeekRate[];
}>();

const H = 34;
const GAP = 2;

const lastIdx = props.weekly.length - 1;
</script>

<template>
  <div
    :style="{
      display: 'flex',
      gap: `${GAP}px`,
      alignItems: 'flex-end',
    }"
  >
    <div
      v-for="(w, i) in weekly"
      :key="i"
      :title="`${w.weekStart} · ${w.done}/${w.total}`"
      :style="{
        flex: '1',
        height: `${H}px`,
        display: 'flex',
        alignItems: 'flex-end',
        background: T.a0,
      }"
    >
      <div
        :style="{
          width: '100%',
          height: `${(w.rate ?? 0) * 100}%`,
          background: i === lastIdx ? T.a4 : T.a3,
        }"
      />
    </div>
  </div>
</template>
