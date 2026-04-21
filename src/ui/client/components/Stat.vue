<script setup lang="ts">
import { T } from "../lib/tokens.js";

defineProps<{
  label: string;
  value: string;
  sub?: string;
}>();
</script>

<template>
  <div>
    <div
      :style="{
        fontFamily: T.mono,
        fontSize: '9.5px',
        letterSpacing: '1.2px',
        textTransform: 'uppercase',
        color: T.muted,
        marginBottom: '4px',
      }"
    >
      {{ label }}
    </div>
    <div
      :style="{
        fontFamily: T.mono,
        fontSize: '22px',
        fontWeight: '500',
        color: T.ink,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.5px',
        lineHeight: '1',
      }"
    >
      {{ value }}
    </div>
    <div
      v-if="sub"
      :style="{
        fontFamily: T.mono,
        fontSize: '10.5px',
        color: T.ink3,
        marginTop: '4px',
        fontVariantNumeric: 'tabular-nums',
      }"
    >
      {{ sub }}
    </div>
  </div>
</template>
