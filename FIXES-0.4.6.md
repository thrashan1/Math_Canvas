# MathCanvas 0.4.6 canvas tools and styling

## Live pen preview
- Canvas interaction updates paint draft strokes synchronously so ink is visible during a stroke, not only after release.
- The same live preview path is used by regular pointer strokes and D-held drawing.

## Selection
- Dragging from an empty spot with Select draws a marquee rectangle and selects an intersecting unlocked item on release.
- Removed the redundant canvas-level blue selection outline. Shape selections use the shape's border color for the bounding outline.

## Shapes
- Added rectangle, rounded rectangle, ellipse/circle, triangle, diamond, parallelogram, pentagon, hexagon, star, and arrow.
- Shape toolbar appears at the top of the canvas when the Shape tool is selected or a shape is selected.
- Border enable, border color, border width, fill enable, and fill color are configurable.
- New shapes default to a visible dark border and no fill, rather than the old blue translucent fill.

## Text
- One click with the Text tool creates and focuses a single-line text input immediately.
- Enter finishes editing. The text has no visible outline or white background by default.
- Text color, size, optional background fill, and fill color are available in the top canvas toolbar.
- Text placement uses the exact pointer position instead of grid snapping.
- The canvas renderer hides the text item while its transparent editing input is active, preventing double-rendered characters.

## Validation status
- TypeScript/JSX transpilation syntax checks passed for `src/canvas.tsx` and `src/App.tsx`.
- A full typecheck/build could not be completed because dependency installation stalled; the local environment still lacks Vite's type definitions. Test the app after `npm install` using `npm run web:build` and `npm run dev`.
