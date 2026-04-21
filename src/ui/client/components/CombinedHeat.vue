<script setup lang="ts">
import { HABIT_COLORS, T } from "../lib/tokens.js";
import { monthLabels } from "../lib/date.js";
import type { HeatCell } from "../lib/types.js";

const props = defineProps<{
  cols: HeatCell[][];
  gridStart: string;
}>();

const CELL = 14;
const GAP = 3;
const DOW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;

const labels = monthLabels(props.gridStart);

let totalDone = 0;
let totalSlots = 0;
for (const col of props.cols) {
  for (const c of col) {
    if (c.noData) continue;
    if (c.activeHabits === 0) continue;
    totalDone += c.doneCount;
    totalSlots += c.activeHabits;
  }
}
const pct = totalSlots ? Math.round((totalDone / totalSlots) * 100) : 0;
const footer = `${totalDone.toLocaleString()} check-ins of ${totalSlots.toLocaleString()} possible · ${pct}%`;

function cellFill(c: HeatCell): string {
  if (c.noData || c.activeHabits === 0) return "transparent";
  if (c.doneCount === 0) return T.a0;
  return HABIT_COLORS[Math.min(c.doneCount - 1, HABIT_COLORS.length - 1)]!;
}

function cellBorder(c: HeatCell): string {
  return c.noData || c.activeHabits === 0 ? `1px dashed ${T.ruleSoft}` : "none";
}

function cellTooltip(c: HeatCell): string {
  const parts = c.noData
    ? [c.date]
    : [`${c.date} · ${c.doneCount}/${c.activeHabits} done`];
  if (c.hasComment) parts.push("has comment");
  return parts.join(" · ");
}
</script>

<template>
  <div :style="{ background: T.panel, border: `1px solid ${T.rule}` }">
    <!-- header -->
    <div
      :style="{
        padding: '16px 22px 12px',
        borderBottom: `1px solid ${T.ruleSoft}`,
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }"
    >
      <div>
        <div
          :style="{
            fontFamily: T.mono,
            fontSize: '10.5px',
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            color: T.muted,
            marginBottom: '2px',
          }"
        >
          all check-ins · 53 weeks × 7 days
        </div>
        <div
          :style="{
            fontSize: '17px',
            fontWeight: '600',
            letterSpacing: '-0.3px',
            color: T.ink,
          }"
        >
          Combined completion across all habits
        </div>
      </div>
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontFamily: T.mono,
          fontSize: '10.5px',
          color: T.ink3,
        }"
      >
        <span>none</span>
        <div :style="{ display: 'flex', gap: '2px' }">
          <div
            :style="{
              width: `${CELL}px`,
              height: `${CELL}px`,
              background: T.a0,
            }"
          />
          <div
            v-for="c in HABIT_COLORS"
            :key="c"
            :style="{
              width: `${CELL}px`,
              height: `${CELL}px`,
              background: c,
            }"
          />
        </div>
        <span>all 3</span>
      </div>
    </div>

    <!-- grid -->
    <div :style="{ padding: '18px 22px 20px' }">
      <div
        :style="{
          position: 'relative',
          height: `${CELL}px`,
          marginLeft: '30px',
        }"
      >
        <div
          v-for="l in labels"
          :key="l.col"
          :style="{
            position: 'absolute',
            left: `${l.col * (CELL + GAP)}px`,
            fontFamily: T.mono,
            fontSize: '10.5px',
            letterSpacing: '0.5px',
            color: T.ink3,
            textTransform: 'uppercase',
          }"
        >
          {{ l.label }}
        </div>
      </div>
      <div :style="{ display: 'flex', gap: '8px' }">
        <div
          :style="{
            display: 'flex',
            flexDirection: 'column',
            gap: `${GAP}px`,
            width: '24px',
          }"
        >
          <div
            v-for="(lbl, i) in DOW_LABELS"
            :key="i"
            :style="{
              height: `${CELL}px`,
              fontFamily: T.mono,
              fontSize: '10px',
              color: T.muted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }"
          >
            {{ lbl }}
          </div>
        </div>
        <div :style="{ display: 'flex', gap: `${GAP}px` }">
          <div
            v-for="(col, ci) in cols"
            :key="ci"
            :style="{
              display: 'flex',
              flexDirection: 'column',
              gap: `${GAP}px`,
            }"
          >
            <div
              v-for="c in col"
              :key="c.date"
              data-testid="heatcell"
              :data-date="c.date"
              :title="cellTooltip(c)"
              :style="{
                width: `${CELL}px`,
                height: `${CELL}px`,
                position: 'relative',
                background: cellFill(c),
                border: cellBorder(c),
                boxSizing: 'border-box',
              }"
            >
              <div
                v-if="c.hasComment"
                :style="{
                  position: 'absolute',
                  bottom: '1.5px',
                  right: '1.5px',
                  width: '3px',
                  height: '3px',
                  background: c.doneCount >= 2 ? '#fff' : T.missStrong,
                  borderRadius: '2px',
                }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- footer -->
      <div
        :style="{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '14px',
          fontFamily: T.mono,
          fontSize: '10.5px',
          color: T.muted,
        }"
      >
        <span>
          shade = habits completed that day · dot = day has a free-text comment
        </span>
        <span :style="{ color: T.ink3 }">{{ footer }}</span>
      </div>
    </div>
  </div>
</template>
