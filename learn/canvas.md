# Canvas and memory

Capann draws every annotation on HTML canvases. This note explains what a canvas
costs, why Capann sizes its canvases the way it does, and what that rules out.
Read it before changing canvas sizes, adding a canvas, or touching how
annotations are positioned.

## A canvas is a bitmap, not a scene

Capann stores annotations as **vector data**: a stroke is a list of points, a
rectangle is two corners, a comment is an anchor plus text (see
`src/shared/types.ts`). A few dozen annotations take a few kilobytes.

A canvas is the opposite. It is a **raster bitmap**: a fixed grid of pixels that
the browser allocates in full when you set `canvas.width` and `canvas.height`,
whether anything is drawn on it or not. It has no memory of *what* was drawn —
only the resulting pixel colors. That is why Capann redraws from the vector
list (`redrawAll` in `render.ts`) instead of trying to edit pixels: the list is
the source of truth, the canvas is a disposable rendering of it.

## The cost formula

Each pixel is RGBA, one byte per channel:

```
bytes = (cssWidth × dpr) × (cssHeight × dpr) × 4
      = cssWidth × cssHeight × dpr² × 4
```

`dpr` is `window.devicePixelRatio`. Capann multiplies the backing store by it in
`resizeCanvases` (`OverlayApp.tsx`) and then `setTransform(dpr, …)` so drawing
code keeps working in CSS pixels. Without that, lines would look blurry on
Retina and 4K screens. The price is that **memory grows with the square of
`dpr`**: a 2× display costs four times as much as a 1× display for the same
window.

| Canvas | Backing pixels | Memory |
|---|---|---|
| Viewport 1440×900 at 1× | 1440 × 900 | ≈ 5 MB |
| Viewport 1440×900 at 2× | 2880 × 1800 | ≈ 21 MB |
| Viewport 2560×1440 at 2× | 5120 × 2880 | ≈ 59 MB |
| Whole page 1440×10 000 at 2× | 2880 × 20 000 | ≈ 230 MB |
| Whole page 1440×30 000 at 2× | 2880 × 60 000 | ≈ 690 MB — over the limit below |

Two practical multipliers on top of that:

- **Capann has two stacked canvases** (objects + live input), so the overlay
  costs twice the table value.
- **Canvases are usually GPU-backed.** Chrome keeps the bitmap in GPU memory for
  fast compositing, sometimes with a CPU copy as well. GPU memory is shared with
  the page itself and with video decoding, and running out degrades the whole
  tab, not just Capann.

## Hard limits

Chrome refuses canvases beyond roughly **32 767 px on a side** or about
**268 million pixels** in area (it varies by platform and GPU). Past that, the
canvas does not throw — `getContext` returns a context that silently draws
nothing. A failure like that is easy to miss in testing on a short page and only
appears on a long one.

## Why Capann's canvases are viewport-sized

Because of the numbers above, both overlay canvases are `position: fixed` and
exactly the size of the viewport. Their cost is bounded by the screen, not by
the page: a 200-page document costs the same as a landing page.

The alternative — one canvas the size of the whole document, scrolled with the
page — is the obvious way to make drawings move with the page, and it is the
wrong one: memory scales with page length, long pages cross the hard limit, and
every resize reallocates the whole thing.

The rule: **canvas size follows the viewport; annotation data carries
position.** Anything that needs to move with the page (scrolling, panning) does
it by changing *where* the vector data is drawn, not by making the bitmap bigger.

## How scrolling works

Annotations move with the page without the canvases growing. The pieces live in
`src/content/page-space.ts`:

1. **Store page coordinates.** Every pointer position goes through
   `pagePoint(clientX, clientY)`, which adds `window.scrollX/Y`. An arrow drawn
   300px down a page scrolled by 1000px is stored at `y = 1300`. Geometry, hit
   testing, history, and storage all work in this one space.
2. **Draw through a transform.** `setPageTransform(ctx)` sets
   `scale(dpr)` plus a translation of `-scroll × dpr`. Drawing code is unchanged
   — it draws at page coordinates and the transform maps them onto the
   viewport-sized bitmap. Points scrolled out of view simply land outside the
   bitmap and are clipped for free.
3. **Redraw on scroll.** A passive `scroll` listener in `OverlayApp` updates both
   layers' transforms and redraws from the object list. Chrome dispatches scroll
   at most once per frame, and redrawing a few dozen vector objects is far
   cheaper than a frame, so it runs synchronously with no extra rAF.
4. **Clear the bitmap, not a rectangle.** With a translated transform,
   `clearRect(0, 0, w, h)` would clear the wrong region. `clearCanvas(ctx)`
   resets to the identity transform and clears every pixel.

Some things stay in screen space on purpose: the laser trail and spotlight
(`setScreenTransform`), the screen mask, and the panel. The comment composer is a
`position: fixed` DOM element, so it is repositioned (layout in page
coordinates, minus scroll) on every scroll.

**Comment placement.** Auto-placed comment bubbles used to flip and clamp to the
visible screen. That would make them jump as the page scrolls, so committed
comments are now placed against the page (`pageViewport()`: page width,
unbounded below). A *new* comment's composer is still placed inside the visible
area so it never opens off-screen; if that differs from the page placement (the
click was near a screen edge), the bubble is pinned (`TextAnnotation.bubble`) at
the spot the user saw when it is committed.

**PNG export** captures only the visible viewport, so `savePng` applies the
same `setPageTransform` before drawing annotations onto the screenshot.

### Limits

- **Only window scrolling is tracked.** Apps that scroll an inner element
  (Gmail, Notion, Google Slides, many dashboards) leave `window.scrollY` at 0,
  so annotations there stay fixed to the screen as before.
- **Sticky and fixed page elements** (headers, sidebars) do not scroll, but
  annotations drawn on them do.
- **Reflow** (resizing, lazy-loaded content, expanding sections) moves page
  content but not annotations. Anchoring to DOM elements would fix that at a
  much higher cost.
- **During a drag**, a scroll clears the live preview; it comes back on the
  next pointer move, from the stored points.

## Other canvases in Capann

| Canvas | Where | Size | Lifetime |
|---|---|---|---|
| Objects canvas | `OverlayApp.tsx` | viewport × dpr | while the overlay is mounted |
| Live canvas | `OverlayApp.tsx` | viewport × dpr | while the overlay is mounted |
| PNG composite | `savePng` | viewport × dpr | one export, then garbage-collected |
| Recording compositor | `recorder.ts` | captured tab video size (no dpr factor) | one recording |
| Camera preview | `recorder.ts` | 480 × 270 | one recording |

The PNG composite and the recorder canvases are short-lived and sized to what
they output, so they do not accumulate.

## Guidelines when changing canvas code

- **Size to what is visible.** Never size a canvas from `document.scrollHeight`
  or similar page-length values.
- **Resize, don't add.** Setting `width`/`height` reallocates and clears the
  bitmap; that is fine on window resize, but do not do it per frame.
- **Redraw from data.** Clearing and redrawing a few dozen vector objects is
  cheap (well under a frame). Caching pixels to avoid it usually costs more
  memory than it saves time.
- **Count canvases.** Each additional full-viewport canvas adds another
  `viewport × dpr² × 4` bytes. Prefer drawing on an existing layer.
- **Release temporaries.** Short-lived canvases (exports) should go out of scope
  after use; setting `width = 0` frees the bitmap immediately if one must
  outlive its use.
