# Capann

Chrome extension (Manifest V3) for presenting over a screen share: annotate any
web page, and record the tab to a local WebM. Everything runs locally — no
accounts, no network calls, no uploads.

## Features

### Mark screen (annotations — free forever)

- **Pencil** — freehand strokes, full color palette + custom color picker, adjustable size.
- **Highlighter** — translucent broad strokes.
- **Arrow** — drag to draw; head styles triangle / chevron / stick / **bender** (curved connector).
- **Shapes** — rectangle and ellipse, with an optional fill.
- **Comment** — click to place a Figma-style comment bubble; `Enter` sends, `Shift+Enter` adds a line, click it again to edit.
- **Select** — move, resize, and rotate annotations (Shift snaps rotation to 15°). Drag a comment's tail tip to re-aim what it points at.
- **Laser pointer** — a fading trail that replaces the cursor without blocking clicks.
- **Spotlight** — dims everything except a soft circle around the cursor, without blocking clicks.
- **Eraser** — remove individual marks.
- Undo / redo, duplicate (`Ctrl/Cmd+D`), delete (`Delete` / `Backspace`).
- Countdown timer (5 / 10 / 15 min) and Screen / Blackout / Whiteout mask.
- **Save PNG** — captures the tab composited with your annotations.
- Per-tab persistence: annotations survive tab switches and reloads until you hit Clear.

### Record (Premium)

- Records **the current tab** to a local `.webm`, with optional camera bubble, microphone, and tab audio.
- The Capann panel and annotations are hidden from the video. Turn on **Mark screen** in the Record view to draw during a recording instead — annotations then appear in the video, and the pencil bubble above the chip shows or hides the panel.
- A recording chip on the left edge (stop & save, timer, pause / resume, discard) and the camera bubble at the bottom right stay visible and are part of the recording.
- Missing camera, microphone, or tab audio never blocks a recording; a one-time grant page handles device permissions.

## Activation and shortcuts

Click the extension action, or press **Alt+Shift+S**, to open the in-page chooser
(Mark screen / Record) on the active tab.

| Shortcut | Idle | While recording |
|---|---|---|
| `Alt+Shift+S` | Open Capann | Stop and save |
| `Alt+Shift+T` | Next tool | Pause / resume |
| `Alt+Shift+C` | Clear annotations | Discard recording |
| `Esc` | Exit draw mode (keeps annotations) | — |

Chrome-protected pages (`chrome://`, the Web Store, extension pages) cannot be
annotated or recorded.

## Editions and branches

Recording is gated by a build-time **edition**. All branches share the same
code; they differ only in `capann.config.json`.

| Branch | Edition | Recording |
|---|---|---|
| `dev` | `premium` by default, switchable | Switchable |
| `free` | `free` | Locked behind Premium |
| `premium` | `premium` | Enabled |

Work and test on `dev`, then merge `dev` into `free` and `premium`. Never edit
`capann.config.json` on `dev` and never hardcode an edition in source — use the
edition build commands below. The gate and the Premium copy live in
`src/shared/features.ts`.

## Build

```
npm install
npm run build           # typecheck + bundle into dist/ (edition from capann.config.json)
npm run build:free      # free edition — recording locked
npm run build:premium   # premium edition
npm run watch           # rebuild on change (also watch:free / watch:premium)
npm run typecheck       # typecheck only
```

The build prints `Built <edition> edition` — check it before loading `dist/`.

Load `dist/` as an unpacked extension: `chrome://extensions` → enable Developer
Mode → **Load unpacked** → select the `dist` folder. After each rebuild, reload
the extension there and then reload the page you're testing, since content
scripts don't re-inject into open tabs.

### Tests

```
node scripts/record-wiring-test.mjs   # recorder/worker wiring against dist/ (either edition)
node scripts/smoke-test.mjs           # Playwright: loads the built extension in Chromium
```

## Project layout

```
manifest.json            Extension manifest (copied into dist/)
capann.config.json       Build edition for this branch (free | premium)
icons/                   Toolbar icons (scripts/gen-icons.js regenerates them)
src/background/          Service worker: action/shortcuts, tab capture, offscreen lifecycle, downloads
src/content/             Content script (React, Shadow DOM)
  OverlayApp.tsx           Chooser, Mark screen / Record views, canvases, history, persistence
  annotate-controls.tsx    Tool, color, size, and option controls
  shell.tsx                Shared draggable panel
  recording-chip.tsx       Recording chip, camera bubble, Mark screen bubble
  annotate-bridge.ts       Links the chip's bubble to the annotation panel
  cursors.ts               Per-tool cursors (Phosphor icons)
  render.ts, geometry.ts   Canvas drawing, hit tests, resize/rotate math
  text-bubble.ts           Comment bubble layout and outline
src/offscreen/           Offscreen recorder: composition, audio mixing, local WebM
src/permissions/         One-time camera/microphone grant page
src/shared/
  types.ts                 Annotation types and every message contract
  features.ts              Edition gate and Premium copy
scripts/build.mjs        esbuild bundler -> dist/ (reads the edition)
```

## Notes

- Requires `<all_urls>` so annotations and PNG capture work on whatever you're
  presenting (Meet, Zoom Web, Slides, internal dashboards, etc.).
- Annotations are stored in `chrome.storage.session`, keyed per tab: they clear
  when the browser session ends, and immediately on Clear.
- Requires Chrome 116+ for tab recording.

## Learning the codebase

See [`learn/README.md`](learn/README.md) for the architecture, annotation data
flow, recording internals, and a guide to extending Capann. `AGENTS.md` holds the
project rules, including the capture invariant that keeps the panel out of
screenshots and recordings.
