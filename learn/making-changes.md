# Making changes

## A safe workflow

1. Read the relevant component and follow the data from toolbar input through canvas rendering and storage.
2. Reuse the shared types, geometry helpers, design tokens, and state ownership already in the project.
3. Keep page interaction in mind: the overlay should capture pointers only while the active tool needs them.
4. For edits to saved annotations, use the history-aware mutation path and verify undo/redo and reload behavior.
5. Update this handbook when a change alters architecture, annotation behavior, storage, or the contributor workflow.
6. Run `npm run typecheck` and `npm run build` before handing off the change.

For backend changes (`backend/`), follow the rules in [Premium backend](backend.md#rules-when-changing-the-backend), run `npm run typecheck` and the end-to-end suite inside `backend/`, and treat any change to a request or response shape as a contract change: update the extension and website clients and `backend/README.md` together. The extension's client is `src/shared/premium/api.ts` and `src/offscreen/uploader.ts`; `node scripts/premium-e2e.mjs` runs them against `wrangler dev`.

For Premium extension changes, read [Premium share links](premium.md) first. Gate on `PREMIUM_ENABLED`, keep API calls out of the content script, keep the token out of the page, and preserve "never lose a recording": the offscreen document closes only when no share job needs it, and a failed upload always saves the file. Build both editions and confirm the free build's manifest is unchanged.

For recording changes, also update [Recording](recording.md). Check all three typed message boundaries (content script, service worker, and offscreen document), preserve tab-specific capture invocation, and ensure capture errors do not result in a download.

## Adding an annotation behavior

Update the annotation types first, then implement rendering and geometry/hit testing, wire pointer handling in `OverlayApp.tsx`, and add any toolbar control in `annotate-controls.tsx`. Put mode-level actions (undo/redo, duplicate) in the shell header via `CapannShell`'s `actions` slot rather than in the controls body. Verify saved data can be redrawn and exported. Keep pointer-drag previews temporary and group a completed gesture into one history action.

## Design and React conventions

Use the dark translucent toolbar surfaces, hairline borders, violet active state, and established spacing/motion values from `AGENTS.md`. Keep hooks at component top level, include all reactive dependencies, and clean up listeners, timers, and animation frames in effects.
