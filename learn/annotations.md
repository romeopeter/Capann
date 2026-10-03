# Annotation data and rendering

Annotations are plain objects described by the `AnnotationObject` union in `src/shared/types.ts`. Pencil and highlighter marks contain point arrays; arrows and shapes contain start/end points; text annotations contain a position and text. The same data is serialized to session storage and used for drawing, export, hit testing, and editing.

## Drawing and editing flow

The content canvas receives pointer events while a capturing tool is active. Pointer movement updates transient preview state on the top canvas. Pointer release creates a complete annotation and commits it to the object list. The bottom canvas is redrawn from that list.

The Select tool hit-tests from the topmost annotation down. Selection itself is temporary UI state. Moving an annotation translates its stored points or coordinates; resizing a rectangle or ellipse updates its bounds. The resulting object list is committed once per completed drag so one undo restores the state before the drag. Selection frames and handles are drawn on the top canvas and are excluded from PNG export.

## History and storage

Use the shared commit flow for completed edits so undo/redo and per-tab persistence stay consistent. Keep transient gesture state in React state or refs rather than adding selection handles or drag previews to the saved annotation schema. When changing the schema, account for existing stored annotations and screenshot rendering.

## Hit testing

`geometry.ts` provides reusable hit tests and bounds. Keep selection behavior distinct from eraser behavior where their intent differs: selecting an outlined shape should be possible from its interior, while erasing an unfilled shape should continue to target its visible outline.
