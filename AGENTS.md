# ScreenSlate - Project Context

## Overview

ScreenSlate is a Chrome browser extension that provides screen annotation tools for use during presentations, screen sharing, meetings, and demos. It allows users to draw, highlight, point, and annotate directly over any web page without modifying the underlying content.

## Core Features

- **Pencil Tool**: Freehand drawing with full color palette and adjustable size
- **Highlighter**: Translucent broad strokes in preset colors
- **Arrow Pointer**: Drag-to-draw arrows with adjustable size and head styles (triangle/chevron/stick)
- **Shapes**: Rectangle and ellipse tools with optional fill
- **Text Callouts**: Click to place text annotations
- **Laser Pointer**: Fading cursor trail that doesn't block page interaction
- **Spotlight**: Dims everything except cursor area without blocking clicks
- **Eraser**: Remove individual annotations
- **PNG Export**: Capture tab with annotations composited
- **Per-tab Persistence**: Annotations survive tab switches and reloads until cleared

## Keyboard Shortcuts

- `Alt+Shift+S`: Toggle annotation mode
- `Alt+Shift+T`: Cycle to next tool
- `Alt+Shift+C`: Clear all annotations on current tab
- `Esc`: Exit annotation mode (keeps annotations)

## Architecture

### Extension Structure

```
manifest.json              Chrome extension manifest (Manifest V3)
src/background/            Service worker for extension lifecycle
  service-worker.ts        Icon/shortcut handling, screenshots, downloads
src/content/               Content script injected into tabs
  overlay.ts              Main overlay controller, canvas setup, event handling
  toolbar.ts              Floating toolbar UI
  render.ts               Canvas rendering for all annotation types
  geometry.ts             Geometric calculations for shapes and arrows
  icons.ts                SVG icons for toolbar buttons
src/shared/
  types.ts                Shared TypeScript types and message contracts
scripts/
  build.mjs               esbuild bundler (TypeScript → JavaScript)
  gen-icons.js            Icon generator script
  smoke-test.mjs          Playwright automated testing
```

### Key Technical Details

**Manifest V3**: Uses service worker background script (not persistent background page)

**Canvas Architecture**:
- Two overlapping HTML5 canvas elements injected into each tab
- Bottom canvas: persisted annotations
- Top canvas: current stroke/shape being drawn
- Pointer-events toggled to allow interaction with underlying page when not drawing

**Storage**:
- `chrome.storage.session`: Per-tab annotation data (cleared on browser close)
- Keyed by tab ID for isolation between tabs

**Message Passing**:
- Content script ↔ service worker communication via Chrome extension messages
- Used for screenshot capture and download functionality

**Permissions**:
- `<all_urls>`: Required for annotations on any site during presentations
- `storage`: For session storage of annotations
- `activeTab`: For screenshot capture
- `downloads`: For PNG export

## Build System

- **TypeScript**: Type-safe development
- **esbuild**: Fast bundling (dev & production)
- Outputs to `dist/` directory
- Type checking via `tsc --noEmit` before bundling

## Development Workflow

```bash
npm install          # Install dependencies
npm run build        # Type check + bundle to dist/
npm run watch        # Auto-rebuild on file changes
npm run typecheck    # Type check only
```

Load unpacked extension from `dist/` folder in Chrome.

## Code Patterns & Conventions

- **Tool System**: Each annotation tool implements drawing logic in overlay.ts
- **State Management**: Tool state, color, size stored in content script scope
- **Event Handling**: Mouse events captured on canvas, converted to annotation objects
- **Rendering**: Annotation objects serialized and re-rendered from storage on load
- **Type Safety**: Strong typing for annotation objects, tool types, messages

## Important Notes

- Annotations don't modify page DOM - purely canvas-based overlay
- Works across page navigations within same tab (content script persistence)
- Floating toolbar draggable to avoid obscuring content
- All annotation data ephemeral (session storage only)
- No external dependencies in runtime code (only build tooling)

## Testing

- Playwright smoke test: `scripts/smoke-test.mjs`
- Loads extension in real Chromium instance
- Tests basic activation and tool interaction

## Future Considerations

- Persistent storage option (chrome.storage.local)
- Undo/redo functionality
- More shape types (lines, polygons)
- Touch/stylus support optimization
- Collaborative annotation features
