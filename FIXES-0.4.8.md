# MathCanvas 0.4.8 change log

## Multi-selection

- Shift-click, Ctrl-click, and Cmd-click add or remove one unlocked object without starting a move gesture.
- Shift/Ctrl/Cmd-drag from empty space adds every unlocked object whose bounds intersect the marquee to the current selection.
- Ordinary click and marquee behavior remains replacement selection.
- The Select tool tooltip calls out the modifier shortcuts.

## Document durability and recovery

- Web autosave stores the latest project in IndexedDB, which is more suitable than localStorage for documents embedding image and PDF data.
- Electron keeps its file-based autosave as the primary latest-state copy and also writes recovery history when IndexedDB is available.
- A compact recovery index is saved about every two minutes while changes are autosaved. The five newest snapshots are retained.
- The Recovery dialog shows timestamp, canvas item count, and approximate project size. A snapshot can be restored through the existing project migration/restore code.
- Legacy localStorage autosaves are still read as a fallback if IndexedDB is unavailable or empty.

## PDF page navigation

- Newly imported PDF pages store a stable document grouping ID, original file title, page number, and total page count.
- The right sidebar includes PDF thumbnails. Selecting one selects its canvas page and centers it in the viewport.
- Existing pages from older project files without page metadata remain available in Layers; their thumbnails are not automatically reconstructed.

## Validation notes

- TypeScript/JSX transpile syntax checks passed for `src/App.tsx`, `src/canvas.tsx`, and `src/platform.ts`.
- `npm run typecheck` could not run because the dependency installation did not finish and `node_modules/vite` is incomplete (`vite/client` types are missing).
- A full application build and browser interaction test were not completed. This is a source release, not a claim of runtime verification.
