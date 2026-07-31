# ScreenSlate

A browser extension for annotating anything on screen while presenting — pencil,
highlighter, arrow pointer, shapes, text callouts, and a laser/spotlight pointer,
built for pointing out key details during screen-shares in meetings,
brainstorms, and standups.

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

## Activation

- Click the extension's toolbar icon, or press **Alt+Shift+S**, to toggle draw mode on the active tab.
- **Alt+Shift+T** cycles to the next tool; **Alt+Shift+C** clears all annotations on the tab.
- **Esc** exits draw mode (annotations are kept).
- The floating panel can be dragged by its handle to keep it out of the way.

## Project layout

```
manifest.json           Extension manifest (copied as-is into dist/)
icons/                  Generated toolbar icons (source; scripts/gen-icons.js regenerates them)
src/background/         Service worker: icon/shortcut handling, tab screenshot capture, downloads
src/content/             Content script: overlay canvases, floating toolbar, drawing tools
src/shared/types.ts      Shared types + message contracts between content script and service worker
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
