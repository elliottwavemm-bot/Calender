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
  // The device frame needs this much room to show at 1:1 — matches the
  // frameless media query in app.css.
  var FRAME_MIN_W = 1280;
  var FRAME_MIN_H = 920;

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

  /* Ink, terracotta, olive, warm grey, red. The red is pitched to the same
     warmth and saturation as the terracotta beside it — far enough round the
     wheel to read as red rather than a second orange, and dark enough on the
     paper to be the colour you reach for to mark something. */
  var PALETTE = ['#201e1d', '#c67139', '#7a8a5e', '#82796a', '#b0392e'];
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
    'palette', 'nibs', 'btnUndo', 'btnClear', 'device', 'zoomable', 'zoomPill',
    'updatePill'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  // `desynchronized` lets the browser skip a compositing step and put ink on
  // the glass sooner. It is the single cheapest latency win available here.
  var ctx = el.ink.getContext('2d', { desynchronized: true });
  var live = null;          // stroke in progress, not yet committed
  var rafPending = 0;
  var dpr = 1;
  var TAU = Math.PI * 2;

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

  /* ── Zoom and pan ───────────────────────────────────────────────────
     The page can be magnified to write small — a note inside one day's
     cell. The views are a CSS transform (vector, so type stays sharp) and
     the ink is redrawn with the same transform baked into the context, so
     it is re-rasterised at the new scale rather than blown up as pixels.

     Strokes are always stored in page coordinates, unzoomed. Zoom is a way
     of looking at the page, never part of what is on it. */

  var MIN_ZOOM = 1, MAX_ZOOM = 6;
  var zoom = 1, panX = 0, panY = 0;

  /* Stage space: CSS pixels of the viewport, after undoing the device
     frame's own scaling. Page space: stage space with zoom and pan undone. */
  function toStage(e) {
    var r = el.viewport.getBoundingClientRect();
    var sc = shellScale() || 1;
    return { x: (e.clientX - r.left) / sc, y: (e.clientY - r.top) / sc };
  }
  function toPage(st) {
    return { x: (st.x - panX) / zoom, y: (st.y - panY) / zoom };
  }

  function clampPan() {
    // Never let the page pull away from the edges of its own window.
    var w = el.viewport.offsetWidth, h = el.viewport.offsetHeight;
    panX = Math.min(0, Math.max(-w * (zoom - 1), panX));
    panY = Math.min(0, Math.max(-h * (zoom - 1), panY));
  }

  function applyTransform() {
    el.zoomable.style.transform =
      'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    var pct = Math.round(zoom * 100);
    el.zoomPill.textContent = pct + '%';
    el.zoomPill.hidden = zoom <= 1.001;
  }

  /* Zoom about a fixed stage point, so the spot under the fingers stays
     under the fingers. */
  function zoomAt(st, next) {
    var pg = toPage(st);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    panX = st.x - pg.x * zoom;
    panY = st.y - pg.y * zoom;
    clampPan();
    applyTransform();
  }

  function resetZoom() {
    zoom = 1; panX = 0; panY = 0;
    applyTransform();
    redraw();
  }

  /* Finished strokes live on a canvas of their own. A frame then costs the
     same whether the page holds one stroke or three hundred: blit that
     canvas, draw the single stroke still in progress. Repainting every
     stroke every frame is what makes writing get heavier as a page fills. */
  var committed = document.createElement('canvas');
  var cctx = committed.getContext('2d');
  var committedKey = null;

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    var w = Math.round(el.viewport.offsetWidth * dpr);
    var h = Math.round(el.viewport.offsetHeight * dpr);
    if (el.ink.width !== w || el.ink.height !== h) {
      el.ink.width = w; el.ink.height = h;
      committed.width = w; committed.height = h;
      committedKey = null;   // the bitmap is gone; redraw() will repaint it
    }
  }

  /* What the committed bitmap currently shows: which page, at which
     transform. Any change to either means it has to be drawn again. */
  function viewKey() {
    return pageKey() + '@' + zoom.toFixed(4) + ',' + Math.round(panX) + ',' + Math.round(panY);
  }

  function inkTransform(c) {
    var k = dpr * zoom;
    c.setTransform(k, 0, 0, k, dpr * panX, dpr * panY);
  }

  function rebuild() {
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, committed.width, committed.height);
    inkTransform(cctx);
    strokes().forEach(function (s) { paintStroke(cctx, s); });
    committedKey = viewKey();
  }

  function redraw() {
    sizeCanvas();
    if (committedKey !== viewKey()) rebuild();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.ink.width, el.ink.height);
    ctx.drawImage(committed, 0, 0);
    inkTransform(ctx);
    // The eraser previews correctly against this copy: destination-out on
    // the visible canvas cuts into the committed pixels just blitted.
    if (live) paintStroke(ctx, live);
  }

  /* ── Painting ───────────────────────────────────────────────────── */

  function strokeSmooth(c, p) {
    c.lineJoin = 'round';
    c.lineCap = 'round';
    if (p.length < 3) {
      c.fillStyle = c.strokeStyle;
      c.beginPath();
      c.arc(p[0][0], p[0][1], c.lineWidth / 2, 0, TAU);
      c.fill();
      return;
    }
    // Quadratic through sample midpoints — the samples become control
    // points, so the curve passes between them rather than through them.
    c.beginPath();
    c.moveTo(p[0][0], p[0][1]);
    for (var i = 1; i < p.length - 1; i++) {
      c.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    }
    c.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    c.stroke();
  }

  /* A variable-width stroke cannot be drawn with lineWidth, which is fixed
     for a whole path. Instead lay a disc at each sample and a quad between
     neighbours: opaque ink, so the overlaps cost nothing and the pieces
     read as one tapered band. Discs and quads fill separately to keep
     winding direction from ever subtracting one from the other. */
  function fillRibbon(c, p) {
    var discs = new Path2D(), band = new Path2D();
    for (var i = 0; i < p.length; i++) {
      var r = p[i][2] / 2;
      discs.moveTo(p[i][0] + r, p[i][1]);
      discs.arc(p[i][0], p[i][1], r, 0, TAU);

      if (i === p.length - 1) break;
      var x1 = p[i][0], y1 = p[i][1], x2 = p[i + 1][0], y2 = p[i + 1][1];
      var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) continue;
      var nx = -dy / len, ny = dx / len, r2 = p[i + 1][2] / 2;
      band.moveTo(x1 + nx * r, y1 + ny * r);
      band.lineTo(x2 + nx * r2, y2 + ny * r2);
      band.lineTo(x2 - nx * r2, y2 - ny * r2);
      band.lineTo(x1 - nx * r, y1 - ny * r);
      band.closePath();
    }
    c.fill(discs);
    c.fill(band);
  }

  function paintStroke(c, s) {
    var p = s.p;
    if (!p || !p.length) return;

    c.save();
    if (s.t === 'hl') {
      // Translucent, so it must be one stroked path: overlapping fills
      // would stack alpha and blotch where the stroke doubles back.
      c.globalAlpha = 0.4;
      c.globalCompositeOperation = 'multiply';
      c.strokeStyle = s.c;
      c.lineWidth = s.w * 5;
      strokeSmooth(c, p);
    } else if (s.t === 'er') {
      c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = '#000';
      c.lineWidth = s.w * 7;
      strokeSmooth(c, p);
    } else if (p[0].length > 2) {
      c.fillStyle = s.c;
      fillRibbon(c, p);
    } else {
      c.strokeStyle = s.c;      // saved before per-sample widths existed
      c.lineWidth = s.w;
      strokeSmooth(c, p);
    }
    c.restore();
  }

  /* ── Capture ────────────────────────────────────────────────────────
     Three things separate ink from a mouse trail: keeping every sample the
     digitizer produced rather than the one per frame the browser delivers,
     filtering jitter without adding lag, and giving the line a width that
     answers to the pen. */

  var MIN_CUTOFF = 1.4;   // Hz. Lower = steadier when the pen moves slowly.
  var BETA = 0.012;       // How quickly the filter opens up with speed.
  var PALM_MS = 1500;     // Ignore touches for this long after a pen sample.

  function LowPass() { this.y = null; }
  LowPass.prototype.filter = function (x, a) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  };

  /* One Euro filter. A fixed low-pass has to pick a side: filter hard and
     fast strokes lag behind the nib, filter lightly and slow strokes wobble
     with digitizer noise. This one raises its cutoff with speed, so it is
     smooth where you are careful and immediate where you are quick. */
  function OneEuro(minCutoff, beta) {
    this.min = minCutoff; this.beta = beta;
    this.xf = new LowPass(); this.df = new LowPass();
    this.tPrev = null; this.xPrev = 0;
  }
  OneEuro.prototype.alpha = function (cutoff, dt) {
    var tau = 1 / (TAU * cutoff);
    return 1 / (1 + tau / dt);
  };
  OneEuro.prototype.filter = function (x, t) {
    if (this.tPrev === null) {
      this.tPrev = t; this.xPrev = x; this.xf.y = x;
      return x;
    }
    var dt = Math.max((t - this.tPrev) / 1000, 1e-4);
    this.tPrev = t;
    var d = (x - this.xPrev) / dt;
    this.xPrev = x;
    var dHat = this.df.filter(d, this.alpha(1, dt));
    return this.xf.filter(x, this.alpha(this.min + this.beta * Math.abs(dHat), dt));
  };

  var fx = null, fy = null;   // position filters, one stroke's worth
  var activeId = null;        // the single pointer that owns the stroke
  var lastPenAt = -Infinity;
  var lastPt = null, lastT = 0, lastW = 0;

  /* The digitizer samples far faster than the screen refreshes — an Apple
     Pencil at 240Hz against a 60Hz frame. The browser keeps the samples it
     could not deliver individually and hands them over only if asked; skip
     this and three quarters of the stroke is thrown away, which is what
     makes a curve come out as a row of flat facets. */
  function samples(e) {
    if (e.getCoalescedEvents) {
      var cs = e.getCoalescedEvents();
      if (cs && cs.length) return cs;
    }
    return [e];
  }

  function widthFor(e, x, y, t) {
    // The nib keeps its size on screen, so zooming in writes finer on the
    // page — which is the point of zooming in to write.
    var base = state.size / zoom;
    if (e.pointerType === 'pen' && e.pressure > 0) {
      return base * (0.35 + 1.15 * e.pressure);
    }
    // Nothing to read the pressure from (finger, mouse), so let speed stand
    // in for it: a nib lays down less ink the faster it is dragged.
    var speed = 0;
    if (lastPt && t > lastT) {
      speed = Math.sqrt((x - lastPt[0]) * (x - lastPt[0]) + (y - lastPt[1]) * (y - lastPt[1])) / (t - lastT);
    }
    return base * (1.15 - 0.45 * Math.min(speed / 2.2, 1));
  }

  /* Filtering happens in stage space — screen pixels — not page space. The
     jitter being removed is physical, a property of the digitizer and the
     hand, so its scale does not change when the page is magnified. Filtering
     page coordinates instead would make the filter treat every stroke as
     slow at high zoom and smear it, which is the opposite of what zooming in
     to write is for. Only once filtered are samples mapped onto the page. */
  function addSamples(e) {
    var list = samples(e);
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var t = s.timeStamp || performance.now();
      var st = toStage(s);
      var x = fx.filter(st.x, t);
      var y = fy.filter(st.y, t);
      var w = widthFor(s, x, y, t);
      lastW = lastW ? lastW * 0.6 + w * 0.4 : w;   // no visible steps in the taper
      lastPt = [x, y];
      lastT = t;
      var pg = toPage({ x: x, y: y });
      live.p.push([pg.x, pg.y, lastW]);
    }
  }

  /* ── Pointers ───────────────────────────────────────────────────────
     One pointer draws (or pans, with the select tool). Two pointers are a
     pinch, never a stroke — so a second finger landing cancels whatever the
     first was drawing rather than leaving a stray mark behind. */

  var pointers = new Map();   // every pointer currently down, in stage space
  var gesture = null;         // pinch in progress
  var panning = null;         // one-finger pan with the select tool

  function abortStroke() {
    if (!live) return;
    live = null;
    activeId = null;
    redraw();
  }

  function beginGesture() {
    var pts = Array.from(pointers.values());
    var a = pts[0], b = pts[1];
    gesture = {
      dist: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      zoom: zoom, panX: panX, panY: panY,
      // What the committed bitmap already shows. During the pinch the canvas
      // is shifted with a CSS transform instead of being redrawn every
      // frame; it is re-rasterised once, at the end, when it settles.
      renderZoom: zoom, renderX: panX, renderY: panY
    };
  }

  function updateGesture() {
    var pts = Array.from(pointers.values());
    if (pts.length < 2) return;
    var a = pts[0], b = pts[1];
    var dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
    var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.zoom * (dist / gesture.dist)));
    // Hold the page point that started under the fingers under them still,
    // which folds the pan of a two-finger drag into the same maths.
    var pg = {
      x: (gesture.mid.x - gesture.panX) / gesture.zoom,
      y: (gesture.mid.y - gesture.panY) / gesture.zoom
    };
    panX = mid.x - pg.x * zoom;
    panY = mid.y - pg.y * zoom;
    clampPan();
    applyTransform();

    var k = zoom / gesture.renderZoom;
    el.ink.style.transform =
      'translate(' + (panX - k * gesture.renderX) + 'px,' + (panY - k * gesture.renderY) + 'px) scale(' + k + ')';
  }

  function endGesture() {
    gesture = null;
    el.ink.style.transform = '';
    redraw();                 // back to crisp ink at the settled scale
  }

  el.ink.addEventListener('pointerdown', function (e) {
    pointers.set(e.pointerId, toStage(e));
    if (e.pointerType === 'pen') lastPenAt = e.timeStamp;

    if (pointers.size === 2) {
      abortStroke();
      panning = null;
      try { el.ink.setPointerCapture(e.pointerId); } catch (x) { /* older engines */ }
      beginGesture();
      return;
    }
    if (pointers.size > 2) return;

    e.preventDefault();
    try { el.ink.setPointerCapture(e.pointerId); } catch (x) { /* older engines */ }

    if (state.tool === 'cursor') {
      panning = { id: e.pointerId, x: toStage(e).x - panX, y: toStage(e).y - panY };
      return;
    }
    if (activeId !== null) return;
    if (e.pointerType === 'touch' && e.timeStamp - lastPenAt < PALM_MS) return;

    activeId = e.pointerId;
    fx = new OneEuro(MIN_CUTOFF, BETA);
    fy = new OneEuro(MIN_CUTOFF, BETA);
    lastPt = null; lastT = e.timeStamp; lastW = 0;

    var tool = state.tool === 'pen' ? 'p' : state.tool === 'hl' ? 'hl' : 'er';
    live = { t: tool, c: state.color, w: state.size / zoom, p: [] };
    addSamples(e);
    redraw();
  });

  el.ink.addEventListener('pointermove', function (e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, toStage(e));
    if (e.pointerType === 'pen') lastPenAt = e.timeStamp;

    if (gesture) { updateGesture(); return; }

    if (panning && e.pointerId === panning.id) {
      var st = toStage(e);
      panX = st.x - panning.x;
      panY = st.y - panning.y;
      clampPan();
      applyTransform();
      if (!rafPending) {
        rafPending = requestAnimationFrame(function () { rafPending = 0; redraw(); });
      }
      return;
    }

    if (!live || e.pointerId !== activeId) return;
    addSamples(e);
    if (!rafPending) {
      rafPending = requestAnimationFrame(function () { rafPending = 0; redraw(); });
    }
  });

  function endStroke(e) {
    if (e) pointers.delete(e.pointerId);

    if (gesture && pointers.size < 2) endGesture();
    if (panning && (!e || e.pointerId === panning.id)) panning = null;

    if (!live || (e && e.pointerId !== activeId)) return;
    var s = live;
    live = null;
    activeId = null;

    // Round on the way out, not on the way in — quantising during capture
    // adds a jitter of its own for the filter to chase.
    s.p = s.p.map(function (q) {
      return [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10, Math.round(q[2] * 100) / 100];
    });

    paintStroke(cctx, s);                        // fold into the committed layer
    state.ink[pageKey()] = strokes().concat([s]);
    save();
    redraw();
  }

  el.ink.addEventListener('pointerup', endStroke);
  el.ink.addEventListener('pointercancel', endStroke);
  el.ink.addEventListener('lostpointercapture', endStroke);

  /* Trackpad pinch and ctrl+wheel both arrive here. */
  el.ink.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomAt(toStage(e), zoom * Math.exp(-e.deltaY * 0.01));
    if (!rafPending) {
      rafPending = requestAnimationFrame(function () { rafPending = 0; redraw(); });
    }
  }, { passive: false });

  el.zoomPill.addEventListener('click', resetZoom);

  function commit(next) {
    state.ink[pageKey()] = next;
    save();
    rebuild();
    redraw();
  }

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
      // The layouts are unrelated; a zoom carried over from one lands in an
      // arbitrary corner of the next. Navigating within a view keeps it.
      zoom = 1; panX = 0; panY = 0;
      applyTransform();
      render();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.toolbar [data-tool]'), function (b) {
    b.addEventListener('click', function () { state.tool = b.dataset.tool; renderToolbar(); });
  });

  /* ── Fit the fixed 1194×834 shell into whatever viewport we get ──── */

  function fit() {
    // The frameless layout sizes itself — scaling it too would just shrink it.
    if (window.innerWidth <= FRAME_MIN_W || window.innerHeight <= FRAME_MIN_H) {
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

  /* ── Offline, and updates that land in place ────────────────────────
     A service worker keeps the whole app on the device, so it opens with no
     network at all, and lets a new version replace the installed one without
     removing and re-adding the home-screen icon.

     Only the hosted site registers one. The single-file build has no origin
     to serve a worker from, and build.py strips its manifest link — which is
     what this checks for. */

  var swReg = null;

  function offerUpdate() {
    el.updatePill.hidden = false;
    el.updatePill.onclick = function () {
      el.updatePill.disabled = true;
      el.updatePill.textContent = 'Updating…';
      if (swReg && swReg.waiting) swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
    };
  }

  function watchWorker(reg) {
    var sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', function () {
      // Installed *while a worker already controls the page* means this is an
      // update rather than the first visit, which needs no announcement.
      if (sw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate();
    });
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!document.querySelector('link[rel="manifest"]')) return;

    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;   // controllerchange can fire more than once
      reloading = true;
      location.reload();
    });

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate();
      reg.addEventListener('updatefound', function () { watchWorker(reg); });
    }).catch(function () { /* offline support is a bonus, never a blocker */ });

    // A home-screen app can sit suspended for days. Check on the way back in
    // rather than only on a cold start.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && swReg) swReg.update();
    });
  }

  /* ── Boot ───────────────────────────────────────────────────────── */

  load();
  applyPaper();
  applyTransform();
  registerWorker();
  fit();
  render();
  // Fonts land after first paint and can nudge layout; redraw once settled.
  setTimeout(function () { fit(); redraw(); }, 60);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { fit(); redraw(); });
  }
})();
