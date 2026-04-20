import type { Day, Habit } from "../db/schema.js";

export interface UiPageOptions {
  habits: Habit[];
  days: Day[];
  from: string;
  to: string;
}

const escapeJson = (s: string): string => s.replace(/</g, "\\u003c");

export function renderUiPage(opts: UiPageOptions): string {
  const payload = escapeJson(
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
    .habits .name{flex:1;font-weight:500}
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
  <header>
    <h1>habit-mcp</h1>
    <span class="range" id="range-label"></span>
    <div class="legend" aria-hidden="true">
      <span>less</span>
      <span class="cell tier-0"></span>
      <span class="cell tier-1"></span>
      <span class="cell tier-2"></span>
      <span class="cell tier-3"></span>
      <span>more</span>
    </div>
    <nav class="nav">
      <a id="prev" href="#">&larr; Prev 90</a>
      <a id="next" href="#">Next 90 &rarr;</a>
    </nav>
  </header>
  <main>
    <div id="grid" role="grid" aria-label="Check-in heatmap"></div>
    <section id="panel" aria-live="polite">
      <h2 id="panel-date"></h2>
      <pre id="comment"></pre>
      <ul class="habits" id="habits"></ul>
    </section>
  </main>
  <script type="application/json" id="ui-data">${payload}</script>
  <script>
  (function(){
    var raw = document.getElementById('ui-data').textContent || '{}';
    var data = JSON.parse(raw);
    var habits = data.habits || [];
    var days = data.days || [];
    var from = data.from;
    var to = data.to;

    var dayMap = new Map();
    for (var i = 0; i < days.length; i++) dayMap.set(days[i].date, days[i]);

    function parseIso(s){
      var p = s.split('-');
      return new Date(Date.UTC(+p[0], +p[1]-1, +p[2]));
    }
    function toIso(d){
      var y = d.getUTCFullYear();
      var m = String(d.getUTCMonth()+1).padStart(2,'0');
      var day = String(d.getUTCDate()).padStart(2,'0');
      return y+'-'+m+'-'+day;
    }
    function addDays(d, n){
      var c = new Date(d.getTime());
      c.setUTCDate(c.getUTCDate()+n);
      return c;
    }
    function tierFor(day){
      if (!day) return 0;
      var done = 0;
      for (var i = 0; i < day.checkIns.length; i++) if (day.checkIns[i].done) done++;
      if (done === 0) return 0;
      if (done === 1) return 1;
      if (done <= 3) return 2;
      return 3;
    }

    var today = toIso(new Date());
    document.getElementById('range-label').textContent = from + ' \u2192 ' + to;

    var fromD = parseIso(from);
    var toD = parseIso(to);
    var grid = document.getElementById('grid');
    var cells = [];
    for (var d = new Date(fromD.getTime()); d.getTime() <= toD.getTime(); d = addDays(d, 1)) {
      var iso = toIso(d);
      var day = dayMap.get(iso);
      var tier = tierFor(day);
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell tier-' + tier;
      if (day && day.comment) cell.classList.add('has-comment');
      if (iso === today) cell.classList.add('today');
      cell.dataset.date = iso;
      cell.setAttribute('aria-label', iso + ' \u2014 ' + tier + ' done');
      cell.setAttribute('aria-pressed', 'false');
      cells.push(cell);
      grid.appendChild(cell);
    }

    var panel = document.getElementById('panel');
    var panelDate = document.getElementById('panel-date');
    var commentEl = document.getElementById('comment');
    var habitsEl = document.getElementById('habits');

    function selectDate(iso){
      for (var i = 0; i < cells.length; i++) {
        cells[i].setAttribute('aria-pressed', cells[i].dataset.date === iso ? 'true' : 'false');
      }
      var day = dayMap.get(iso) || { date: iso, comment: '', checkIns: [] };
      panelDate.textContent = iso;
      commentEl.textContent = day.comment || '';

      habitsEl.replaceChildren();
      var checkInByHabit = new Map();
      for (var j = 0; j < day.checkIns.length; j++) checkInByHabit.set(day.checkIns[j].habitId, day.checkIns[j]);

      for (var k = 0; k < habits.length; k++) {
        var h = habits[k];
        if (h.startDate > iso) continue;
        if (h.endDate !== null && h.endDate < iso) continue;
        var ci = checkInByHabit.get(h.id);
        var done = ci ? ci.done : false;

        var li = document.createElement('li');
        var name = document.createElement('div');
        name.style.flex = '1';

        var nameSpan = document.createElement('div');
        nameSpan.className = 'name';
        nameSpan.textContent = h.name;
        name.appendChild(nameSpan);

        if (ci && ci.note) {
          var noteEl = document.createElement('div');
          noteEl.className = 'note';
          noteEl.textContent = ci.note;
          name.appendChild(noteEl);
        }

        var status = document.createElement('span');
        status.className = 'status ' + (done ? 'done' : 'undone');
        status.textContent = done ? '\u2713' : '\u00b7';

        li.appendChild(status);
        li.appendChild(name);
        habitsEl.appendChild(li);
      }
      panel.classList.add('open');
    }

    grid.addEventListener('click', function(e){
      var t = e.target;
      if (t && t.classList && t.classList.contains('cell') && t.dataset.date) {
        selectDate(t.dataset.date);
      }
    });

    function shiftRange(days){
      var shiftedFrom = addDays(fromD, days);
      var shiftedTo = addDays(toD, days);
      return '?from=' + toIso(shiftedFrom) + '&to=' + toIso(shiftedTo);
    }
    document.getElementById('prev').setAttribute('href', shiftRange(-90));
    document.getElementById('next').setAttribute('href', shiftRange(90));
  })();
  </script>
</body>
</html>`;
}
