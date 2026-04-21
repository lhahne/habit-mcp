<script setup lang="ts">
import { T } from "../lib/tokens.js";

defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div
    :style="{
      marginTop: '14px',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
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
          marginBottom: '4px',
        }"
      >
        {{ title }}
      </div>
      <div v-if="subtitle" :style="{ fontSize: '13px', color: T.ink3 }">
        {{ subtitle }}
      </div>
    </div>
    <div
      :style="{
        flex: '1',
        height: '1px',
        background: T.rule,
        marginLeft: '24px',
        marginBottom: '8px',
      }"
    />
  </div>
</template>
