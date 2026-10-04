# Capann

Browser extension for screen recording and annotation.

## Features

- **Pencil** — freehand strokes, full color palette + custom color picker, adjustable size.
- **Highlighter** — translucent broad strokes in preset highlighter colors.
- **Arrow pointer** — drag to draw an arrow; adjustable size and head style (triangle / chevron / stick).
- **Shapes** — rectangle and ellipse, with an optional filled style.
- **Text** — click to drop a text callout in the current color/size.
- **Laser pointer** — a fading trail that follows your cursor without blocking clicks on the page underneath.
- **Spotlight** — dims everything except a soft circle around your cursor, without blocking clicks.
- **Eraser** — click any mark to remove just that object.
- Per-tab persistence: annotations survive tab switches and reloads until you hit Clear.
- **Save PNG** — captures the visible tab composited with your annotations and downloads it.

## Activation and workflows

- Click the extension action, or press **Alt+Shift+S**, to open the in-page Record / Annotate chooser on the active tab.
- **Annotate** opens the floating toolbar and canvas tools. **Alt+Shift+T** cycles tools and **Alt+Shift+C** clears annotations.
- **Record** captures the current tab, with optional camera, microphone, and tab audio. The overlay and annotations are hidden from the recording.
- While recording, the Chrome action badge shows status. Click the action to stop and save; **Alt+Shift+T** pauses/resumes and **Alt+Shift+C** discards.
- Chrome-protected pages such as `chrome://` cannot be annotated or recorded.

## Project layout

```
manifest.json           Extension manifest (copied as-is into dist/)
icons/                  Generated toolbar icons (source; scripts/gen-icons.js regenerates them)
src/background/         Service worker: action/shortcut handling, tab capture, downloads
src/content/             Content script: in-page chooser, overlay canvases, toolbar, drawing tools
src/offscreen/           Offscreen recorder: tab/camera composition, audio, local WebM
src/shared/types.ts      Shared types + extension message contracts
scripts/build.mjs        esbuild bundler -> dist/
scripts/gen-icons.js     Regenerates icons/*.png (no external deps)
scripts/smoke-test.mjs   Playwright smoke test that loads the built extension in real Chromium
```

## Build

```
npm install
npm run build      # typechecks then bundles into dist/
```

Load `dist/` as an unpacked extension: `chrome://extensions` → enable Developer
Mode → **Load unpacked** → select the `dist` folder.

`npm run watch` rebuilds on change (reload the extension in `chrome://extensions`
after each rebuild).

## Notes

- Requires `<all_urls>` host permission so annotations and PNG capture work on
  whatever app you're presenting (Meet, Zoom Web, Slides, internal dashboards, etc).
- Annotations are stored in `chrome.storage.session`, keyed per tab, so they
clear automatically when the browser session ends, and immediately on Clear.

## Learning the codebase

See [`learn/README.md`](learn/README.md) for the architecture, annotation data flow, and a guide to extending Capann.
