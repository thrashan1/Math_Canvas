# MathCanvas web app plan

MathCanvas now has a browser-safe path as well as the Electron desktop path.

## What works in a GitHub Pages build

- The same first-party React canvas runs in a normal browser.
- Autosave falls back to browser storage when Electron APIs are not present.
- Open uses a browser file picker.
- Save downloads a `.mathcanvas` project.
- PNG export runs in the browser.
- PDF and image import stay local to the browser.
- Calculator, graphing, equations, chemistry and physics tools work without a server.

The `.github/workflows/pages.yml` workflow builds `dist/` and publishes it as a GitHub Pages site on pushes to `main`.

## What the hosted version should become

The GitHub version should stay local-first. The server should not own the user's canvas unless a future collaboration mode is added.

A larger web version should replace the small localStorage recovery layer with IndexedDB. PDF pages, image rasters, OCR output and recovery snapshots can then live in the browser without putting the project file on a server.

The web version can later add:

1. Browser-native drag and drop for PDFs and images.
2. Multiple tabs or pages inside one project.
3. Shareable project files with no account.
4. Optional cloud sync later, kept separate from the local project format.
5. A service worker so the app can reopen without a network connection after the first load.

## GitHub Pages setup

1. Push the project to a GitHub repository.
2. In repository Settings > Pages, select GitHub Actions as the source.
3. Push to `main`.

The workflow sets the Vite base path to `/<repository-name>/`, so a normal project Pages site does not need a manual path edit.
