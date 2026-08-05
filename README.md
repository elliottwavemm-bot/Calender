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

The site is served by GitHub Pages straight from the `main` branch
(**Settings → Pages → Source: Deploy from a branch**, branch `main`, folder
`/ (root)`), so a push is the whole deploy. `.nojekyll` turns off Jekyll
processing, which the site does not need.

It lives under the repository name, not at the domain root:
`https://<owner>.github.io/Calender/`.

`dist/inkling.html` is rebuilt with `build.py` and committed, so what is
served always matches the source.

<details>
<summary>Why not GitHub Actions?</summary>

An Actions workflow was tried first and could not deploy. Enabling Pages
creates a `github-pages` environment whose deployment branch rule rejected
every branch tried, failing the job before any step ran — *"Branch … is not
allowed to deploy to github-pages due to environment protection rules"*.
Having the workflow create the Pages site itself (`enablement: true`) was
refused too: creating one needs repository-admin rights that the workflow's
`GITHUB_TOKEN` does not carry. Branch-source deployment sidesteps the
environment entirely, and this site has no build step worth automating.

</details>

## Adding it to a home screen

`manifest.webmanifest` and an `apple-touch-icon` make the site installable: on
iOS *Add to Home Screen*, on Android *Install app*. It launches in
`standalone` display, so it opens without browser chrome.

The icon is the brand mark — the two overlapping circles, drawn as PNG in
`assets/icons/`. iOS ignores SVG favicons entirely and reads `apple-touch-icon`
instead, which is why the mark ships as a bitmap as well as the inline SVG
favicon. `icon-maskable-512.png` keeps the mark inside the safe zone for
platforms that crop icons to a circle.

Regenerate the PNGs from the mark with `tools/make-icons.js` (needs Playwright).

Note that this only applies to the site served from this repository. A copy
embedded in someone else's page takes that page's touch icon, not this one.

iOS copies the touch icon at the moment you add the app and never fetches it
again, so changing the icon means removing and re-adding. Changing the *app*
does not — see below.

## Offline, and updates in place

`sw.js` is a service worker that precaches the whole app, so it opens with no
network at all, and replaces itself when a new version ships — the home-screen
app updates without being removed and re-added.

`build.py` stamps the worker with a hash of everything it caches, plus the
worker's own logic. That matters both ways: browsers only install a worker
whose file differs byte for byte, so without the stamp a deploy would ship
files no installed client ever asks for; and a fix to the worker itself has to
reach clients even when no cached asset changed.

The update is deliberately not silent. A new worker installs in the background
and then waits — taking over a running page can pair new HTML with scripts the
old page already loaded. The page notices the waiting worker, shows a pill at
the top, and only on a tap does the worker take over and the page reload.
Drawings are in `localStorage` and survive it. The app also re-checks on
returning to the foreground, since a home-screen app can sit suspended for
days between cold starts.

One subtlety worth knowing: the precache uses `new Request(url, {cache:
'reload'})`. A plain `cache.addAll` may satisfy itself from the HTTP cache and
hand back the very files the update exists to replace — the cache name changes,
the contents do not, and the update silently does nothing.

Only the hosted site registers a worker. The single-file build has no origin to
serve one from; `build.py` strips its manifest link, which is what the
registration checks for.

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
tools/make-icons.js   redraws the app icons from the brand mark
.nojekyll             serve the files as-is, no Jekyll
manifest.webmanifest  home-screen install metadata
assets/icons/         app icons (PNG, for iOS and Android)
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

The toolbar sits over every view: select, pen, highlighter, eraser, five ink
colours, three nib sizes, undo and clear.

The colours are ink black, terracotta, olive, warm grey and red. The red is
pitched to the same warmth and saturation as the terracotta beside it — far
enough round the wheel to read as red rather than a second orange.

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

### Zoom

Pinch with two fingers, or hold ctrl/⌘ and scroll, to magnify up to 6× — far
enough to write a note inside a single day's cell. The pill at the bottom left
shows the level and resets it. With the select tool one finger pans; with any
drawing tool two fingers do, since a second finger landing means a pinch and
cancels whatever the first was drawing rather than leaving a stray mark.

Three things make it usable rather than just bigger:

**The ink is redrawn, not blown up.** The views are magnified with a CSS
transform, so type stays vector-sharp; the ink is re-rasterised with the same
transform baked into the canvas context. Scaling the canvas bitmap instead
would give soft, pixelated strokes exactly where the detail is wanted. During
a pinch the canvas *is* shifted as a bitmap — one cheap CSS transform per
frame instead of repainting every stroke — and re-rasterised once when the
gesture settles.

**The nib keeps its size on screen.** Stroke width is divided by the zoom, so
magnifying the page writes finer on it. Without that, zooming in to write
small would produce strokes as fat as the cell.

**Smoothing stays in screen space.** The filter below runs on stage
coordinates, before they are mapped onto the page. Jitter is physical — it
comes from the digitizer and the hand — so its scale does not change when the
page is magnified. Filtering page coordinates instead makes every stroke look
slow to the filter at high zoom, and it smears them.

Strokes are always stored unzoomed. Zoom is a way of looking at the page,
never part of what is on it.

### How the ink is captured

Four things separate ink that feels like a pen from a mouse trail:

**Every sample, not one per frame.** A digitizer runs far faster than the
screen refreshes — an Apple Pencil at 240Hz against a 60Hz frame. The browser
keeps the samples it could not deliver on their own and hands them over only
if asked, through `getCoalescedEvents()`. Without it three quarters of a
stroke is discarded, which is what turns a curve into a row of flat facets.

**A filter that does not trade lag for steadiness.** Raw positions carry
digitizer noise that shows up as wobble in slow, careful strokes. A fixed
low-pass has to pick a side: filter hard and fast strokes lag behind the nib,
filter lightly and slow ones shake. The [One Euro
filter](https://gery.casiez.net/1euro/) raises its cutoff with speed, so it is
smooth where you are careful and immediate where you are quick. `MIN_CUTOFF`
and `BETA` in `app.js` tune it.

**A width that answers to the pen.** With a stylus the line follows
`pointerEvent.pressure`. With a finger or a mouse there is no pressure to
read, so speed stands in for it — a nib lays down less ink the faster it is
dragged. `lineWidth` is fixed for a whole path, so a variable-width stroke
cannot be stroked; it is filled instead, as a disc at each sample plus a quad
between neighbours. The highlighter keeps a constant width and stays a single
stroked path, because overlapping translucent fills would stack alpha and
blotch wherever a stroke doubles back.

**A frame that costs the same at stroke 300 as at stroke 1.** Finished
strokes are folded into an offscreen canvas; a frame blits that and draws only
the stroke still in progress. Repainting every stroke every frame is what
makes writing grow heavier as a page fills:

| strokes on the page | repaint every stroke | blit + live stroke |
| ---: | ---: | ---: |
| 25 | 6.8ms | 3.6ms |
| 100 | 18.2ms | 3.6ms |
| 400 | 65.8ms | 3.9ms |

(per frame, measured with a GPU sync point after each; 60fps allows 16.7ms.)

Alongside those: `desynchronized: true` on the canvas context to skip a
compositing step, one pointer owning a stroke so a second finger cannot
corrupt it, and touches ignored for 1.5s after a pen sample so a resting palm
does not draw.

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
