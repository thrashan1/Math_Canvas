# MathCanvas Native Canvas 0.4.1

Fixes for 0.4.0 blank-canvas and hold-D drawing issues.

## Important fixes
- Reworked HiDPI canvas setup so the backing canvas is scaled once and the background/scene are always painted in CSS-pixel coordinates.
- Removed CSS size containment that could make the canvas surface fail to size/render correctly in the web layout.
- The renderer now sanitizes invalid saved viewport values so old projects cannot produce a NaN transform.
- The canvas layer no longer captures pointer events. The workspace surface owns pointer input, preventing accidental interaction with rendered pixels or side content.
- Freehand drawing no longer snaps to the math grid. Grid snapping is kept for geometry and measurement tools.
- Hold `D` is handled directly by the canvas in capture phase using both `event.code === 'KeyD'` and the key value. It is independent of React tool-state timing.
- While `D` is held, the effective tool is drawing even if the toolbar still shows another tool. Releasing `D` immediately returns to the previous toolbar tool.
- `D` is ignored while typing in an input, textarea, math field, or modal.
- Pointer movement uses coalesced browser samples when available.
- The existing Ctrl+wheel canvas zoom remains local to the app and does not use browser page zoom.
