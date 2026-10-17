# MathCanvas 0.4.4 engineering pass

This pass focuses on canvas interaction reliability rather than attempting to clone every feature of a commercial canvas SDK in one release.

## Fixed / added

- Live ink preview now renders a single-point tap as a dot while the pointer is down. Draft strokes use the same selected ink color and brush size as the committed stroke.
- Completed strokes use quadratic smoothing between sampled points. Pointer move handling continues to use coalesced pointer events when the browser supports them.
- Ink color is configurable with a native color picker and quick swatches. Brush size remains adjustable from 0.5 to 24 px, with presets.
- Holding D temporarily changes the effective interaction to draw. Releasing D restores the selected tool. If D is pressed while a pointer gesture is already down, drawing begins at the current pointer position.
- Ctrl/Cmd+V no longer hijacks the browser's native paste event. A paste event can import clipboard image files and can paste MathCanvas objects copied to the clipboard.
- Imported images and PDF page renders are movable by default. Existing projects are migrated in memory so page items are unlocked on open; users can lock them from the layer panel.
- Brush color is included in autosave/project metadata.

## Known limitations

This is not yet feature parity with tldraw. It is a native Canvas 2D renderer with a growing set of app-specific interactions. Further roadmap work should add pressure-aware variable-width strokes, lasso/multi-select, rotation handles, object duplication by Alt-drag, full clipboard image MIME coverage across browsers, selection transform handles, shape palette, arrows, fills, opacity, line dash controls, and robust automated pointer/clipboard tests.

Clipboard image access varies by browser and context. The browser paste event is the main path because reading clipboard contents directly is permission-gated; HTTPS or localhost is recommended for web testing.
