# imagineVTT

A lightweight, local-only virtual tabletop for in-person play with a TV laid flat on the table under physical minis. See [SPEC.md](SPEC.md) for what it does.

**Live:** https://endrejordal.github.io/imagineVTT/ (deployed from `main` by GitHub Actions)

## Run

```bash
npm install
npm run dev
```

1. Open the dev URL. This is the **GM window**. Use Chrome or Edge: folder access needs them.
2. Click **Open table window**, drag it to the TV, click it and press **F11** for fullscreen (F11 stays fullscreen when the GM opens a file dialog; double-clicking also works, but Chrome exits that kind of fullscreen whenever a dialog opens).
3. Tick **Show calibration square on table**, measure the square with a ruler, enter the measurement and click **Apply**.
4. Choose a maps folder (Map section) and, if you like, folders for the curtain, Show to players, portraits and the asset library.

## Scripts

- `npm run dev`: start the dev server
- `npm test`: run the unit tests (Vitest)
- `npm run test:maps`: run the tests against real battlemaps (`test-maps/`, not committed)
- `npm run build`: typecheck and build
- `npm run lint`: run oxlint
- `python scripts/clean-borders.py`: cut the character-token border frames out of the pictures in `borders/` into `public/borders/` (needs Python with Pillow and NumPy)

## Layout

```
src/
  shared/   types, geometry, visibility, fog, hidden areas, lights, sound, characters,
            scene files, the window channel, IndexedDB persistence (no browser UI code)
  render/   Pixi host and the layers both windows draw: map and objects (one shader),
            lighting, fog, curtain, handouts, door reveals, character tokens
  gm/       GM window: Zustand store (in slices/), sync and persistence, the interactive
            canvas and its tools, the sidebar and panels, audio
  table/    table window: display-only canvas at calibrated physical scale
public/
  borders/  character-token border frames (cleaned copies; see scripts/)
scripts/    one-off tooling
```

The GM window is the source of truth. It broadcasts state to the table window over `BroadcastChannel` and saves to IndexedDB. Scenes save to `.ivtt` files (a zip).

## Not in the repo

- `media-assets/`: the Arkenforge asset library the GM points the app at. It is licensed, read in place, and never committed or deployed.
- `borders/`: the border pictures as downloaded (their transparency is a baked-in checkerboard); `public/borders/` has the cleaned copies the app uses.
- `test-maps/`: third-party battlemaps for the grid-detection tests.
