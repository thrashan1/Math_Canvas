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
- **First-use usability:** a first-run Getting started guide offers direct routes into a blank page, PDF/image annotation, and graphing. A persistent help button reopens canvas basics and shortcuts; the Workspace panel prioritizes common create-and-explore tasks.
- **Progressive feature disclosure:** Clean, Medium, and Maximum interface levels control which tool groups are visible, with the level selector at the beginning of Settings.
- **PDF page workflow:** pages are arranged and labeled by source document, retain their order in project files, and expose accessible move-earlier/move-later controls in the navigator. Canvas redraw is explicitly refreshed after sidebar layout changes.
- **Drawing controls and layout decision:** the floating tool rail is centered vertically. Holding Pen, Line, Shape, Text, or Eraser opens options centered on that tool and clamped to the workspace edges. A narrow, hover-revealed vertical size track runs alongside the rail for Pen, Line, and Shape; its numeric tooltip appears after a 250 ms hover or while dragging. The right Workspace panel also keeps contextual controls for those tools. A single shared brush color/opacity styles pen ink, line strokes, shape borders, and text; shape and text backgrounds default off. The small canvas HUD was removed because its grid/draw hint and duplicate Save action added clutter. **Decision:** keep drawing options attached to the existing floating tool rail rather than add another top bar; the top bar remains for document actions.

## Next priorities

1. **Guided workflows:** test common tasks with new users and refine labels, contextual controls, and onboarding from observed confusion.
2. **Math workspace:** stronger CAS evaluation and structured equation entry, with readable rendered mathematics instead of plain-text equation previews.
3. **Input quality:** stylus pressure and tilt where supported, smoother low-latency strokes, and configurable pen/eraser cursor behavior.
4. **Object editing:** lasso selection, transform handles for multi-selection, rotation, duplicate-by-drag, line opacity, and better keyboard-accessible controls.
5. **Reliability:** automated tests for pointer gestures, clipboard paths, document migration, autosave recovery, and export rendering.

Existing graph modes, the protractor, chemistry/physics utilities, calculator, and the hold-D drawing input should be stabilized and extended rather than rewritten without a reason.
