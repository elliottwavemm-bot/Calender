# Inkling

A calendar you can draw on. Month, week and day views plus a sketchbook, with
a pen, highlighter and eraser layered over every page.

Plain HTML, CSS and JavaScript — no build step, no dependencies, no network
calls. The fonts ship with the repo, so it works offline and from `file://`.

## Running it

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

## Publishing

`.github/workflows/pages.yml` deploys to GitHub Pages on every push to the
default branch. It rebuilds the single-file bundle, assembles `_site` from
`index.html`, `assets/` and `dist/`, checks the bundle came out whole, and
publishes.

The first run turns Pages on itself (`enablement: true` on
`actions/configure-pages`), so there is no repository setting to flip by hand.
The site lands at `https://<owner>.github.io/Calender/`.

For a custom domain, add a `CNAME` file containing the hostname next to
`index.html` — the workflow copies it along with everything else.

## Building a single file

`build.py` folds the stylesheets, scripts and woff2 faces (as data URIs) into
one file that opens from disk and makes no network requests at all:

```
python3 build.py                  # -> dist/inkling.html   (~117 KB)
python3 build.py --fragment out.html   # body content only, for hosts that
                                       # supply their own <html> skeleton
```

`dist/inkling.html` is committed, so it can be shared or dropped onto any
static host on its own.

## What's here

```
index.html            markup shell
assets/css/tokens.css design system — colour ramps, type, elevation
assets/css/app.css    calendar and sketchbook layout
assets/js/events.js   calendar contents
assets/js/app.js      views, navigation and the ink layer
assets/fonts/         Caprasimo (headings) + Figtree (body), woff2 subsets
build.py              single-file bundler
dist/inkling.html     the bundled result
```

## Views

| View | Shows | What ← → does |
| --- | --- | --- |
| Month | 6×7 grid, up to two event chips per day then `+N more` | previous / next month |
| Week | seven day columns on a 12-hour grid | previous / next week |
| Day | one day beside a blank sheet for notes | previous / next day |
| Notes | a full sheet of paper | previous / next page |

`Today` jumps back to the current date. Today's date is marked with a filled
terracotta pill.

## Ink

The toolbar sits over every view: select, pen, highlighter, eraser, four ink
colours, three nib sizes, undo and clear.

- **Select** turns off drawing so the page underneath takes clicks again.
- **Highlighter** draws at 5× the nib width, translucent, in `multiply` — it
  tints what's under it instead of covering it.
- **Eraser** rubs out at 7× the nib width using `destination-out`, so it cuts
  through ink already laid down rather than painting over it in background
  colour.

Every page keeps its own strokes, keyed by what it shows (`m-2026-7`,
`w-2026-08-03`, `d-2026-7-4`, `n-1`). Flip to another month and back and the
marks are still there. Strokes are saved to `localStorage` under `inkling-ink`
and reloaded on the next visit; `Clear` empties the current page only.

Strokes are stored in the shell's own coordinate space, not screen pixels, so
they stay put when the window is resized or the shell is scaled down to fit.

## Configuration

At the top of `assets/js/app.js`:

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `paperTexture` | `dots`, `lines`, `plain` | `dots` | the sketch surface in Day and Notes |
| `weekStart` | `monday`, `sunday` | `monday` | first column of the month and week grids |
| `startHour` | `6`–`9` | `8` | first hour on the time grids |

The grid shows 12 hours from `startHour`, one hour per 56px row.

## Events

`assets/js/events.js` maps a local date to a list of entries:

```js
'2026-08-04': [{ n: 'Design review', h: 13, du: 1.5, c: 'a' }]
```

| Field | Meaning |
| --- | --- |
| `n` | name |
| `h` | start hour as a decimal — `12.5` is 12:30. Omit for an all-day entry |
| `du` | duration in hours; only read when `h` is present |
| `c` | colour role — `a` terracotta, `b` olive |

All-day entries render as a pill at the top of the column; timed entries are
placed and sized from `h` and `du`.

## Layout

The screen is a fixed 1194 × 834 shell — the design's device frame. Down to
tablet widths it scales uniformly through `--app-scale` rather than reflowing,
so the proportions hold exactly.

Under 860px that stops being flattering and starts being unreadable, so the
layout goes fluid: the frame comes off, the shell fills the viewport, the top
bar splits into two rows, the hour grid tightens from 56px to 44px, and the
sketch panel beside the day view — which needs width it hasn't got — gives
way. Under 520px the toolbar drops its group separators to keep all twelve
controls on one row. Row and header heights live in `--hour-h` and `--head-h`
so the CSS grid lines and the JS event positions retune together.
