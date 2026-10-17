# Native canvas 0.4.0 engineering notes

This release removes tldraw from the interaction layer and keeps the project on its own canvas engine.

## Main interaction changes

- One HTML canvas owns normal item rendering and pointer hit testing.
- HTML is used only for text, equation, and table editing.
- Sidebars and object content can no longer steal pointer events from the canvas during normal drawing.
- Freehand input uses pointer coalescing and an animation-frame renderer instead of React state updates for every point.
- Brush size is 0.5 px to 24 px.
- Text size is 8 px to 72 px.
- Hold `D` to enter drawing mode and release it to restore the previous tool. The previous tool is stored in refs, so rerenders do not break the key pair.
- Middle mouse and `Space` pan.
- Ctrl + mouse wheel zooms the canvas around the cursor. The wheel listener is non-passive and prevents browser page zoom.
- Normal wheel/trackpad scrolling pans the canvas.
- Selection, dragging, resize, delete, undo, redo, layer order and locking remain document-level operations.
- Ctrl+C and Ctrl+V copy and paste canvas items with a small offset.
- Arrow keys nudge the selected item. Shift + arrows use the current grid spacing.
- Object erasing is committed once per erase gesture instead of once per pointer move.

## Validation

`npm run typecheck` passes on the source tree.

A production Vite build was not run in this environment because the supplied node_modules tree is missing Vite/Rolldown's platform native optional package. A fresh `npm install` on the target machine is required before the first web or Electron build.
