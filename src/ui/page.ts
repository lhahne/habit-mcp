import type { Day, Habit } from "../db/schema.js";
import { clientBundle } from "./client-bundle.gen.js";
import { fontsCss } from "./fonts.gen.js";

export interface UiPageOptions {
  habits: Habit[];
  days: Day[];
  from: string;
  to: string;
}

// Escapes characters that could terminate a <script> block early when
// embedding JSON or JS inside inline <script> tags.
const escapeForScript = (s: string): string =>
  s.replace(/</g, "\\u003c");

const escapeJsForScript = (s: string): string =>
  s.replace(/<\/(script)/gi, "<\\/$1");

export function renderUiPage(opts: UiPageOptions): string {
  const payload = escapeForScript(
    JSON.stringify({
      habits: opts.habits.map((h) => ({
        id: h.id,
        name: h.name,
        description: h.description,
        startDate: h.startDate,
        endDate: h.endDate,
      })),
      days: opts.days.map((d) => ({
        date: d.date,
        comment: d.comment,
        checkIns: d.checkIns.map((c) => ({
          habitId: c.habitId,
          done: c.done,
          note: c.note,
        })),
      })),
      from: opts.from,
      to: opts.to,
    }),
  );

  const script = escapeJsForScript(clientBundle);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>habit tracker</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>${fontsCss}*{box-sizing:border-box}html,body,#app{margin:0;min-height:100vh}body{background:#f6f3ed;color:#1c1a17;font-family:Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}</style>
</head>
<body>
  <div id="app"></div>
  <script type="application/json" id="ui-data">${payload}</script>
  <script>${script}</script>
</body>
</html>`;
}
