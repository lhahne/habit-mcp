// Design tokens. Mirror of `T` from design_handoff_habit_tracker/ui-kit.jsx.

export const T = {
  bg: "#f6f3ed",
  panel: "#ffffff",
  panelAlt: "#faf7f1",
  rule: "#e8e2d6",
  ruleSoft: "#efebe0",
  ink: "#1c1a17",
  ink2: "#3a362f",
  ink3: "#6b6558",
  muted: "#9a9384",
  mutedSoft: "#bfb8a8",
  a0: "#ebe7dc",
  a1: "#b8d4b1",
  a2: "#7eb87a",
  a3: "#4a9a58",
  a4: "#2a7a3f",
  missStrong: "#8a6a5c",
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  sans: 'Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
} as const;

export const HABIT_COLORS = [T.a1, T.a2, T.a3, T.a4] as const;
