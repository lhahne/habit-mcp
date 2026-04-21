import type { Day, Habit } from "../db/schema.js";
import { clientBundle } from "./client-bundle.gen.js";

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
  <title>habit-mcp &middot; check-ins</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0b0c10;color:#e6e8eb;margin:0;min-height:100vh}
    header{padding:1.25rem 1.5rem;border-bottom:1px solid #1e2228;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
    h1{margin:0;font-size:1.1rem;font-weight:600}
    .range{color:#9aa0a6;font-size:.9rem}
    .nav{display:flex;gap:.5rem;margin-left:auto}
    .nav a{padding:.4rem .75rem;border-radius:6px;background:#14171c;color:#e6e8eb;text-decoration:none;font-size:.85rem;border:1px solid #2b2f36}
    .nav a:hover{background:#1a1e25}
    main{display:flex;gap:1.5rem;padding:1.5rem;align-items:flex-start}
    #grid{display:grid;grid-template-columns:repeat(15,1.6rem);gap:.3rem;flex-shrink:0}
    .cell{width:1.6rem;height:1.6rem;border-radius:4px;border:0;padding:0;cursor:pointer;background:#14171c;transition:transform .08s}
    .cell:hover{transform:scale(1.15);outline:1px solid #3b82f6}
    .cell.tier-1{background:#0e3b2a}
    .cell.tier-2{background:#146b4a}
    .cell.tier-3{background:#22c55e}
    .cell.has-comment{outline:1px solid #3b82f6aa}
    .cell.today{box-shadow:inset 0 0 0 2px #f59e0b}
    .cell[aria-pressed="true"]{outline:2px solid #fff}
    .legend{display:flex;gap:.5rem;align-items:center;font-size:.8rem;color:#9aa0a6;margin-left:1rem}
    .legend .cell{width:1rem;height:1rem;cursor:default}
    .legend .cell:hover{transform:none;outline:0}
    #panel{flex:1;min-width:0;background:#14171c;border-radius:12px;padding:1.25rem 1.5rem;max-height:calc(100vh - 6rem);overflow:auto;display:none}
    #panel.open{display:block}
    #panel h2{margin:0 0 .75rem;font-size:1rem}
    #panel .empty{color:#9aa0a6;font-size:.9rem}
    .habits{list-style:none;padding:0;margin:1rem 0 0;display:flex;flex-direction:column;gap:.5rem}
    .habits li{display:flex;gap:.5rem;align-items:flex-start;padding:.5rem .75rem;background:#0b0c10;border-radius:8px}
    .habits .habit-body{flex:1;min-width:0}
    .habits .name{font-weight:500}
    .habits .note{color:#9aa0a6;font-size:.85rem;margin-top:.2rem;white-space:pre-wrap;overflow-wrap:anywhere}
    .habits .status{font-family:ui-monospace,monospace;font-size:1rem}
    .habits .status.done{color:#22c55e}
    .habits .status.undone{color:#6b7280}
    #comment{white-space:pre-wrap;overflow-wrap:anywhere;font-family:system-ui,sans-serif;margin:0;color:#e6e8eb;font-size:.95rem;line-height:1.5;background:#0b0c10;padding:1rem;border-radius:8px;max-height:40vh;overflow:auto}
    #comment:empty::before{content:"(no comment)";color:#6b7280;font-style:italic}
    @media (max-width:900px){main{flex-direction:column}#panel{width:100%;max-height:none}}
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="application/json" id="ui-data">${payload}</script>
  <script>${script}</script>
</body>
</html>`;
}
