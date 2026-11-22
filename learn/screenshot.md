# Screenshots

The Screenshot workflow turns part of a page into a framed, annotated PNG. It
reuses the annotation tools unchanged: the same canvases, pointer handling,
selection, and history draw on a frozen image instead of the live page. Two
mechanisms make that work, the image space and the document swap. Both are
described below.

## The flow

```
Mark screen, Screenshot tool active
  select    ScreenshotSelector: drag a box (Enter / "Whole screen" = everything;
            Esc, Cancel, or clicking the tool again = turn the tool off)
  capturing captureTab(): overlay hidden, visible tab captured, overlay restored
  edit      ScreenshotStage under the canvases; tools draw in image space
  export    renderScreenshot(): frame + image + annotations at capture resolution → Copy / Save
Back: screenshot discarded, back to Mark screen with the page's annotations
  untouched and the tool and draw mode from before Screenshot was chosen
Close: screenshot discarded, Capann closed
```

Screenshot is an ordinary tool of Mark screen, but not a capturing one: while it
is active, `ScreenshotSelector` takes the pointer instead of the live canvas. The
panel stays where it is (its header names the tool and says "Drag over an area
to capture it"), and the selector sits under the annotation canvases, so marks
already on the page stay visible. Marks that
overlap the area are copied into the screenshot, moved into its coordinates,
and stay editable there. The page keeps its originals.

The capture goes through `captureTab` like every pixel capture (see the capture
invariant in `AGENTS.md`), so the selector, panel, and annotations are never in
the image. The selected area is cropped from the capture using the image's own
pixel ratio, so the export is as sharp as the screen.

## Image space

The editor shows the screenshot scaled to fit beside the panel, centered in a
dark backdrop. `page-space.ts` has one switch for this: `setImageSpace(space)`
makes `pagePoint` and `setPageTransform` map between the screen and the
screenshot's own CSS pixels instead of the page's. `OverlayApp` sets it in a
layout effect whenever the fit changes (the window resizes, the side panel opens,
the padding changes), then re-applies both canvas transforms and redraws.

Annotation coordinates are relative to the screenshot's top-left, so they stay
put when the frame changes. The composers follow through `screenPoint` and a
CSS `scale(spaceScale())`, and comment placement keeps bubbles inside the image.

## The document swap

`objects`, `past`, `future`, and the selection are the screenshot's while it is
open. The page's are parked in `parkedDocRef` by `enterScreenshotDoc` and put
back by `leaveScreenshot`. Consequences:

- Every tool, undo/redo, duplicate, delete, and `Alt+Shift+C` act on the screenshot.
- `scheduleSave` skips while a document is parked, so screenshot marks never reach
  the tab's `chrome.storage.session` entry.
- If the tab's stored annotations load while a screenshot is open, they go into
  the parked document, not the screenshot.

Laser, spotlight, and zoom are hidden on a screenshot (they present a live page),
and the timer/mask add-ons and the screen mask are hidden while it is open.

## The frame style

The frame is a preference, `capann_shot_style` in `chrome.storage.local`
(`shared/screenshot-style.ts`):

| Setting | Values |
|---|---|
| Background | 11 presets (soft solids, quiet gradients), a custom color, or none (transparent) |
| Padding | 0–160px around the image |
| Corners | 0–32px radius |
| Shadow | none / soft / strong |
| Border | none / thin (2px) / thick (6px), light or dark, outside the image |

The side panel's Screenshot tab edits it; the editor listens to
`storage.onChanged` and re-renders live. That is the only link between the two:
no messages, and the next screenshot starts with the same style.

One function, `drawFrame`, draws the background, shadow, rounded image, and
border for the editor preview, the export, and the side panel's preview. Lengths
are in the screenshot's CSS pixels, and canvas shadows (which ignore transforms)
are scaled by hand, so all three match. The editor adds two preview-only touches:
a checkerboard under a transparent background, and a hairline at the export's
edge so a dark frame reads against the dark backdrop.

## Copy and Save

Both render a fresh canvas at the capture's resolution. **Save** sends a PNG data
URL to the worker's `download-png`. **Copy** calls `navigator.clipboard.write`
inside the click, with a promise of the PNG, because the clipboard needs the
click's user activation; it is offered only on secure pages, where the
async clipboard exists.

## Side panel

The side panel ships in every build and is organised as tabs, so screenshot
styling never mixes with Premium's links:

| Tab | Build | File |
|---|---|---|
| Screenshot | every | `sidepanel/style-panel.tsx` |
| Links | premium | `sidepanel/links-panel.tsx` |

The free build has one tab and shows no tab bar. **Style** and **My links** both
go through `openSidePanel` in `background/side-panel.ts`, which notes the tab in
`chrome.storage.session` and opens the panel synchronously (it needs the click's
gesture). The panel follows that key while open.

**The Screenshot tab is gated.** Its controls appear only while the window's
active tab has a screenshot open; otherwise it shows "No screenshot open", even
when reached from the Links tab. `useScreenshotOpen` (style-panel.tsx) asks the
page with `screenshot-editing-query` when the panel opens and whenever the
active tab changes or reloads, and the page broadcasts `screenshot-editing`
when its editor opens or closes. The broadcast happens only on a change, so an
ordinary page load never wakes the service worker. Asking the page, rather than
storing a flag, means a reload, a crash, or a closed tab can't leave the
controls unlocked.
