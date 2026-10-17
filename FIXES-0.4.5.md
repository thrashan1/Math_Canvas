# MathCanvas 0.4.5 input fixes

## D-held drawing
- Holding D starts a live ink stroke at the current pointer position without requiring a mouse button press.
- Mouse movement appends points to the draft stroke, which is rendered during the hold.
- Releasing D commits the stroke; window blur also commits it to avoid losing a partially drawn stroke.
- Normal left-button pen drawing remains supported.

## Text boxes
- Text editors are positioned directly in canvas world coordinates under the viewport transform.
- Text placement no longer captures the mouse pointer.
- The textarea receives explicit focus when a new text item enters edit mode.
- Empty text boxes show a visible dashed outline and editor placeholder until text is entered.

## Validation
- TypeScript/JSX transpilation syntax check passed for `src/canvas.tsx` and `src/App.tsx`.
- A full dependency-backed build could not be run in this environment because `npm ci` stalled while fetching dependencies.
