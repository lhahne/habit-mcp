<script setup lang="ts">
import { T } from "../lib/tokens.js";
import type { DowEntry } from "../lib/types.js";

defineProps<{
  dow: DowEntry[];
}>();

const labels = ["S", "M", "T", "W", "T", "F", "S"] as const;
</script>

<template>
  <div :style="{ display: 'flex', gap: '3px' }">
    <div
      v-for="d in dow"
      :key="d.dow"
      :style="{
        flex: '1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
      }"
    >
      <div
        :style="{
          width: '100%',
          height: '26px',
          background: T.a0,
          position: 'relative',
        }"
      >
        <div
          :style="{
            position: 'absolute',
            inset: 'auto 0 0 0',
            height: `${d.rate * 100}%`,
            background: T.a3,
          }"
        />
      </div>
      <div
        :style="{
          fontFamily: T.mono,
          fontSize: '9.5px',
          color: T.ink3,
        }"
      >
        {{ labels[d.dow] ?? "" }}
      </div>
    </div>
  </div>
</template>
