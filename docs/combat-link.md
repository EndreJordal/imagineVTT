# Combat link: campaign bible → imagineVTT → combat tracker

How the three projects work together. **Status: built** (prototype, stages A–C).

| Project | Folder | Role |
|---|---|---|
| **imagineVTT** | `C:\dev\imagineVTT` | The hub: the GM window (scenes, tokens) and the table window (what the players see). |
| **V:tM combat tracker** | `C:\dev\vtm-combat_tracker` | The rules and initiative. Plain HTML/JS; its side of the link is `js/imagine-link.js`. |
| **Campaign bible** | `C:\dev\he built the same room twice` | The encounters. `encounters/build.py` writes the links. |

All three are served from GitHub Pages under `https://endrejordal.github.io/` (the bible can also be opened from disk). imagineVTT and the tracker share that address, which is what lets them talk.

## What the GM does

1. Closes imagineVTT, then clicks **▶ Start in imagineVTT** on an encounter in the bible (`encounters.html`, or a link in `campaign-bible.html`).
2. imagineVTT opens with a banner naming the encounter and its scene, then:
   - The first time, choose the **scenes folder**. It's remembered; the browser asks again for permission on each visit, with one click.
   - **Create the scene and start the fight** (a new scene, saved into the folder), or **Open the scene and start the fight**.
   - If the scene has the fight saved: **Resume the fight** (exactly as it was) or **Start again** (its tokens are taken off).
   - **Start it in the open scene** puts the fight into whatever scene is open.
   - If the open scene has unsaved changes, it's saved first (a tick box).
3. The tracker opens in its own window (allow pop-ups for imagineVTT) and builds the fight as an `#encounter=` link would.
4. The **Combat** section in imagineVTT's sidebar lists the combatants in order of initiative, as coins.
   - Drag a coin onto the map to place its token. It starts **hidden**; 👁 shows it. Dragging again moves it.
   - **Place all** (the stack at the top of the list): drop it on the map and everyone not on it yet is placed in a block round the drop, all selected, to drag on together or group.
   - Tokens can be selected together (Shift+drag a box, Shift+click, or the **Characters** heading in the Scene panel), moved together (drag one, or the arrow keys) and grouped (the group bar); clicking a grouped token selects its group, Alt+click just it.
   - Tokens follow their combatants: name, and greyed when dead or in torpor.
   - **Show the order to the players**: a row of portrait coins, with each one's initiative, along any edge of the table screen (bottom, top, left, right), reading **outward** (from that edge's side of the table) or **inward** (from across it), and optionally along the opposite edge too. Whoever is acting gets a glow, on the map too.
5. Save as usual (Ctrl+S). A scene from the scenes folder saves straight back to its file, and autosaves every 3 minutes while it has changes. **The fight's full state is saved inside the scene**, so next week, click the same link (or open the scene) and **Resume**.

## The link

```
https://endrejordal.github.io/imagineVTT/#combat=<base64url JSON>
```

```json
{ "v": 1, "scene": "The Record Shop - Fire in the Dubbing Room", "encounter": { "...the tracker's payload, unchanged..." } }
```

- **`scene`**: the scene's name, which is also its file in the scenes folder (`<scene>.ivtt`; characters file names can't hold become `-`). One scene per encounter.
  - Set encounters: the encounter's name (`—` becomes `-`).
  - Random ones: `Random - <name>`.
  - An encounter file can set `"scene"` itself.
- **`encounter`**: exactly what the tracker takes in an `#encounter=` link. Tracker-only links still work (**Tracker only** in the bible).
- Base64url is UTF-8 JSON with `+`→`-`, `/`→`_`, no padding (as the tracker's links).

### Per-combatant `vtt` block (optional)

On any entry in `encounter.combatants`, for how its token looks. The tracker keeps it on the combatant and sends it back.

```json
{ "preset": "neonate", "name": "Hollis", "vtt": { "border": "iron-chain", "type": "Brujah antitribu, ductus", "label": "both" } }
```

| Field | Values | Default |
|---|---|---|
| `border` | `gold`, `glass`, `iron-chain`, `iron-studs`, `steel-spikes`, `black-iron`, `plain` | `plain` |
| `color` | `#rrggbb` (the plain ring) | red for enemies, green for allies |
| `type` | text for the token's Type line | the preset's name, else the kind |
| `size` | `1`, or `2` (2 × 2) | `1` |
| `label` | `name`, `type`, `both`, `none` | `name` |

## Between imagineVTT and the tracker

A `BroadcastChannel` named `imagine-combat`. Every message is `{ app: "imagine-combat", v: 1, from: "vtt" | "tracker", type, ... }`. Only the tracker window imagineVTT opened, named `vtm-tracker`, takes part; other tracker tabs carry on as before.

| From | `type` | Fields | Meaning |
|---|---|---|---|
| vtt | `hello` | | imagineVTT started, or took a fight on: send everything. |
| vtt | `ping` | | Every 2 s: send what changed, if anything. |
| vtt | `encounter` | `linkId`, `payload` | Start this encounter (the tracker asks first if it has a fight). |
| vtt | `resume` | `linkId`, `saved` | Put this saved fight back, as it was (asks first likewise). |
| tracker | `hello` | `linkId` | Loaded. imagineVTT then sends a waiting `encounter` or `resume`. |
| tracker | `beat` | `linkId` | Every 2 s: here, holding this fight (or `null`). |
| tracker | `state` | `linkId`, `summary`, `snapshot` | After every change (debounced). |

- **`linkId`** ties a fight to a scene. imagineVTT keeps it with the scene's fight; the tracker keeps it in its combat (`combat.linkId`). imagineVTT takes the tracker's `state` **only if the `linkId` matches**. So a fight run in the tracker on its own, or "End combat" there, never overwrites the scene's save; the Combat section then offers **Resume it there**.
- **`summary`**: `{ name, round, phase, activeId, order, combatants }`. Each combatant is `{ id, name, type, side, allegiance, state, inactive, acted, init, portrait, vtt }`, with `portrait` an absolute URL. What imagineVTT shows.
- **`snapshot`**: `{ combat, weapons }`. The tracker's whole combat (with its log), and the custom weapons its combatants carry. Saved in the scene; `resume` gives it back.

## What the players see

The order of initiative, each coin with its initiative. Left out:
- the tracker's **Inactive** combatants (reinforcements not in the fight yet);
- an enemy NPC whose token is on the table's floor but out of the players' sight (hidden, unlit or in a hidden area).

Players and allies always show. Dead and torpid combatants show greyed; those who have acted, faded.

## Saving and resuming

- The scene file (`.ivtt`) holds the fight: `combat` in its `scene.json`, with the link id, the encounter, the last summary, the full snapshot, and the order settings. imagineVTT also keeps it between visits (IndexedDB).
- Portraits are fetched from the tracker and kept in the scene's images, the ones on tokens in the file.
- Resuming restores the tracker's fight exactly: combatants, damage, Willpower, blood, turn, phase, who's acting, the log, custom weapons.

## Developing and testing

- imagineVTT's dev server also serves the tracker at `/vtm-combat-tracker/` (`vite.config.ts`; folder `TRACKER_DIR`, default `../vtm-combat_tracker`). So locally they share an address, as on GitHub Pages.
- Bible links against the local server: `IMAGINE_URL=http://localhost:5180/ python encounters/build.py`.
- The live version needs all three deployed: imagineVTT and the tracker to GitHub Pages; the bible's pages rebuilt.

## Known limits

- Chrome or Edge, for the scenes folder. Without one, the fight can only go into the open scene, and is saved with it as usual.
- The browser must allow pop-ups for imagineVTT, so it can open the tracker. If it blocks one, imagineVTT says so, and the fight waits until the tracker is opened.
- One GM window at a time: a second one stands down, and passes on a link it was opened with.
- The players' order shows on the table window only; the GM sees it in the Combat section.
