/* Inkling — a calendar you can draw on.
 *
 * Four pages (month, week, day, sketchbook) share one ink layer. Every page
 * keeps its own strokes, keyed by what it shows, so flipping back to a month
 * brings back the marks made on it. Strokes persist in localStorage.
 */
(function () {
  'use strict';

  /* ── Configuration ──────────────────────────────────────────────────
     paperTexture  'dots' | 'lines' | 'plain'
     weekStart     'monday' | 'sunday'
     startHour     first hour on the time grids, 6–9                     */
  var CONFIG = {
    paperTexture: 'dots',
    weekStart: 'monday',
    startHour: 8
  };

  var STORAGE_KEY = 'inkling-ink';
  var HOUR_ROWS = 12;       // hours shown before the grid runs out
  var MAX_CHIPS = 2;        // event chips per month cell before "+N more"
  var FLUID_MAX = 860;      // below this the device frame comes off — matches app.css

  /* Row height and header height live in CSS so the fluid layout can shrink
     them; the time grids read them back to place labels and events. */
  function hourHeight() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-h'));
    return v || 56;
  }
  function headHeight() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-h'));
    return v || 50;
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
    'Friday', 'Saturday'];

  var PALETTE = ['#201e1d', '#c67139', '#7a8a5e', '#82796a'];
  var NIBS = [{ w: 2, d: '5px' }, { w: 4, d: '8px' }, { w: 7, d: '12px' }];

  var EVENTS = window.INKLING_EVENTS || {};

  var now = new Date();
  var state = {
    view: 'month',
    tool: 'pen',
    color: PALETTE[0],
    size: 4,
    y: now.getFullYear(),
    m: now.getMonth(),
    d: now.getDate(),
    notesPage: 1,
    ink: {}
  };

  var el = {};
  ['navTitle', 'btnToday', 'viewport', 'viewMonth', 'viewWeek', 'viewDay',
    'viewNotes', 'monthHead', 'monthGrid', 'weekGutter', 'weekCols',
    'dayGutter', 'dayTrack', 'dayNum', 'dayName', 'notesLabel', 'ink',
    'palette', 'nibs', 'btnUndo', 'btnClear', 'device'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var ctx = el.ink.getContext('2d');
  var live = null;          // stroke in progress, not yet committed
  var rafPending = 0;
  var dpr = 1;

  /* ── Dates ──────────────────────────────────────────────────────── */

  function startsMonday() { return CONFIG.weekStart !== 'sunday'; }

  function hourStart() {
    var v = Number(CONFIG.startHour);
    return isNaN(v) ? 8 : Math.min(9, Math.max(6, v));
  }

  function key(dt) {
    var mm = dt.getMonth() + 1, dd = dt.getDate();
    return dt.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
  }

  function todayKey() { return key(new Date()); }

  function current() { return new Date(state.y, state.m, state.d); }

  function weekStartDate() {
    var dt = current(), wd = dt.getDay();
    dt.setDate(dt.getDate() - (startsMonday() ? (wd + 6) % 7 : wd));
    return dt;
  }

  function dayNames() {
    return startsMonday()
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  }

  function formatTime(h) {
    var H = Math.floor(h), M = Math.round((h - H) * 60);
    return H + ':' + (M < 10 ? '0' : '') + M;
  }

  function eventsOn(dtKey) { return EVENTS[dtKey] || []; }

  function eventColors(c) {
    return c === 'b'
      ? { bg: 'var(--color-accent-2-200)', fg: 'var(--color-accent-2-800)' }
      : { bg: 'var(--color-accent-200)', fg: 'var(--color-accent-800)' };
  }

  /* ── DOM helpers ────────────────────────────────────────────────── */

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(parent) { while (parent.firstChild) parent.removeChild(parent.firstChild); }

  /* ── Rendering ──────────────────────────────────────────────────── */

  function renderTitle() {
    var t;
    if (state.view === 'month') {
      t = MONTHS[state.m] + ' ' + state.y;
    } else if (state.view === 'week') {
      var ws = weekStartDate();
      var we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
      t = ws.getMonth() === we.getMonth()
        ? MONTHS_SHORT[ws.getMonth()] + ' ' + ws.getDate() + ' – ' + we.getDate() + ', ' + we.getFullYear()
        : MONTHS_SHORT[ws.getMonth()] + ' ' + ws.getDate() + ' – ' +
          MONTHS_SHORT[we.getMonth()] + ' ' + we.getDate() + ', ' + we.getFullYear();
    } else if (state.view === 'day') {
      t = WEEKDAYS[current().getDay()] + ', ' + MONTHS[state.m] + ' ' + state.d;
    } else {
      t = 'Sketchbook';
    }
    el.navTitle.textContent = t;
  }

  function renderMonth() {
    clear(el.monthHead);
    dayNames().forEach(function (n) { el.monthHead.appendChild(node('span', null, n)); });

    clear(el.monthGrid);
    var today = todayKey();
    var first = new Date(state.y, state.m, 1);
    var offset = startsMonday() ? (first.getDay() + 6) % 7 : first.getDay();

    for (var i = 0; i < 42; i++) {
      var dt = new Date(state.y, state.m, 1 - offset + i);
      var k = key(dt);
      var inMonth = dt.getMonth() === state.m;
      var isToday = k === today;
      var all = eventsOn(k);

      var cell = node('div', 'cell');
      cell.style.background = inMonth ? 'var(--color-neutral-100)' : 'transparent';

      var num = node('span', 'daynum', dt.getDate());
      num.style.background = isToday ? 'var(--color-accent)' : 'transparent';
      num.style.color = isToday ? '#fff' : inMonth ? 'var(--color-text)' : 'var(--color-neutral-400)';
      cell.appendChild(num);

      all.slice(0, MAX_CHIPS).forEach(function (e) {
        var c = eventColors(e.c);
        var chip = node('span', 'chip', e.n);
        chip.style.background = c.bg;
        chip.style.color = c.fg;
        cell.appendChild(chip);
      });

      if (all.length > MAX_CHIPS) {
        cell.appendChild(node('span', 'cell-more', '+' + (all.length - MAX_CHIPS) + ' more'));
      }

      el.monthGrid.appendChild(cell);
    }
  }

  function renderGutter(target) {
    clear(target);
    var hs = hourStart();
    var hh = hourHeight();
    var top = headHeight();
    for (var i = 0; i < HOUR_ROWS; i++) {
      var s = node('span', null, formatTime(hs + i));
      s.style.top = (top + i * hh) + 'px';
      target.appendChild(s);
    }
  }

  /* Fills a `.track` with one day's all-day pills and timed blocks. */
  function fillTrack(track, list, detailed) {
    clear(track);
    var hs = hourStart();
    var hh = hourHeight();

    list.filter(function (e) { return e.h == null; }).forEach(function (e) {
      var c = eventColors(e.c);
      var pill = node('span', 'allday', e.n);
      pill.style.background = c.bg;
      pill.style.color = c.fg;
      track.appendChild(pill);
    });

    list.filter(function (e) { return e.h != null; }).forEach(function (e) {
      var c = eventColors(e.c);
      var box = node('div', 'event');
      box.style.background = c.bg;
      box.style.color = c.fg;
      box.style.top = ((e.h - hs) * hh + 2) + 'px';
      box.style.height = (e.du * hh - 5) + 'px';

      var time = formatTime(e.h) + ' – ' + formatTime(e.h + e.du);
      if (detailed) {
        box.appendChild(node('span', 'event-name', e.n));
        box.appendChild(node('span', 'event-time', time));
      } else {
        box.appendChild(node('div', 'event-name', e.n));
        box.appendChild(node('div', 'event-time', time));
      }
      track.appendChild(box);
    });
  }

  function renderWeek() {
    renderGutter(el.weekGutter);
    clear(el.weekCols);

    var ws = weekStartDate();
    var names = dayNames();
    var today = todayKey();

    for (var i = 0; i < 7; i++) {
      var dt = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i);
      var k = key(dt);
      var isToday = k === today;

      var col = node('div', 'week-col');
      var head = node('div', 'col-head');
      head.appendChild(node('span', 'col-head-label', names[i]));

      var num = node('span', 'col-daynum', dt.getDate());
      num.style.background = isToday ? 'var(--color-accent)' : 'transparent';
      num.style.color = isToday ? '#fff' : 'var(--color-text)';
      head.appendChild(num);
      col.appendChild(head);

      var track = node('div', 'track');
      fillTrack(track, eventsOn(k), false);
      col.appendChild(track);

      el.weekCols.appendChild(col);
    }
  }

  function renderDay() {
    renderGutter(el.dayGutter);

    var cur = current();
    var k = key(cur);
    var isToday = k === todayKey();

    el.dayNum.textContent = state.d;
    el.dayNum.style.background = isToday ? 'var(--color-accent)' : 'transparent';
    el.dayNum.style.color = isToday ? '#fff' : 'var(--color-text)';
    el.dayName.textContent = WEEKDAYS[cur.getDay()];

    fillTrack(el.dayTrack, eventsOn(k), true);
  }

  function renderNotes() {
    el.notesLabel.textContent = 'Page ' + state.notesPage;
  }

  function applyPaper() {
    var tex = CONFIG.paperTexture;
    var bg = tex === 'dots'
      ? 'radial-gradient(var(--color-neutral-300) 1.3px, transparent 1.3px)'
      : tex === 'lines'
        ? 'repeating-linear-gradient(to bottom, transparent 0 31px, var(--color-neutral-300) 31px 32px)'
        : 'none';
    document.documentElement.style.setProperty('--paper-bg', bg);
    document.documentElement.style.setProperty('--paper-size', tex === 'dots' ? '26px 26px' : 'auto');
  }

  function renderToolbar() {
    clear(el.palette);
    PALETTE.forEach(function (hex) {
      var b = node('button', 'swatch' + (state.color === hex ? ' is-selected' : ''));
      b.type = 'button';
      b.style.background = hex;
      b.setAttribute('aria-label', 'Ink color ' + hex);
      b.setAttribute('aria-pressed', String(state.color === hex));
      b.addEventListener('click', function () {
        state.color = hex;
        // Picking a colour implies you want to draw with it.
        if (state.tool === 'er' || state.tool === 'cursor') state.tool = 'pen';
        render();
      });
      el.palette.appendChild(b);
    });

    clear(el.nibs);
    NIBS.forEach(function (z) {
      var b = node('button', 'nib' + (state.size === z.w ? ' is-selected' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', 'Pen size ' + z.w);
      b.setAttribute('aria-pressed', String(state.size === z.w));
      var dot = node('span');
      dot.style.width = z.d;
      dot.style.height = z.d;
      b.appendChild(dot);
      b.addEventListener('click', function () { state.size = z.w; render(); });
      el.nibs.appendChild(b);
    });

    Array.prototype.forEach.call(
      document.querySelectorAll('.toolbar [data-tool]'),
      function (b) {
        var on = b.dataset.tool === state.tool;
        b.classList.toggle('btn-primary', on);
        b.classList.toggle('btn-ghost', !on);
        b.setAttribute('aria-pressed', String(on));
      }
    );

    el.ink.dataset.tool = state.tool;
  }

  function render() {
    var v = state.view;
    el.viewMonth.hidden = v !== 'month';
    el.viewWeek.hidden = v !== 'week';
    el.viewDay.hidden = v !== 'day';
    el.viewNotes.hidden = v !== 'notes';

    renderTitle();
    if (v === 'month') renderMonth();
    else if (v === 'week') renderWeek();
    else if (v === 'day') renderDay();
    else renderNotes();

    renderToolbar();
    redraw();
  }

  /* ── Ink ────────────────────────────────────────────────────────── */

  /* One ink page per thing on screen: a month, a week, a day, a sheet. */
  function pageKey() {
    if (state.view === 'month') return 'm-' + state.y + '-' + state.m;
    if (state.view === 'week') return 'w-' + key(weekStartDate());
    if (state.view === 'day') return 'd-' + state.y + '-' + state.m + '-' + state.d;
    return 'n-' + state.notesPage;
  }

  function strokes() { return state.ink[pageKey()] || []; }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ink)); } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state.ink = JSON.parse(raw) || {};
    } catch (e) { state.ink = {}; }
  }

  /* Scale between CSS pixels of the shell and real screen pixels. Strokes are
     stored in the shell's own coordinates so they survive a window resize. */
  function shellScale() {
    var r = el.viewport.getBoundingClientRect();
    return el.viewport.offsetWidth ? r.width / el.viewport.offsetWidth : 1;
  }

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    var w = Math.round(el.viewport.offsetWidth * dpr);
    var h = Math.round(el.viewport.offsetHeight * dpr);
    if (el.ink.width !== w || el.ink.height !== h) {
      el.ink.width = w;
      el.ink.height = h;
    }
  }

  function paintStroke(c, s) {
    var p = s.p;
    if (!p || !p.length) return;

    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';

    if (s.t === 'hl') {
      c.globalAlpha = 0.4;
      c.globalCompositeOperation = 'multiply';
      c.strokeStyle = s.c;
      c.lineWidth = s.w * 5;
    } else if (s.t === 'er') {
      c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = '#000';
      c.lineWidth = s.w * 7;
    } else {
      c.strokeStyle = s.c;
      c.lineWidth = s.w;
    }

    if (p.length < 3) {
      c.fillStyle = c.strokeStyle;
      c.beginPath();
      c.arc(p[0][0], p[0][1], c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
    } else {
      // Quadratic through stroke midpoints — smooths the raw pointer samples.
      c.beginPath();
      c.moveTo(p[0][0], p[0][1]);
      for (var i = 1; i < p.length - 1; i++) {
        c.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      }
      c.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      c.stroke();
    }
    c.restore();
  }

  function redraw() {
    sizeCanvas();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.ink.width, el.ink.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    strokes().forEach(function (s) { paintStroke(ctx, s); });
    if (live) paintStroke(ctx, live);
  }

  function point(e) {
    var r = el.ink.getBoundingClientRect();
    var s = shellScale() || 1;
    return [
      Math.round((e.clientX - r.left) / s * 10) / 10,
      Math.round((e.clientY - r.top) / s * 10) / 10
    ];
  }

  function commit(next) {
    state.ink[pageKey()] = next;
    save();
    redraw();
  }

  el.ink.addEventListener('pointerdown', function (e) {
    if (state.tool === 'cursor') return;
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch (x) { /* older engines */ }
    var t = state.tool === 'pen' ? 'p' : state.tool === 'hl' ? 'hl' : 'er';
    live = { t: t, c: state.color, w: state.size, p: [point(e)] };
    redraw();
  });

  el.ink.addEventListener('pointermove', function (e) {
    if (!live) return;
    live.p.push(point(e));
    if (!rafPending) {
      rafPending = requestAnimationFrame(function () { rafPending = 0; redraw(); });
    }
  });

  function endStroke() {
    if (!live) return;
    var s = live;
    live = null;
    commit(strokes().concat([s]));
  }

  el.ink.addEventListener('pointerup', endStroke);
  el.ink.addEventListener('pointercancel', endStroke);

  el.btnUndo.addEventListener('click', function () { commit(strokes().slice(0, -1)); });
  el.btnClear.addEventListener('click', function () { commit([]); });

  /* ── Navigation ─────────────────────────────────────────────────── */

  function navigate(dir) {
    var dt;
    if (state.view === 'month') {
      dt = new Date(state.y, state.m + dir, 1);
      state.y = dt.getFullYear(); state.m = dt.getMonth(); state.d = 1;
    } else if (state.view === 'week') {
      dt = new Date(state.y, state.m, state.d + 7 * dir);
      state.y = dt.getFullYear(); state.m = dt.getMonth(); state.d = dt.getDate();
    } else if (state.view === 'day') {
      dt = new Date(state.y, state.m, state.d + dir);
      state.y = dt.getFullYear(); state.m = dt.getMonth(); state.d = dt.getDate();
    } else {
      state.notesPage = Math.max(1, state.notesPage + dir);
    }
    render();
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (b) {
    b.addEventListener('click', function () { navigate(Number(b.dataset.nav)); });
  });

  el.btnToday.addEventListener('click', function () {
    var t = new Date();
    state.y = t.getFullYear(); state.m = t.getMonth(); state.d = t.getDate();
    render();
  });

  Array.prototype.forEach.call(document.querySelectorAll('input[name="view"]'), function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      state.view = r.value;
      render();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.toolbar [data-tool]'), function (b) {
    b.addEventListener('click', function () { state.tool = b.dataset.tool; renderToolbar(); });
  });

  /* ── Fit the fixed 1194×834 shell into whatever viewport we get ──── */

  function fit() {
    // Fluid layout sizes itself — scaling it too would just make it small.
    if (window.innerWidth <= FLUID_MAX) {
      document.documentElement.style.setProperty('--app-scale', '1');
      return;
    }
    var frame = el.device;
    var w = frame.offsetWidth, h = frame.offsetHeight;
    if (!w || !h) return;
    var pad = 56; // .stage padding, both sides
    var s = Math.min(1, (window.innerWidth - pad) / w, (window.innerHeight - pad) / h);
    document.documentElement.style.setProperty('--app-scale', String(Math.max(s, 0.2)));
  }

  /* A resize can cross the fluid breakpoint, which changes the row height the
     time grids are built from — so re-render, not just repaint. */
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    fit();
    redraw();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });

  /* ── Boot ───────────────────────────────────────────────────────── */

  load();
  applyPaper();
  fit();
  render();
  // Fonts land after first paint and can nudge layout; redraw once settled.
  setTimeout(function () { fit(); redraw(); }, 60);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { fit(); redraw(); });
  }
})();
