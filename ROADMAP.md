# MathCanvas development roadmap

This roadmap continues the earlier MathCanvas direction: an affordable, math-first canvas for handwritten work, diagrams, PDFs, graphs, equations, and science workflows. Build on the native Canvas 2D renderer rather than copying proprietary canvas-editor code.

## Foundation pass completed in 0.4.7

- Reliable multi-object marquee selection with group move, delete, keyboard nudging, copy/paste, layer order, and locking.
- Line formatting toolbar with color, thickness, dash patterns, and arrowheads.
- Page-local white-mask erasing for rasterized PDF pages, kept with the page through movement, resize, save, and PNG export.


## Progress in 0.4.8

- **Document durability:** latest web autosave is stored in IndexedDB instead of relying on localStorage capacity; the desktop filesystem autosave remains primary in Electron. Up to five versioned/time-spaced recovery snapshots are retained, with a Recovery UI to inspect timestamps and restore a snapshot. The snapshots store the current project envelope and are bounded by count to limit storage growth.
- **Page navigation:** newly imported PDFs keep a document ID, title, page number, and page count. The right-sidebar PDF pages navigator displays thumbnails and jumps the viewport to the selected page.
- **Multi-select input:** Shift/Ctrl/Cmd-click toggles individual objects; modifier-drag on blank canvas adds to an existing selection.

## Next priorities

1. **Page workflows:** page grouping and predictable page reorder/move behavior, plus importing multiple PDFs without mixed page sets.
2. **Math workspace:** stronger CAS evaluation and structured equation entry, with readable rendered mathematics instead of plain-text equation previews.
4. **Input quality:** stylus pressure and tilt where supported, smoother low-latency strokes, and configurable pen/eraser cursor behavior.
5. **Object editing:** lasso selection, transform handles for multi-selection, rotation, duplicate-by-drag, line opacity, and better keyboard-accessible controls.
6. **Reliability:** automated tests for pointer gestures, clipboard paths, document migration, autosave recovery, and export rendering.

Existing graph modes, the protractor, chemistry/physics utilities, calculator, and the hold-D drawing input should be stabilized and extended rather than rewritten without a reason.
