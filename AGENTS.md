# Capann - Project Context

## Overview

Capann is a Manifest V3 Chrome extension for presenting over a screen share. It
does two jobs from one in-page overlay:

1. **Annotate** — draw, highlight, point, and comment directly over any web page
   without modifying the underlying content.
2. **Record** — capture the current tab to a local WebM, optionally with a camera
   bubble, microphone, and tab audio, with the overlay and annotations hidden
   from the frames.

The free features run entirely locally: no network calls, no accounts, no uploads. Premium
(cloud links for recordings) is backed by a separate Cloudflare Worker in `backend/`; see
[Premium Backend](#premium-backend) and [Premium Share Links](#premium-share-links).

## Branch Strategy

`dev` is the integration branch and holds **all features plus the edition
gate**. The edition is a build-time setting, so all three branches share the same
code and differ only in `capann.config.json`:

| Branch | Purpose | `capann.config.json` edition | Includes |
|---|---|---|---|
| `dev` | Integration branch; build either edition | `premium` (default) | Premium features switchable |
| `free` | Free edition | `free` | Annotation + recording |
| `premium` | Paid edition | `premium` | Free features + Premium |

- `scripts/build.mjs` reads `capann.config.json` and injects it as
  `__CAPANN_EDITION__` (esbuild `define`). `--edition=free|premium` overrides it,
  which is what `npm run build:free` / `build:premium` and
  `watch:free` / `watch:premium` do. Use those on `dev` to test either edition.
- Annotation and instant tab recording are free in every edition. Premium is
  reserved for the browser-AI layer and shareable cloud links. Links are built
  in the extension and `backend/`; the website's `/verify` and `/view-my-links`
  pages are not built yet. `src/shared/features.ts` derives `PREMIUM_ENABLED`
  from the edition; gate Premium features on it in both the UI and the service
  worker. The free build shows one teaser link to the pricing page and nothing
  else.
- `build.mjs` writes `dist/manifest.json` per edition: free is `manifest.json`
  unchanged; premium adds the `sidePanel` permission, `side_panel`, and
  `externally_connectable` for `siteUrl`. `capann.config.json` also holds
  `apiUrl` and `siteUrl` (`--api-url=` / `--site-url=` override them), and only
  the edition differs between branches.
- Land shared behavior on `dev` first, then merge `dev` into both edition
  branches. The only edition-specific change is `capann.config.json`; never
  hardcode an edition in source.
- `dist/` is gitignored and only reflects the last build, so check the
  `Built <edition> edition` line before loading it in Chrome.

## Core Features

### Annotation Tools
- **Pencil**: Freehand drawing with the full palette, a custom color picker, and adjustable size
- **Highlighter**: Translucent broad strokes
- **Arrow**: Drag-to-draw arrows with adjustable size and four head styles — triangle, chevron, stick, and **bender** (curved connector)
- **Shapes**: Rectangle and ellipse with an optional fill
- **Comment** (tool id `text`; Phosphor chat-circle icon): Click to place a Figma-style comment bubble; click it again with the Comment tool to edit
- **Select**: Hit-test the topmost annotation, then move it, resize it with handles, or rotate it with the knob above the box (Shift snaps to 15°). Shapes store an optional `rotation`; strokes and arrows are rotated by moving their points. Text notes do not rotate
- **Laser Pointer**: Fading cursor trail that doesn't block page interaction
- **Spotlight**: Dims everything except a soft circle around the cursor without blocking clicks
- **Eraser**: Remove individual annotations, with a ring cursor matching its reach
- **Draw mode toggle**: Clicking the active tool deselects it, returning pointer events to the page while annotations stay visible

### Productivity Features
- **Undo/Redo**: Full history navigation, capped at 50 states; one completed drag equals one undo step
- **Duplicate**: Copy the selected annotation
- **Delete**: Remove the selected annotation from the header trash icon or with `Delete` / `Backspace` (undoable)
- **Countdown Timer**: 5/10/15 minute presets for timeboxed sessions
- **Screen Mask**: Cycles Screen/Blackout/Whiteout for focused attention
- **PNG Export**: Capture the tab composited with annotations (selection frames excluded)
- **Per-tab Persistence**: Annotations survive tab switches and reloads until cleared

### Recording
- **Tab capture** of the tab Capann was invoked on, written to a local `.webm`
- **Camera bubble**: Optional circular webcam preview at the bottom right, rendered by the recording chip; hovering reveals an S/M/L size control (M default), and it is part of the tab capture
- **Recording chip**: A separate in-page chip that stays visible for the whole recording (elapsed time, pause/resume, stop & save, discard, camera preview); intentionally recorded
- **Audio**: Optional microphone mixed with captured tab audio, with tab audio routed back to speakers so the presenter still hears it
- **Overlay hiding**: `#capann-host` (annotations + panel) is hidden for the duration of a capture; `#capann-recording-host` stays visible
- **Status reporting**: The chip and the Chrome action badge/title show recording or paused state
- **Non-blocking degradation**: Missing camera, microphone, or tab audio never blocks recording; unavailable inputs are reported in the Record view
- **Explicit grant flow**: A visible extension page obtains camera/microphone permission, since offscreen documents cannot prompt
- **Free in every edition**: recording is not gated. `PREMIUM_ENABLED` in `src/shared/features.ts` is reserved for the Premium layer (browser AI, shareable links)
- **Premium links**: a paid user's stop uploads the recording and copies its link instead of downloading; see [Premium Share Links](#premium-share-links)

## Keyboard Shortcuts

Each shortcut changes meaning while a recording is active:

| Shortcut | Idle | Recording |
|---|---|---|
| `Alt+Shift+S` | Open Capann on this tab | Stop and save |
| `Alt+Shift+T` | Cycle to the next tool | Pause / resume |
| `Alt+Shift+C` | Clear annotations on this tab | Discard the recording |
| `Enter` / `Shift+Enter` | Send a text note / insert a newline | — |
| Click away from a text note | Send it | — |
| `Esc` | Exit annotation mode (keeps annotations); while editing, cancel (restore an existing note or discard a new draft) | — |
| `Ctrl/Cmd+D` | Duplicate the selected annotation (handled in-page, not a manifest command, because Chrome reserves it for bookmarks) | — |
| `Delete` / `Backspace` | Delete the selected annotation (only while draw mode is on) | — |

Undo/redo are button-only in the shell header; there is no `Ctrl+Z` binding.

## Fusion Code: The Change Rule

Capann is two independent features — annotation and recording — that share one
overlay host. Most files belong to one side. A few are **fusion code**: they own
state, control flow, or contracts for both at once.

Fusion files:
- `src/content/OverlayApp.tsx` — both state trees, both message streams, both capture paths
- `src/background/service-worker.ts` — overloaded shortcuts, tab capture, PNG capture, offscreen lifecycle
- `src/shared/types.ts` — annotation unions and recording contracts in one file

### The rule

Modifying or removing stable code is allowed — a new feature often cannot land
without reshaping what is already there. What is not allowed is **silently
displacing a behavior**.

Before deleting or repurposing an existing flag, state value, effect, early
return, or step in a sequence, answer: *what did this do, and who still needs
it?* If the answer is "another feature," the change must rewire that behavior so
both features keep working. The new and old changes must interleave without a
regression — not one replacing the other.

### Precedent: how PNG export broke

`3eaa296` introduced `captureHidden` so recordings could hide the overlay, and
deleted the export-only `isCapturing` flag that did the same job for Save PNG.
The new flag looked like a general replacement, but only recording status wrote
it, so PNG export lost its hide step. The screenshot then contained the
annotations, and the existing compose step drew them again — every object
appeared twice and the toolbar appeared in the image.

The lesson is not "never delete a flag." It is that the export's
hide-before-capture step was a *behavior*, not an implementation detail, and
nothing enforced it. When two features need the same effect, either share one
mechanism deliberately or keep two independent ones — but name the invariant.

### Capture invariant (do not break)

Any path that captures pixels must hide the **annotation overlay** first. The
recording chip is the one deliberate exception: it is a separate host and is
meant to appear in the recording.

1. Hide `#capann-host` (the annotation shadow host) before requesting the capture.
2. Wait for a paint if the hide is state-driven; hide synchronously if you can.
3. Restore to `captureHidden` afterwards, never blindly to "visible".

| Path | How it hides | Restores to |
|---|---|---|
| Recording | `captureHidden` → host style + subtree wrapper (kept visible, panel unmounted, when **Annotate screen** is on) | — |
| PNG export | local host style inside `savePng` | `overlayVisible` (`!captureHidden \|\| annotateWhileRecording`) |
| Recording chip | never hidden — separate `#capann-recording-host` | — |

**Annotate screen** (Record view toggle) is the one opt-in exception: annotations
are meant to appear in the video, so the host stays visible while the Capann panel
is unmounted (`shellView`) until the chip's pencil bubble opens it. The bubble lives
in the chip host and talks to `OverlayApp` through `src/content/annotate-bridge.ts`.
The panel must still never be on screen at the moment the stream ID is minted.

Recording and export deliberately use separate mechanisms: export is a one-shot
hide, recording is a lifecycle state. Merging them reintroduces the bug above.

A Premium share job (upload + "Save a copy?") starts only after the capture has
ended and the overlay is visible again, so it never touches `captureHidden`.
The chip is also separate: it must never reuse `captureHidden`, or the timer,
controls, and camera preview would disappear from the video.

### Checklist for a fusion change

1. Read the fusion note at the top of `OverlayApp.tsx`.
2. List the *behavior* you are about to delete, not just the code.
3. Find every consumer — grep the flag or function name before removing it.
4. If another feature depends on that behavior, rewire it in the same change.
5. Re-test both halves: annotate + Save PNG, and record + save + discard. During recording, confirm the annotation panel is absent from the video, the chip is present with a live timer, and the camera preview sits at the bottom right.
6. If ownership or an invariant changed, update this section and the fusion note.

## Architecture

### Extension Structure

```
manifest.json              Chrome extension manifest (Manifest V3)
src/background/
  service-worker.ts        Action/shortcut handling, tabCapture stream IDs, offscreen
                           lifecycle, downloads, badge, permission routing, stage logging
  premium.ts               Premium account (sign-in, upgrade, refresh), website hand-off
                           (onMessageExternal), share-status relay, link history
src/content/               Content script injected into tabs (React, Shadow DOM)
  overlay.tsx              Shadow DOM setup and React root bootstrap; mounts OverlayApp
                           hidden until recording state is checked, plus the separate
                           #capann-recording-host for the recording chip
  OverlayApp.tsx           Chooser + workflow views, annotation state, canvases, input,
                           history, persistence, timer, mask (the largest file)
  recording-chip.tsx       Floating recording controls (timer, pause/resume, stop,
                           discard) and bottom-right camera preview in their own host
  premium-panel.tsx        Record view's Premium pieces: account row, share card,
                           "Save a copy?" dialog, free-build teaser
  shell.tsx                Shared draggable panel shell: header, Back/Close, positioning
  annotate-controls.tsx    Annotation controls rendered inside the shell (former Toolbar
                           body: tools, colors, size, head/fill options, timer, mask)
  render.ts                Canvas rendering for all annotation types
  geometry.ts              Bounds, hit tests, and selection/eraser targeting
  text-bubble.ts           Shared text-bubble layout, wrapping, tails, fonts
  page-space.ts            Page <-> viewport coordinates and canvas transforms for scrolling
  icons.ts                 SVG path definitions for tool icons
src/offscreen/
  offscreen.html           Offscreen document entry (loads the IIFE recorder bundle)
  index.html               Unused near-duplicate of offscreen.html; not copied by the build
  recorder.ts              Tab composition, camera preview frame streaming, audio mixing,
                           WebM chunks, download request or share hand-off
  share.ts                 Premium share jobs: upload + local-copy choice, never lose a file
  uploader.ts              Single or multipart upload with progress (XHR), retries
src/permissions/
  permissions.html         Visible one-time camera/microphone grant page (offscreen
                           documents cannot show permission prompts)
  permissions.ts           Requests each enabled device, then reports back
src/sidepanel/             Premium "Your links" side panel (premium build only)
src/shared/
  types.ts                 Annotation types, tool ids, recording status/stages/error
                           codes, and all message contracts
  features.ts              Edition gate, API_URL / SITE_URL / PRICING_URL
  premium/api.ts           Backend JSON client (worker + side panel only)
  premium/store.ts         chrome.storage.local: session, copy preference, link history
scripts/
  build.mjs                esbuild bundler (TypeScript + React -> JavaScript), 4 entry points
  gen-icons.js             Icon generator script (no external deps)
  smoke-test.mjs           Playwright automated testing
  premium-e2e.mjs          Premium client (api.ts + uploader.ts) against wrangler dev
learn/                     Accurate handbook: architecture, annotations, recording,
                           making-changes. Read this before large changes.
backend/                   Separate Cloudflare Worker project (own package.json) for
                           Premium; not part of the extension build. See backend/README.md
```

### Runtime Flow

1. The user invokes Capann from the action or `Alt+Shift+S`. That invocation is what grants `tabCapture` for that tab.
2. The service worker messages the tab's content script; the in-page **chooser** opens.
3. `overlay.tsx` creates `#capann-host`, attaches a Shadow DOM, and mounts `OverlayApp` (host starts `visibility: hidden` until recording state is known, so persisted annotations never flash into a capture). It also creates `#capann-recording-host`, a separate always-visible host for the recording chip.
4. `OverlayApp` owns two sibling views inside `CapannShell`: **Annotate** and **Record**.
5. Annotate uses two stacked canvases — bottom for committed objects, top for pointer input, previews, and selection handles.
6. Record pre-warms the offscreen recorder, then mints a `tabCapture` stream ID, hands it to the offscreen document, and that document composes/encodes. The recorder streams camera preview frames to the chip, which draws the bottom-right circular bubble as part of the captured tab.
7. On save, the recorder creates a Blob URL and asks the service worker to `chrome.downloads.download` it. For a paid Premium session the stop command carries a share request instead, and the recorder hands the Blob to a share job (see [Premium Share Links](#premium-share-links)).

### Key Technical Details

**Manifest V3**: Service worker background (not persistent). Requires Chrome 116+ for the `tabCapture` route.

**Canvas Architecture**:
- Two overlapping HTML5 canvases injected into each tab, scaled by devicePixelRatio, **viewport-sized and fixed** (never page-sized — see `learn/canvas.md` for the memory cost)
- Annotations are stored in **page coordinates** and scroll with the page: pointer input goes through `pagePoint`, drawing goes through `setPageTransform`, and a scroll listener redraws both layers (`src/content/page-space.ts`). Only window scroll is tracked. Laser and spotlight stay in screen space (`setScreenTransform`)
- Bottom canvas: persisted annotations; top canvas: current stroke/shape and selection frames
- Top canvas only receives pointer events (`pointer-events: auto`) while a capturing tool is active, so the page stays usable otherwise
- Capturing tools: pencil, highlighter, arrow, rectangle, ellipse, text, eraser, select. Laser and spotlight are non-capturing and must never block clicks.

**Text Bubbles**:
- Clicking with the text tool opens a DOM composer in the Shadow DOM, anchored to the click point
- `Enter` sends, `Shift+Enter` adds a newline, clicking away sends, `Esc` cancels
- Bubbles are 140–280px wide and grow vertically; the composer scrolls after about six lines while committed notes render every line
- The composer and canvas share `text-bubble.ts` layout, so a note does not move or reflow on commit
- The tail and the composer's send button use the panel surface, not the palette color; only the send arrow is violet. The tail flips sides near viewport edges; hovering with the text tool draws only a subtle outline, never a scale effect
- Clicking a committed note with the text tool edits it in place; empty commits delete an existing note (undoable)
- Body and tail are one outline (`bubbleOutlinePath`), filled and stroked once, so there is no seam at the tail base
- With the Select tool, a selected comment shows a knob on its tail tip. Dragging it re-aims the pointer while the bubble stays put: the first drag pins the bubble (`TextAnnotation.bubble`), and the tail then leaves from whichever edge faces the tip. Comments without `bubble` keep automatic above/below placement against the whole page (`pageViewport`), so they do not flip while scrolling. A new comment whose on-screen placement differed from that (near a screen edge) is pinned where it was shown

**PNG Export**: `savePng` hides the shadow host synchronously, waits two animation frames, captures the tab, restores visibility from `captureHidden`, then draws annotations **exactly once** onto the screenshot, offset by the scroll via `setPageTransform`. The screenshot is annotation-free by construction; if the hide step is ever missing, the capture already contains the annotations and they get drawn a second time.

**Storage**: `chrome.storage.session`, keyed by tab ID (`capann_tab_<id>`). Cleared on browser close and immediately on Clear. Preserve the "survives reload, not restart" behavior unless explicitly asked otherwise.

**Message Passing**: typed boundaries, all discriminated unions in `src/shared/types.ts`:
- `BackgroundToContentMessage` / `ContentToBackgroundMessage`
- `BackgroundToRecorderMessage` / `RecorderToBackgroundMessage`
- `WebsiteToExtensionMessage` (premium only): the website → service worker, checked against `siteUrl`

Any change to a message shape must update every participant. The website
messages are a contract with the separate website codebase.

**Permissions**: `<all_urls>`, `storage`, `activeTab`, `downloads`, `tabCapture`, `tabs`, `offscreen`; the premium build adds `sidePanel`. No `<all_urls>` alternative works — annotations and PNG capture must function on whatever the presenter is sharing. It also covers the API origin, which is what exempts the worker, offscreen document, and side panel from CORS.

### Recording Internals

**Order is load-bearing.** A `tabCapture` stream ID can be redeemed once and expires within seconds, so the sequence is fixed:

```
offscreen ready -> hide overlay -> mint stream ID -> send ID -> getUserMedia
```

Minting before the recorder is ready is the main source of intermittent failures.

- `record-prewarm` creates the offscreen document and waits for its `offscreen-ready` signal before enabling Start.
- The worker refuses concurrent starts (`startInFlight`), ignores status from stale sessions, and closes the offscreen document on any startup failure so a timed-out start cannot leave the tab muted or a recorder running.
- The recorder checks `navigator.permissions.query()` **before** calling `getUserMedia()`. Offscreen documents cannot prompt, so an unpermitted device would otherwise hang forever; the device is skipped instead.
- The compositor redraws on a **33ms timer**, not `requestAnimationFrame`: offscreen documents are never rendered, so rAF does not run and `requestVideoFrameCallback` is unreliable. Without the timer, `MediaRecorder` never fires `onstart` and startup times out.
- Every startup await is bounded (tab stream 8s, camera/mic 6s in parallel, video 6s, audio 3s, recorder start 5s).
- Chrome allows one offscreen document per extension; the worker pings any existing one, closes it if stale, and retries once on "Only a single offscreen document may be created".
- Tab audio is muted by Chrome during capture, so the recorder pipes it back to local playback.
- Chunks stay in memory in the offscreen document; discard drops them without downloading.
- **The offscreen document closes only when idle**: no recording *and* no share
  job. `closeOffscreenIfIdle` and the permission-grant reset ask the document
  (`offscreen-ping` → `busy`) first; closing it mid-upload would lose the file.

**Session logging**: each session gets an id and every stage transition logs
`[Capann] session=<id> stage=<stage> {...}`. Failures log the stage, browser error name, and message. The UI only ever shows friendly mapped messages — see the failure table in `learn/recording.md`.

**Recording stages**: `preparing-recorder`, `acquiring-tab-stream`, `preparing-video`, `starting-recorder`, `recording`, `paused`, `stopping`, `finalizing`, `idle`.

**Terminal statuses**: `saved`, `sharing` (Premium: the file went to a share job), `discarded`, `error`.

**Recording error codes**: `TAB_CAPTURE_UNAVAILABLE`, `TAB_STREAM_ACQUISITION_FAILED`, `NO_VIDEO_TRACK`, `RECORDER_STARTUP_FAILED`, `OFFSCREEN_SETUP_FAILED`, `PERMISSION_DENIED_CAMERA`, `PERMISSION_DENIED_MICROPHONE`, `PERMISSION_DENIED_TAB_AUDIO`, `PROTECTED_PAGE`, `RECORDING_STOPPED_UNEXPECTEDLY`, `FILE_SAVE_FAILED`.

**Protected pages**: `chrome://`, `edge://`, extension pages, and the Web Store cannot be annotated or captured.

## Design System

Capann uses a dark, translucent, frosted-glass design system optimized for screen sharing.

### Design Tokens

`design-tokens.md` is the canonical reference; keep code and that file aligned.

```css
/* Surfaces */
--surface-base: #1C1C20;       /* toolbar panel fill */
--surface-elevated: #26262B;   /* hover / pressed state on icon buttons */
--surface-translucent: rgba(28,28,32,0.72); /* actual panel bg with backdrop blur */

/* Borders */
--border-hairline: rgba(255,255,255,0.08);
--border-hairline-strong: rgba(255,255,255,0.15);

/* Accent colors */
--accent-violet: #A78BFA;   /* primary — active tool, focus ring, drag handle */
--accent-mint: #86EFAC;     /* save / success actions */
--accent-cream: #F5E8A6;    /* default highlighter color, warm highlight */

/* Text */
--text-primary: #F5F5F7;
--text-muted: #8B8B93;

/* Radius */
--radius-panel: 28px;   /* outer toolbar container */
--radius-icon: 12px;    /* icon buttons */
--radius-pill: 999px;   /* action buttons, color swatches */

/* Motion */
--dur-morph: 180ms;
--ease-morph: cubic-bezier(0.2, 0.8, 0.2, 1); /* fast, not bouncy */
--stagger-row: 50ms;    /* delay between toolbar rows fading in on expand */
```

### Typography
- **Font family**: Manrope, Inter, or system-ui fallback
- **Weights**: 400 (body), 500 (labels/active state)
- **Base size**: 13px for toolbar labels, never below 11px
- **Tabular numerals** for countdown timer and size values

### Translucency
```css
background: var(--surface-translucent);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border: 1px solid var(--border-hairline);
```
Page content ghosts through the panel — this matters functionally, not just aesthetically, since the presenter needs to still see what's under the toolbar.

### Panel Structure

There is no separate collapsed circular button any more. `CapannShell` is one draggable panel with a header (title, optional Back, Close, mode actions) and a body. Annotate and Record are sibling views in that same shell, so they share position, header, and drag behavior.

The drag position is owned by `OverlayApp`, not the shell. Each view mounts a different `CapannShell`, so shell-local position state would be discarded on every view switch and snap the panel home. Holding it in the parent keeps the panel where the user put it across chooser → Annotate → Record; closing the panel clears it, and the next open docks top-right again.

**Annotate body** (`annotate-controls.tsx`):
1. **Main tools** (6-col grid): pencil, highlighter, arrow, rectangle, ellipse, text. Active tool gets `--accent-violet` at ~18% fill with a violet icon. Clicking the active tool turns draw mode off.
2. **Extra tools** (multi-col grid): select, laser, spotlight, eraser.
3. **Contextual options**, only when relevant: arrow head style (triangle / chevron / stick / bender) and shape fill toggle.
4. **Color swatches**: `#EF4444`, `#0A0A0C`, `#FACC15`, `#22C55E`, `#FFFFFF`, plus a custom color picker. Active swatch gets a ring in `--text-primary`.
5. **Size slider**: track `rgba(255,255,255,0.12)`, fill `--accent-violet`.
6. **Timer and mask chips** (owned by `OverlayApp`, not the controls): 5/10/15-minute countdown and Screen/Blackout/Whiteout cycling.
7. **Actions**: "Clear" (ghost, hairline border) and "Save PNG" (`--accent-mint` fill, dark text `#0A2E1B`).

**Annotate header actions**: Undo and Redo (muted when their stack is empty), plus Duplicate and Delete (trash) while an annotation is selected. All four share one 26px `HeaderIcon` button so their hover, disabled, and focus treatment cannot drift apart.

**Record body**: camera / microphone / tab-audio toggles (on by default when available), a Start action, an "Allow" affordance when a device still needs permission, and concise status or unavailable-device notices.

**Recording chip**: once capture starts, a separate host (`#capann-recording-host`) shows a left-edge pill with elapsed time, pause/resume, stop & save, and discard, plus the bottom-right camera preview. It is intentionally recorded; the annotation host stays hidden. The recorder streams small camera preview frames to the chip instead of compositing its own bubble.

**Motion**: rows stagger in on view change (`--stagger-row`); keep transitions fast and non-bouncy. The shell drags via its header background — buttons handle their own clicks.

## Build System

- **TypeScript**: Type-safe development
- **React 19**: UI component library for shell, controls, and overlay
- **esbuild**: Fast bundling with JSX automatic runtime (dev & production)
- Outputs to `dist/` directory
- Type checking via `tsc --noEmit` before bundling

Four entry points (five in the premium build), all bundled as IIFE targeting `chrome116`:

| Entry | Output |
|---|---|
| `src/background/service-worker.ts` | `dist/background/service-worker.js` |
| `src/content/overlay.tsx` | `dist/content/overlay.js` |
| `src/offscreen/recorder.ts` | `dist/offscreen/recorder.js` |
| `src/permissions/permissions.ts` | `dist/permissions/permissions.js` |
| `src/sidepanel/sidepanel.tsx` (premium) | `dist/sidepanel/sidepanel.js` |

`build.mjs` also writes the edition's manifest (see [Branch Strategy](#branch-strategy)) and copies `icons/`, `src/offscreen/offscreen.html` → `dist/offscreen.html`, `src/permissions/permissions.html` → `dist/permissions.html`, and in the premium build `src/sidepanel/sidepanel.html` → `dist/sidepanel.html`.

Do not switch the offscreen, permission, or side panel bundles to ESM: their HTML loads them as classic scripts so listeners register as soon as the document parses.

## Development Workflow

```bash
npm install          # Install dependencies
npm run build        # Type check + bundle to dist/ (edition from capann.config.json)
npm run build:free   # ...as the free edition
npm run build:premium # ...as the premium edition
npm run watch        # Auto-rebuild on file changes (also watch:free / watch:premium)
npm run typecheck    # Type check only
```

Load unpacked extension from `dist/` in Chrome (`chrome://extensions` → Developer Mode → Load unpacked). Reload the extension in `chrome://extensions` after each rebuild; then reload the target tab, since content scripts do not re-inject into open pages.

To exercise Premium locally, run the backend (`cd backend && npx wrangler dev --port 8799`) and build with `node scripts/build.mjs --edition=premium --api-url=http://127.0.0.1:8799 --site-url=http://localhost:5173`.

## Code Patterns & Conventions

- **Fusion discipline**: in `OverlayApp.tsx` and `service-worker.ts`, never replace a behavior belonging to one feature just because a new feature needs something similar. Rewire both paths — see [Fusion Code](#fusion-code-the-change-rule).
- **Tool System**: Drawing logic lives in `OverlayApp.tsx`; toolbar/controls only emit prop callbacks
- **State ownership**: `OverlayApp` owns annotations, tool, color, size, history, timer, mask, recording status, and the panel's drag position. `CapannShell` is controlled — it renders the position it is given so the panel survives chooser/Annotate/Record switches; closing the panel clears the position.
- **History-aware mutations**: route every edit to saved annotations through the shared commit path so undo/redo and persistence stay consistent. One completed gesture equals one history entry.
- **Transient state stays transient**: previews, selection frames, and drag state belong in React state or refs, never in the saved schema
- **Event handling**: pointer events captured on the top canvas, converted to annotation objects
- **Pointer discipline**: only capturing tools may set `pointer-events: auto`. Laser and spotlight must remain click-through.
- **Shadow DOM isolation**: all UI injected via shadow root to prevent CSS conflicts
- **Type safety**: strong typing for annotations, tools, recording status, and every message
- **Styling**: inline styles (no CSS framework) using the tokens above
- **React**: hooks at top level, complete dependency arrays, and cleanup of listeners, timers, and animation frames in effects

## Skills

- **react-js** (`.agents/skills/react-js/SKILL.md`, skill name `react-optimise-skill`): Always invoke this skill when writing, editing, reviewing, or debugging React code in this repo (`OverlayApp.tsx`, `shell.tsx`, `annotate-controls.tsx`, and any other `.tsx` component). Covers hook-rule violations, stale closures, missing `useEffect` cleanup, object/array identity bugs, unnecessary re-renders, and other React correctness/performance/quality checks to run before finalizing changes.

## Testing

- Playwright smoke test: `scripts/smoke-test.mjs`
- Loads the extension in a real Chromium instance
- Tests basic activation and tool interaction

Manual checks worth running for any non-trivial change:
1. `npm run typecheck && npm run build`
2. Annotate: draw each tool, undo/redo, reload the tab and confirm persistence, then Save PNG. In the saved image every object appears exactly once and the Capann panel is not visible.
3. Record: start with all inputs; confirm the annotation overlay/panel is absent from the video, the chip is visible with a live timer, pause/resume/stop/discard work from the chip, and the camera preview sits at the bottom right.
4. Record with camera/mic denied: confirm recording still starts and the unavailable notice appears

## Implemented Features

- Undo/redo with a 50-state cap, plus duplicate and delete
- Select tool with move and resize handles
- Bender (curved) arrow connectors and arrow head styles
- Comment-style text bubbles with in-place editing
- Custom color picker alongside the core palette
- Countdown timer (5/10/15) and Screen/Blackout/Whiteout mask
- In-page Record / Annotate chooser in a shared draggable shell
- Tab recording to local WebM with a bottom-right camera bubble, mic, tab audio, and an in-page recording chip
- Premium: email sign-in, upgrade, upload-to-link with auto-copy, "Save a copy?" choice, and a links side panel
- One-time camera/microphone grant page
- PNG export composited with annotations

## Premium Backend

`backend/` is a standalone Cloudflare Worker (TypeScript, Wrangler) with its own
`package.json`, `tsconfig.json`, and tests. The extension's `tsconfig.json` and
`build.mjs` only cover `src/`, so the two never build together.

- **Identity**: no accounts. A user is an email address proven by short-lived HS256 tokens
  with a purpose claim (`login`, `links`, `session`, `upload`); each route accepts only its purposes.
- **State**: KV `sub:<email>` (written only by the Bachs webhook), R2 `recordings/<uuid>.<ext>`
  plus an `owners/<sha256(email)>/` index, and a `RateLimiter` Durable Object for
  rate limits (3 emails per address, 10 per IP, per 15 min) and single-use login links.
- **Retention**: R2 lifecycle deletes both prefixes after 7 days (`backend/r2-lifecycle.json`);
  the Worker also refuses anything older than 7 days, because lifecycle deletion lags.
- **Uploads re-check KV**, not the session's `paid` claim, which can be 30 days stale.
- **Clients**: the extension side is built (see below); the website's `/verify` and
  `/view-my-links` are not.
- **Bachs' webhook format is unverified.** It is isolated in `backend/src/bachs.ts`; confirm
  it against Bachs' documentation before launch.
- Run `npm run typecheck` and the e2e suite (`backend/README.md`) after backend changes.
  Any change to a route's request or response shape must be made in the extension and
  website clients too.

## Premium Share Links

The extension half of Premium (premium build only; everything is behind `PREMIUM_ENABLED`).

- **Who holds what.** The session token lives in `chrome.storage.local` and is
  used only by the service worker, the side panel, and (passed in the stop
  command) the offscreen document, which has no `chrome.storage`. The page gets
  an `AccountSummary` without the token. API calls never come from the content
  script: it is not CORS-exempt.
- **Sign-in.** Record view → `premium-sign-in` → magic link → the website's
  `/verify` exchanges the token and sends `{ kind: "capann-session", token }`
  via `chrome.runtime.sendMessage(extensionId, …)`. The worker accepts it only
  from `siteUrl` and confirms the token with `GET /api/auth/session` before
  storing it.
- **Paid check.** The stop uses the cached `paid` claim; the server re-checks on
  upload. A 402 falls back to a local save and marks the session unpaid; a 401
  signs out. The Record view re-checks `paid` when it opens and on window focus,
  which is how an upgrade made in the checkout tab appears.
- **Stop → share.** `sendRecorderCommand("stop")` adds `share: { token,
  copyPreference }`. `finalize()` then sends the terminal `sharing` status and
  starts a job in `offscreen/share.ts`. A recording that ends on its own (tab
  closed) has no stop command and is saved locally.
- **Share jobs** live in the offscreen document, not the worker: the worker can
  be stopped after ~30 s idle, shorter than a presenter may take to answer "Save
  a copy?". Each job publishes `ShareJobStatus` with its own `tabId`; the
  worker relays it to the tab and saves the link to history.
- **Never lose a recording.** A failed upload saves the local copy whatever was
  chosen. The Blob is released only after the upload succeeded or the copy
  reached Downloads. Start is disabled ("Finishing your link…") until then.
- **Clipboard.** The page copies the link with `navigator.clipboard` as soon as
  it exists. That needs the tab focused; otherwise the card shows a Copy button.
  There is no `clipboardWrite` permission on purpose (it adds an install warning).
- **Side panel.** `premium-open-links` calls `sidePanel.open()` synchronously in
  the message handler (it needs the click's user gesture) and falls back to
  opening `sidepanel.html` in a tab.

## Explicitly Out of Scope

- **Screen or window recording.** Would require an explicit source picker and `desktopCapture.chooseDesktopMedia` from a visible extension page, since the service worker needs a `targetTab` and that stream cannot be consumed by an offscreen document. Do not implement unless asked directly.
- **Uploading or sharing recordings in the free tier.** Free recordings stay local; cloud links are Premium only, through `backend/`.
- **`clipboardWrite` permission.** Auto-copy uses the page's clipboard and falls back to a Copy button; the permission would add an install warning.

## Future Considerations

- **Persistent storage option** (`chrome.storage.local`) for annotations that survive browser restart
- **More shape types** (lines, polygons, freeform paths)
- **Cursor spotlight (auto)**: Soft radial dim-and-glow that follows the mouse automatically, no click needed. Distinct from the manual laser pointer — this stays on the whole time and quietly draws the eye, useful for dense screens (spreadsheets, code) where you're not actively drawing.
- **Click-ripple**: Brief ring animation on every click, so remote viewers see exactly where you clicked, not just where the cursor drifted.
- **Snap-to-shape**: A rough freehand circle/rectangle straightens into a clean one on release. Cheap to build, disproportionately raises perceived polish.
- **Export as short GIF** (not just PNG): Captures the annotation sequence (not just the end state), useful for async follow-ups ("here's what I pointed out, review on your own time").
- **Touch/stylus optimization**: Pressure sensitivity and palm rejection
- **Collaborative annotation**: Multi-user annotations via WebRTC or extension messaging
