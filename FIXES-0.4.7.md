# MathCanvas 0.4.7: multi-select, line styling, and PDF eraser

## Selection
- Dragging a marquee selects every unlocked object whose bounds intersect the marquee, not just the topmost hit.
- Multi-selection displays per-item outlines and one group boundary. Dragging moves the selected objects together.
- Delete, arrow-key nudging, copy/paste, front/back ordering, lock/unlock, and matching-style edits operate on the full selection where applicable.
- Ctrl/Cmd+A selects all unlocked objects. Copy/paste handles MathCanvas objects as a group and has a same-session fallback if clipboard text access is blocked.

## Line tool
- A context toolbar appears while the Line tool is active or a line is selected.
- Line color, width, solid/dashed/dotted style, start arrow, and end arrow are configurable.
- New lines store their own style so later toolbar changes do not recolor unrelated lines.

## Roadmap: raster-PDF pixel eraser
- The Eraser tool now paints a white, page-local mask over imported PDF pages, rather than deleting the entire PDF page object. A drag that begins outside a page switches to page erasing as soon as it reaches a PDF page.
- Eraser marks move and scale with the PDF page, persist in project/autosave data, and are included in PNG export.
- Ordinary imported images continue to erase as whole objects. This makes the page eraser first-pass PDF-paper restoration, not transparent pixel recovery.

The follow-on priorities are recorded in `ROADMAP.md`, starting with recovery snapshots and multi-page PDF navigation.

## Validation
- `tsc -b --pretty false` passed.
- The Vite production build was attempted but could not start because the environment has an incomplete dependency install and is missing its Linux Rolldown native binding.
- Browser runtime behavior remains unverified in this environment; install dependencies normally with `npm install`, then run `npm run build` to complete the production build.
