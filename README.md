# MathCanvas 0.4.8

This build uses a native HTML Canvas renderer. It does not depend on tldraw or a tldraw license.

## 0.4.8 multi-selection, durability, and page navigation pass

- Marquee selection selects all intersecting unlocked objects and supports grouped movement, copy/paste, delete, nudging, and layer operations.
- Line styling includes solid/dashed/dotted styles and optional start/end arrows; color and thickness follow the shared brush controls.
- PDF-page erasing paints page-local white masks that follow the page and persist in MathCanvas project data. Imported photos remain normal movable objects.
- Shift-click, Ctrl-click, or Cmd-click toggles individual objects in the selection. Modifier-drag on empty canvas adds a marquee selection without clearing prior selections.
- The latest browser autosave uses IndexedDB to support larger embedded documents; the Recovery window lists up to five time-spaced recovery snapshots. Desktop file autosave remains the primary latest-state copy.
- New PDF imports retain page metadata and appear as thumbnails in the PDF pages navigator. Clicking a thumbnail selects and centers that page.
- First-time users see a Getting started guide with direct actions for a blank page, PDF/image annotation, and graphing. Reopen it from the `?` button in the canvas toolbar; the Workspace panel puts common create-and-explore tools first.
- The first Settings section offers **Clean**, **Medium**, and **Maximum** interface levels. Clean keeps core writing tools visible, Medium adds common math and page tools, and Maximum exposes advanced tools such as local AI, physics, and collaboration. Imported PDF pages are grouped by source and can be reordered from the page navigator.
- The default workspace uses a vertically centered floating tool rail. Hold Pen, Line, Shape, Text, or Eraser to open options centered on that tool; a narrow size track appears beside the rail on hover for Pen, Line, and Shape. Hover the track for 250 ms to see its numeric value, or drag to adjust it. Contextual drawing controls also remain in the right Workspace panel. Pen, line, shape borders, and text share one brush color/opacity control; shapes and text boxes start without a background fill. The redundant canvas HUD was removed; document actions stay in the top bar and drawing options stay with their tools.
- This remains a native Canvas 2D renderer. It does not include tldraw source code.

See `FIXES-0.4.8.md` for the details and validation limitations.

## Important
We recommend using the installer, found in releases. (Windows only)

## Run in VS Code

```powershell
npm install
npm run dev
```

## Build and install the Windows desktop app

To create a Windows installer, install Node.js 22.12 or newer on the computer used to build the installer, then double-click `build-windows.cmd` or run it from a terminal. The script installs the exact dependencies from `package-lock.json`, builds the app, and creates `release/MathCanvas-Setup-0.4.8.exe`.

Run the generated setup executable and follow the prompts. It installs MathCanvas with its Electron runtime and app dependencies, and adds Start Menu and desktop shortcuts. People installing the finished app do not need Node.js, npm, or a separate build step.

For the web build:

```powershell
npm install
npm run web:build
```

## Local AI problem solver

Select **AI problem solver** in the left toolbar, drag a rectangle directly around the problem on the MathCanvas workspace, and choose **Confirm and solve**. The solution page streams a concise explanation and a detailed walkthrough; each can be added to the canvas independently. It can work through math, chemistry, and physics problems. If image recognition misreads the problem, correct it in **Problem text** and solve again. Supported typed single-variable linear and quadratic equations are solved locally instead of being sent to the model.

The solver uses Ollama running on this computer and makes no hosted AI API calls. Open **Settings** from the canvas toolbar or solver page to see installed models, install recommended vision models, select a model, or install a model by its Ollama tag. The default is `qwen3-vl:4b`, a newer open-weight vision/reasoning model; `qwen3-vl:2b` is a lighter option, while `qwen3-vl:8b` may be slower or exceed a laptop GPU's memory. The previous `qwen2.5vl:3b` model remains available. Model downloads need an internet connection, but problem images and inference stay on the computer at `127.0.0.1:11434`. The web build also needs Ollama to allow requests from the web app's origin. Settings are organized into **Appearance**, **Layout**, **AI & Models**, and **Solver** tabs. Appearance includes light, dark, paper, and midnight themes, toolbar icon size, and interface text scaling. The **More experimental themes** page adds mint, pink, blue, pastel, rose, ocean, forest, lavender, solarized, and high-contrast palettes, plus neutral Gray, Silver, Smoke, Graphite, and Charcoal palettes for a gradual, mostly color-free range from light to dark. Dark color themes include Deep ocean, Emerald night, Plum night, Burgundy night, and Indigo night; Twilight, Dusk, and Denim provide intermediate mid-tone choices. It also offers automatic accent-color generation and a custom theme builder. Experimental and custom themes are saved locally. Custom palettes can be shared as `MC-THEME-1:` codes from the custom theme builder; paste a code there to validate and apply an imported theme. Layout presets include a floating toolbar by default, top/left/right/bottom-heavy docks, compact focus, and layouts inspired by Photoshop, Microsoft Paint, and OneNote. Hiding the Math tools panel collapses its layout space; the restore arrow remains available at the workspace edge.

Problem explanations render LaTeX math notation, including fractions, roots, exponents, subscripts, Greek letters, limits, and derivatives. The solver is prompted to use `\( ... \)` for inline math and `\[ ... \]` for display equations. Model-generated solutions can be wrong; verify their work before relying on it.

## Renderer changes

- Native canvas is the actual scene renderer.
- Static scene changes paint immediately after layout.
- High-frequency pointer updates still use animation-frame rendering.
- Canvas clearing always happens in physical-pixel space before transforms are applied.
- One broken item cannot blank the entire scene.
- Imported images and PDF page renders are cached and painted on the canvas.
- Selection UI and text/equation/table editing stay as DOM overlays only.
- Hold `D` temporarily switches to drawing. If the pointer is already held when `D` is pressed, the current pointer position starts the stroke.
- Freehand strokes are not grid-snapped.
- Ctrl + wheel zooms the MathCanvas viewport instead of browser zoom.
- Shift/Ctrl/Cmd-click toggles objects in multi-selection. Modifier-drag in empty space adds all objects intersecting the selection rectangle.
- Group selected canvas items from the Layers panel; grouped items select, move, resize, and ungroup together. Drag image files onto the workspace to place them at the drop point.
- Undo and redo are available from the top bar as well as keyboard shortcuts. In a collaboration room, undo/redo tracks only the local participant's edits.
- Equation size follows resize handles and the Text size control. Graphs label x/y intercepts and curve intersections; hover or click a marked point in the graphing calculator to inspect its coordinates.
- **Test problem maker** analyzes the visible canvas with the configured local Ollama model and generates new practice questions with an answer key. Use **Fit canvas** first if the material you want it to analyze is outside the current view.
- Use **Recovery** in the top bar to restore a prior version, and **PDF pages** in the right sidebar to navigate pages from newly imported PDFs.
- Open **Graphing Calculator** from the left toolbar for a full-screen graphing workspace. Add multiple expressions, define functions and parameters, animate sliders, inspect curve coordinates, and see approximate intersections. Hovering a saved graph on the canvas also shows curve coordinates. **Add to canvas** saves the editable graph as a canvas object; double-click a graph or choose **Edit selected graph** to reopen it later. The graph workspace currently plots explicit one-variable functions.
- Open **2D Physics Simulator** from the left toolbar or Math tools to build a scene with bodies, forces, strings, walls, and frictional surfaces. Drag to draw and size surfaces and walls; set an object's initial velocity to simulate projectile motion. The **Auto balance forces** option shows the counter-force used to hold objects in equilibrium; turn it off to show velocity arrows and let forces accelerate objects. Simulation mode supports playback and time scrubbing. Insert a snapshot or looping simulation on the canvas, then reopen it to edit the scene. The simulator uses a lightweight 2D collision and force solver.
- Use **Collaborate** to host or join an invite-code room over the internet. Firebase Realtime Database and anonymous Firebase Authentication coordinate invitations, host approval, and WebRTC connection details; canvas updates are synchronized peer-to-peer and are not stored in Firebase. Direct WebRTC connections use a public STUN service and may fail on restrictive networks because no TURN relay is included.

## Online collaboration setup

1. Create a Firebase project, register a web app, create a Realtime Database, and enable **Anonymous** sign-in under Authentication providers.
2. The public Firebase web app configuration is included in `src/firebase-client-config.ts`, so collaborators can clone the repository and run the app without creating `.env.local`. These client configuration values are not secrets. `.env.local` values can override them for development with a separate Firebase project. If you change Firebase projects, update the public config in that file or provide all `VITE_FIREBASE_*` values at build time.
3. In Realtime Database **Rules**, publish the contents of [`firebase.database.rules.json`](./firebase.database.rules.json). Do not use test mode or permissive rules.
4. Run `npm install` and `npm run dev`, or build with `npm run build`. Each participant runs a build configured for the same Firebase project. One person hosts and shares the 16-character invite code; the host must approve each request.

Firebase web app configuration values are included in the client build and are not server credentials. The Realtime Database rules and anonymous authentication limit access. Firebase's free-tier quotas and terms can change; check the current Firebase pricing page for the project's region and usage. Signaling messages are removed by their recipient after processing, active rooms are removed when the host leaves or disconnects, and live cursor, selection, and marquee presence are transient data removed when participants leave or disconnect. Firebase carries signaling and presence, not canvas content. Peers exchange canvas updates directly over WebRTC; without TURN, some NAT/firewall configurations cannot establish a direct connection.

To join from another development machine, clone the repository, run `npm install`, then `npm run dev`. No Firebase CLI login or local `.env.local` file is required. The same Firebase project settings are used by the development app and the deployed static site.
