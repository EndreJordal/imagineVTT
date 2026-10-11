# imagineVTT

A lightweight, local-only virtual tabletop for in-person play with a TV laid flat on the table under physical minis. See [SPEC.md](SPEC.md).

**Live:** https://endrejordal.github.io/imagineVTT/ (deployed from `main` by GitHub Actions)

## Run

```bash
npm install
npm run dev
```

1. Open the dev URL. This is the **GM window**.
2. Click **Open table window**, drag it to the TV, click it and press **F11** for fullscreen (F11 stays fullscreen when the GM opens a file dialog; double-clicking also works, but Chrome exits that kind of fullscreen whenever a dialog opens).
3. Tick **Show calibration square on table**, measure the square with a ruler, enter the measurement and click **Apply**.

## Scripts

- `npm run dev`: start the dev server
- `npm test`: run the unit tests (Vitest)
- `npm run build`: typecheck and build
- `npm run lint`: run oxlint

## Layout

```
src/
  shared/   types, geometry (table transform), window channel, IndexedDB persistence
  render/   Pixi host + scene layer (map image, grid) shared by both windows
  gm/       GM window: Zustand store, sync/persist, interactive canvas, sidebar
  table/    table window: display-only canvas at calibrated physical scale
```

The GM window is the source of truth. It broadcasts state to the table window over `BroadcastChannel` and saves to IndexedDB.
