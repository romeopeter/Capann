# Learn Capann

This handbook explains how Capann is put together and how to make changes that fit its existing design and behavior.

## Start here

- [Architecture](architecture.md) — extension entrypoints, overlay, and storage.
- [Annotations](annotations.md) — annotation types, drawing, hit testing, selection, and history.
- [Making changes](making-changes.md) — a practical workflow for extending the project and keeping these notes current.

## Working principles

Keep annotation data serializable and independent of the page DOM. Keep drawing and selection on the canvases, toolbar UI inside its Shadow DOM, and visual styling aligned with the tokens documented in the project `AGENTS.md`. Route persistent edits through the app's history-aware mutation path.
