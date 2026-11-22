# Annotation data and rendering

Annotations are plain objects described by the `AnnotationObject` union in `src/shared/types.ts`. Pencil and highlighter marks contain point arrays; arrows and shapes contain start/end points; comments (`text`) contain the point their tail aims at and the note's text; free text (`freetext`) contains a top-left position, the text, a font size, and a font. The same data is serialized to session storage and used for drawing, export, hit testing, and editing. All positions are **page coordinates** (CSS pixels from the document's top-left), so annotations scroll with the page; see [Canvas and memory](canvas.md#how-scrolling-works).

## Drawing and editing flow

The content canvas receives pointer events while a capturing tool is active. Convert every pointer position with `pagePoint` before using it. Pointer movement updates transient preview state on the top canvas. Pointer release creates a complete annotation and commits it to the object list. The bottom canvas is redrawn from that list.

The Select tool hit-tests from the topmost annotation down. Selection itself is temporary UI state. Moving an annotation translates its stored points or coordinates; resizing a rectangle or ellipse updates its bounds. The resulting object list is committed once per completed drag so one undo restores the state before the drag. Selection frames and handles are drawn on the top canvas and are excluded from PNG export.

## Comments and free text

Two tools write words, and they are deliberately separate types:

| | Comment (tool `text`, type `text`) | Text (tool `write`, type `freetext`) |
|---|---|---|
| Looks like | A dark bubble with a tail | The words themselves, in the chosen color |
| Layout | Wraps inside a 140–280px bubble (`text-bubble.ts`) | Lines exactly as typed, no wrapping (`free-text.ts`) |
| Font | Fixed UI font | Sans, Serif, Mono, or Hand (system stacks; nothing is downloaded) |
| Resize | Corners scale the font; side edges change the wrap width | Every handle scales the font, keeping proportions |

Both use a DOM composer for typing and the same layout function for the canvas, so nothing moves on commit. Both commit on `Enter` or click-away, add a line on `Shift+Enter`, cancel on `Esc`, and delete an existing item when emptied (undoable). Only one composer is open at a time; `commitTextInput` flushes whichever it is.

Free text is the one type whose color and font change after it is made: with a text selected, the palette, Font row, and size slider restyle it (each change is one undo step). Other types keep their color, as before.

The zoom lens is not an annotation: it draws only on the live canvas and stores nothing (see [Canvas and memory](canvas.md#other-canvases-in-capann)).

## History and storage

Use the shared commit flow for completed edits so undo/redo and per-tab persistence stay consistent. Keep transient gesture state in React state or refs rather than adding selection handles or drag previews to the saved annotation schema. When changing the schema, account for existing stored annotations and screenshot rendering.

A screenshot being edited has its own document: `OverlayApp` parks the page's objects and history and swaps the screenshot's in, so every tool and undo/redo works on it unchanged. A parked state is never persisted. See [Screenshots](screenshot.md).

## Hit testing

`geometry.ts` provides reusable hit tests and bounds. Keep selection behavior distinct from eraser behavior where their intent differs: selecting an outlined shape should be possible from its interior, while erasing an unfilled shape should continue to target its visible outline.
