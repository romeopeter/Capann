# Capann

Chrome extension (Manifest V3) for presenting over a screen share: annotate any
web page, take framed screenshots, and record the tab to a local WebM. The free
features run entirely locally — no accounts, no network calls, no uploads.
Premium turns a recording into a 7-day share link, backed by a Cloudflare
Worker in [`apps/api/`](apps/api/README.md).

This repository is an npm-workspaces monorepo:

| Path | What |
|---|---|
| [`apps/extension/`](apps/extension) | The Chrome extension |
| [`apps/api/`](apps/api/README.md) | The Premium API (Cloudflare Worker) |
| [`apps/website/`](apps/website/README.md) | The website: landing, playground, and the Premium sign-in and link pages |
| [`packages/contract/`](packages/contract/src/index.ts) | What the extension, API, and website agree on: request/response types, error codes, routes, limits, website → extension messages |
| [`packages/api-client/`](packages/api-client/src/index.ts) | fetch client for the API, used by the extension and the website |

## Features

Annotation, screenshots, and instant tab recording are **free**. Premium adds shareable links;
a browser-AI layer is planned.

### Mark screen

- **Pencil** — freehand strokes, full color palette + custom color picker, adjustable size.
- **Highlighter** — translucent broad strokes.
- **Arrow** — drag to draw; head styles triangle / chevron / stick / **bender** (curved connector).
- **Shapes** — rectangle and ellipse, with an optional fill.
- **Text** — click anywhere and type straight onto the page. Pick the color and size as usual, and a font: Sans, Serif, Mono, or Hand. Click a text to edit it; select one to restyle it.
- **Comment** — click to place a Figma-style comment bubble; `Enter` sends, `Shift+Enter` adds a line, click it again to edit.
- **Select** — move, resize, and rotate annotations (Shift snaps rotation to 15°). Drag a comment's tail tip to re-aim what it points at.
- **Laser pointer** — a fading trail that replaces the cursor without blocking clicks.
- **Spotlight** — dims everything except a soft circle around the cursor, without blocking clicks.
- **Zoom lens** — a round magnifier that follows the cursor (1.5× / 2× / 3×, small / medium / large), without blocking clicks.
- **Eraser** — remove individual marks.
- **Screenshot** — drag over an area to capture it, then mark it up and frame it (below).
- Hover a tool to see its name and what it does in the panel header; the header shows the active tool otherwise.
- Undo / redo, duplicate (`Ctrl/Cmd+D`), delete (`Delete` / `Backspace`).
- Countdown timer (5 / 10 / 15 min) and Screen / Blackout / Whiteout mask.
- **Save PNG** — captures the tab composited with your annotations.
- Annotations scroll with the page (window scrolling; apps that scroll an inner panel keep them fixed).
- Per-tab persistence: annotations survive tab switches and reloads until you hit Clear.

### Screenshot (in Mark screen)

- Pick the **Screenshot** tool in the Mark screen panel, then drag a box over the page (or take the whole visible area); marks already on the page come along.
- Mark it up with the same tools on the frozen image. Nothing touches the page's own annotations.
- **Style** opens the side panel: a minimal background (soft solids, quiet gradients, a custom color, or none), padding, rounded corners, shadow, and border. The frame updates live. These controls appear only while a screenshot is open.
- **Copy** to the clipboard or **Save** a PNG, at full resolution.

### Record

- Records **the current tab** to a local `.webm`, with optional camera bubble, microphone, and tab audio.
- The Capann panel and annotations are hidden from the video. Turn on **Mark screen** in the Record view to draw during a recording instead — annotations then appear in the video, and the pencil bubble above the chip shows or hides the panel.
- A recording chip on the left edge (stop & save, timer, pause / resume, discard) and the camera bubble at the bottom right stay visible and are part of the recording.
- Missing camera, microphone, or tab audio never blocks a recording; a one-time grant page handles device permissions.

### Share (Premium)

- **Sign in with email** from the Record view — no password. The emailed link opens the website, which hands the session to the extension.
- **Upgrade** opens Bachs checkout for the signed-in email; the panel picks up the new plan when you return.
- When a paid user stops a recording, it **uploads and the link is copied** to the clipboard. A dialog asks whether to also keep the `.webm` (with "Don't ask again"; change it later under **Keep a copy**).
- A failed upload always saves the file locally, so a recording is never lost.
- **My links** opens the side panel's Links tab: every live link with Copy, Open, and a countdown to its 7-day expiry, plus "Lost a link?" email recovery.
- The free build shows one link to the pricing page instead, and makes no network calls.

## Activation and shortcuts

Click the extension action, or press **Alt+Shift+S**, to open the in-page chooser
(Mark screen / Record) on the active tab.

| Shortcut | Idle | While recording |
|---|---|---|
| `Alt+Shift+S` | Open Capann | Stop and save |
| `Alt+Shift+T` | Next tool | Pause / resume |
| `Alt+Shift+C` | Clear annotations | Discard recording |
| `Esc` | Exit draw mode (keeps annotations) | — |
| `Enter` / `Esc` (choosing a screenshot area) | Whole visible area / cancel | — |

Chrome-protected pages (`chrome://`, the Web Store, extension pages) cannot be
annotated or recorded.

## Editions and branches

Premium features will be gated by a build-time **edition**. All branches share the same
code; they differ only in `capann.config.json`.

| Branch | Edition | Includes |
|---|---|---|
| `dev` | `premium` by default, switchable | Everything; switch editions at build time |
| `free` | `free` | Annotation, screenshots, and recording |
| `premium` | `premium` | Free features + Premium (browser AI, shareable links) |

Work and test on `dev`, then merge `dev` into `free` and `premium`. Never edit
the edition in `capann.config.json` on `dev` and never hardcode an edition in
source — use the edition build commands below. The gate (`PREMIUM_ENABLED`)
lives in `apps/extension/src/shared/features.ts`. The premium build adds the account row, share
flow, and the side panel's Links tab, and its manifest adds
`externally_connectable` for the website; the free manifest is `manifest.json`
unchanged (the side panel, with its Screenshot tab, is in both).

## Build

Everything runs from the repository root:

```
npm install             # one install for every workspace
npm run build           # typecheck + bundle into apps/extension/dist/ (edition from capann.config.json)
npm run build:free      # free edition
npm run build:premium   # premium edition
npm run watch           # rebuild on change (also watch:free / watch:premium)
npm run typecheck       # typecheck every workspace: extension, api, packages
```

The build prints `Built <edition> edition` — check it before loading the build.

`apps/extension/capann.config.json` also sets the Premium backend (`apiUrl`) and
website (`siteUrl`). To try Premium against a local API and website without
editing it:

```
npm run api:dev -- --port 8799   # needs apps/api/.dev.vars (copy .dev.vars.example)
npm run build:backend            # premium build pointed at 127.0.0.1:8799 and localhost:5173
```

Load `apps/extension/dist/` as an unpacked extension: `chrome://extensions` →
enable Developer Mode → **Load unpacked** → select that folder. After each
rebuild, reload the extension there and then reload the page you're testing,
since content scripts don't re-inject into open tabs. (Chrome derives an
unpacked extension's ID from its folder, so loading it from a new folder gives
it a new ID.)

### Tests

```
npm run test:wiring    # recorder/worker wiring against the built extension (either edition)
npm run api:test       # the API end to end, against `npm run api:dev`
npm run test:premium   # the extension's Premium client (api-client + uploader) against the same
```

`apps/extension/scripts/smoke-test.mjs` is out of date (hard-wired to another
machine's paths).

### Website

```
npm run website:dev      # http://localhost:5173 (the origin the local extension build trusts)
npm run website:build    # apps/website/dist (+ 404.html SPA fallback)
npm run website:lint
```

### Deploy

- API: see [`apps/api/README.md`](apps/api/README.md); `npm run api:deploy` runs
  `wrangler deploy`.
- Website: GitHub Actions ([`.github/workflows/website.yml`](.github/workflows/website.yml))
  builds `apps/website` and publishes it to this repository's GitHub Pages at
  `https://capann.duowork.tech` on every push to `main` that touches the site
  or the shared packages. The workflow's header lists the one-time repository
  settings (Pages source, custom domain, and the `VITE_CAPANN_*` variables).

## Project layout

```
package.json             Workspace root: scripts for every app
tsconfig.base.json       Compiler options every workspace extends
AGENTS.md, learn/        How it all works, and how to change it

packages/contract/       Shared types, error codes, routes, limits (imports nothing)
packages/api-client/     fetch client for the API

apps/api/                Premium API: Cloudflare Worker, R2, KV, Durable Object (see its README)
apps/website/            Website (Vite + React + Tailwind; see its README and AGENTS.md)

apps/extension/
manifest.json            Extension manifest (copied into dist/)
capann.config.json       Build edition for this branch (free | premium)
icons/                   Toolbar icons (scripts/gen-icons.js regenerates them)
src/background/          Service worker: action/shortcuts, tab capture, offscreen lifecycle, downloads
  premium.ts               Premium: account, website hand-off, share-status relay, link history
src/content/             Content script (React, Shadow DOM)
  OverlayApp.tsx           Chooser, Mark screen / Record views, canvases, history, persistence
  premium-panel.tsx        Premium account row, share card, "Save a copy?" dialog, free teaser
  annotate-controls.tsx    Tool, color, size, and option controls
  shell.tsx                Shared draggable panel
  recording-chip.tsx       Recording chip, camera bubble, Mark screen bubble
  annotate-bridge.ts       Links the chip's bubble to the annotation panel
  cursors.ts               Per-tool cursors (Phosphor icons)
  render.ts, geometry.ts   Canvas drawing, hit tests, resize/rotate math
  text-bubble.ts           Comment bubble layout and outline
  free-text.ts             Free text (Text tool): fonts, layout, composer
  zoom-lens.ts             Zoom lens drawing
  screenshot.tsx           Screenshot area selector, framed editor stage, export
src/offscreen/           Offscreen recorder: composition, audio mixing, local WebM
  share.ts, uploader.ts    Premium share jobs and the single/multipart uploader
src/permissions/         One-time camera/microphone grant page
src/sidepanel/           Side panel: Screenshot style (every build), Links (Premium)
src/shared/
  types.ts                 Annotation types and the extension's message contracts
  features.ts              Edition gate (PREMIUM_ENABLED), API and site URLs
  screenshot-style.ts      Screenshot frame style, shared by the page and side panel
  premium/store.ts         Premium session, preferences, and link history (chrome.storage.local)
scripts/build.mjs        esbuild bundler -> dist/ (reads the edition, writes the manifest)
```

## Notes

- Requires `<all_urls>` so annotations and PNG capture work on whatever you're
  presenting (Meet, Zoom Web, Slides, internal dashboards, etc.).
- Annotations are stored in `chrome.storage.session`, keyed per tab: they clear
  when the browser session ends, and immediately on Clear.
- Requires Chrome 116+ for tab recording.
- Premium keeps its session, the "Keep a copy" choice, and link history in
  `chrome.storage.local`, so they survive a browser restart.

## Learning the codebase

See [`learn/README.md`](learn/README.md) for the architecture, annotation data
flow, recording internals, and a guide to extending Capann. `AGENTS.md` holds the
project rules, including the capture invariant that keeps the panel out of
screenshots and recordings.
