# Making changes

## A safe workflow

1. Read the relevant component and follow the data from toolbar input through canvas rendering and storage.
2. Reuse the shared types, geometry helpers, design tokens, and state ownership already in the project.
3. Keep page interaction in mind: the overlay should capture pointers only while the active tool needs them.
4. For edits to saved annotations, use the history-aware mutation path and verify undo/redo and reload behavior.
5. Update this handbook when a change alters architecture, annotation behavior, storage, or the contributor workflow.
6. Run `npm run typecheck` and `npm run build` before handing off the change.

For backend changes (`apps/api/`), follow the rules in [Premium backend](backend.md#rules-when-changing-the-backend), run `npm run typecheck` (every workspace) and `npm run api:test`, and treat any change to a request or response shape as a contract change: change `@capann/contract` first, then the API, the extension, and the website until `npm run typecheck` passes, then `apps/api/README.md`. The extension's client is `@capann/api-client` plus `src/offscreen/uploader.ts`; `npm run test:premium` runs them against `wrangler dev`.

**Where new code goes.** Code that only one app runs stays in that app (`apps/extension` or `apps/api`). Put it in `packages/` only when two sides must agree on it: shapes, codes, routes, or limits go in `@capann/contract` (types and constants, no imports, no DOM/chrome/Workers types); browser-side API calls go in `@capann/api-client`. Never move server-only logic (secrets, signing, storage) into a package a client imports.

For Premium extension changes, read [Premium share links](premium.md) first. Gate on `PREMIUM_ENABLED`, keep API calls out of the content script, keep the token out of the page, and preserve "never lose a recording": the offscreen document closes only when no share job needs it, and a failed upload always saves the file. Build both editions and confirm the free build's manifest is unchanged.

Any new feature that captures the tab's pixels must call `captureTab` in `OverlayApp.tsx`, never `capture-visible-tab` directly: it hides the overlay first, restores it to what the recorder wants, and serializes captures. Any new path that writes or persists `objects` must respect a parked page document while a screenshot is edited (see [Screenshots](screenshot.md)).

For recording changes, also update [Recording](recording.md). Check all three typed message boundaries (content script, service worker, and offscreen document), preserve tab-specific capture invocation, and ensure capture errors do not result in a download.

## Adding an annotation behavior

Update the annotation types first, then implement rendering and geometry/hit testing, wire pointer handling in `OverlayApp.tsx`, and add any toolbar control in `annotate-controls.tsx`. Put mode-level actions (undo/redo, duplicate) in the shell header via `CapannShell`'s `actions` slot rather than in the controls body. Verify saved data can be redrawn and exported. Keep pointer-drag previews temporary and group a completed gesture into one history action.

## Design and React conventions

Use the dark translucent toolbar surfaces, hairline borders, violet active state, and established spacing/motion values from `AGENTS.md`. Keep hooks at component top level, include all reactive dependencies, and clean up listeners, timers, and animation frames in effects.
