<script setup lang="ts">
import { T } from "../lib/tokens.js";
import { fmtHabitId, parseIso } from "../lib/date.js";
import type { UiCheckIn, UiDay, UiHabit } from "../lib/types.js";

const props = defineProps<{
  day: UiDay;
  habits: UiHabit[];
}>();

const dt = parseIso(props.day.date);
const dow = dt.toLocaleString("en-US", {
  weekday: "short",
  timeZone: "UTC",
});
const dayNum = String(dt.getUTCDate()).padStart(2, "0");
const doneCount = props.day.checkIns.filter((c) => c.done).length;
const activeCount = props.habits.filter(
  (h) =>
    props.day.date >= h.startDate &&
    (h.endDate === null || props.day.date <= h.endDate),
).length;

const ciByHabit = new Map<number, UiCheckIn>();
for (const c of props.day.checkIns) ciByHabit.set(c.habitId, c);

interface NoteRow {
  habitId: number;
  label: string;
  note: string;
}

const noteRows: NoteRow[] = props.day.checkIns
  .filter((c) => c.note && c.note.trim() !== "")
  .map((c) => {
    const habit = props.habits.find((h) => h.id === c.habitId);
    return {
      habitId: c.habitId,
      label: `↳ ${habit?.name ?? fmtHabitId(c.habitId)}`,
      note: c.note ?? "",
    };
  });

interface HabitCell {
  habitId: number;
  inRange: boolean;
  done: boolean;
  title: string;
}

const habitCells: HabitCell[] = props.habits.map((hab) => {
  const ci = ciByHabit.get(hab.id);
  const inRange =
    props.day.date >= hab.startDate &&
    (hab.endDate === null || props.day.date <= hab.endDate);
  const done = !!ci && ci.done;
  const suffix = done ? " · done" : inRange ? " · missed" : " · pre-start";
  return {
    habitId: hab.id,
    inRange,
    done,
    title: `${hab.name}${suffix}`,
  };
});

function habitCellBg(c: HabitCell): string {
  if (!c.inRange) return "transparent";
  return c.done ? T.a3 : T.a0;
}

function habitCellBorder(c: HabitCell): string {
  return c.inRange ? "none" : `1px dashed ${T.ruleSoft}`;
}
</script>

<template>
  <div
    data-testid="dayrow"
    :data-date="day.date"
    :style="{
      display: 'grid',
      gridTemplateColumns: '76px 110px 1fr auto',
      padding: '14px 24px',
      gap: '20px',
      borderBottom: `1px solid ${T.ruleSoft}`,
      alignItems: 'flex-start',
    }"
  >
    <!-- date -->
    <div>
      <div
        :style="{
          fontFamily: T.mono,
          fontSize: '26px',
          fontWeight: '500',
          color: T.ink,
          lineHeight: '1',
          fontVariantNumeric: 'tabular-nums',
        }"
      >
        {{ dayNum }}
      </div>
      <div
        :style="{
          fontFamily: T.mono,
          fontSize: '10px',
          color: T.muted,
          marginTop: '4px',
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }"
      >
        {{ dow }}
      </div>
    </div>

    <!-- done / active -->
    <div :style="{ paddingTop: '2px' }">
      <div
        :style="{
          fontFamily: T.mono,
          fontSize: '10px',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          color: T.muted,
          marginBottom: '4px',
        }"
      >
        done
      </div>
      <div
        :style="{
          fontFamily: T.mono,
          fontSize: '15px',
          color: T.ink,
          fontVariantNumeric: 'tabular-nums',
        }"
      >
        {{ doneCount }}<span :style="{ color: T.muted }">/{{ activeCount }}</span>
      </div>
    </div>

    <!-- comment + notes -->
    <div :style="{ minWidth: '0' }">
      <div
        v-if="day.comment"
        :style="{
          fontSize: '14px',
          color: T.ink2,
          lineHeight: '1.55',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }"
      >
        {{ day.comment }}
      </div>
      <div
        v-else
        :style="{
          fontFamily: T.mono,
          fontSize: '11px',
          color: T.mutedSoft,
          fontStyle: 'italic',
        }"
      >
        (no day comment)
      </div>
      <div
        v-for="n in noteRows"
        :key="n.habitId"
        :style="{
          marginTop: '8px',
          display: 'flex',
          gap: '10px',
          alignItems: 'flex-start',
        }"
      >
        <div
          :style="{
            fontFamily: T.mono,
            fontSize: '9.5px',
            color: T.muted,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            paddingTop: '2px',
            minWidth: '104px',
          }"
        >
          {{ n.label }}
        </div>
        <div
          :style="{
            fontSize: '12.5px',
            color: T.ink3,
            fontStyle: 'italic',
          }"
        >
          {{ n.note }}
        </div>
      </div>
    </div>

    <!-- per-habit cells -->
    <div :style="{ display: 'flex', gap: '4px' }">
      <div
        v-for="c in habitCells"
        :key="c.habitId"
        :title="c.title"
        :style="{
          width: '18px',
          height: '18px',
          background: habitCellBg(c),
          border: habitCellBorder(c),
          boxSizing: 'border-box',
        }"
      />
    </div>
  </div>
</template>
