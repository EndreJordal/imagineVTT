# imagineVTT — Spec

A lightweight, local-only virtual tabletop for in-person play: the GM runs it on a laptop, and a TV lies flat on the table showing the map under physical miniatures.

This describes what the app does now. "Planned" marks what isn't built.

## Setup & constraints

- **Two windows, one machine.** A GM window (laptop) has full control. A Table window (TV, fullscreen) is display-only.
- **No network, no accounts.** Everything runs in the GM's browser. The windows sync via `BroadcastChannel`.
- **GM controls everything.** Nobody interacts with the table screen.
- **Physical minis sit on the screen.** The table view renders at true physical scale (1 grid square = 1 inch by default, configurable).
- **Chromium for folders.** Choosing folders (assets, pictures, maps, portraits) needs the File System Access API (Chrome, Edge). Without it the rest works and maps fall back to a file upload.
- **Licensed content stays out of the repo.** The Arkenforge asset library (`media-assets/`) is read in place from a folder the GM points to; it is never committed or deployed.

## The two windows

### GM window
- The map with every overlay: walls, doors, lights, vision tokens, hidden areas, objects, sounds, character tokens.
- Left sidebar: table view box (PVB), curtain, Show to players, character tokens, map, grid, assets and the rest of the scene setup.
- Toolbar: scene file, undo/redo, time of day, GM vision, the Obscuring menu, Sound mixer, Curtain, Settings.
- Right **Scene panel**: every group, object, light, vision token, hidden area, character and sound, with renaming (auto-numbered names such as "Torch 1") and go-to.
- Hold **V** to peek at the players' view. **C** drops or raises the curtain.

### Table window
- Display-only, at calibrated physical scale. A one-time calibration (a square measured with a ruler) stores pixels per mm per display. F11 for fullscreen.
- Orientation (which edge is "up": 0/90/180/270°) and a PVB (player view box) the GM positions, turns and zooms on the map.
- A table opened while the curtain is down shows the curtain at once, never the map.

## Features

### 1. Scenes, maps & floors
- Maps are images read **from a folder** the GM chooses (Map section), or a file upload where folders aren't available. The map in use is saved inside the scene file.
- Grid size, offset and visibility; the map can be scaled, moved, locked per axis or to the grid, and turned in quarter turns (walls, lights, objects, sounds, characters, explored areas and hidden areas turn with it).
- **Detect grid** finds a square grid drawn on the map (any colour, busy art), then scales and places the map to match. Runs in a worker in about 0.5–3 s; undoable. If none is found it says so. For maps without a grid, **auto walls** (beta) and a grid derived from the walls help.
- **Floors**: several maps per scene, each with its own walls, lights, objects, hidden areas, sounds and characters. The GM previews a floor while the table shows another; the party's lights and vision tokens line up with the previewed floor, and move with the table.
- Time of day: a day-to-night slider that dims and desaturates the map, on the table too.

### 2. Walls, doors, vision & obscuring
- Walls are line segments, drawn freehand or snapped to the grid, editable by point. **Walls always block light and sight.**
- **Doors**: made by clicking two points on one stretch of wall, or two wall ends across a gap. Open or closed; a closed door blocks.
- **Door reveals**: when a door opens onto something obscured, what it hid comes into view as a wipe or a fade (default: wipe, 3 s). Set for all doors in the sidebar; each door can override.
- **Vision tokens** (lights with vision on): a visibility polygon over the walls, clipped by vision range. Vision safety stops a drag through a wall or closed door (Alt overrides).
- **Obscuring menu** (per floor): Off, Dim (out of sight is greyed), Full (fog of war: explored areas are remembered). Reset explored areas; vision safety; a switch for hidden areas.
- **Hidden areas** ("local fog"): drawn with fill, brush and erase on the hide tool, with cloudy soft edges. Each has a token, settings (soft edges, reveal with vision, active) and Reset/Remove. Vision pierces an area through an open door.

### 3. Lights
- Presets (torch, lantern, candle, brazier, camp fire, flashlight, fixtures, flickering neon, and more) with radius, brightness, colour, **colour strength** (white light to bathing the map in its colour) and, for flames, **liveliness** (steady to erratic). Flickering fixtures have their own flicker settings.
- Hand-held lights can travel with the PVB (the party). Light is clipped by walls.

### 4. Asset library & objects
- The Arkenforge library is read in place and indexed (objects, textures, lines, tokens; sounds and ambience): searchable, by genre and category, in Visual and Audio halves.
- Objects are dragged onto the map, resized (a corner; **Shift** squishes), rotated, copied (**Ctrl**-click drops copies), and multi-selected (Shift-click or a box) with shared settings. Names auto-increment. Groups: named, selected as one (Alt-click picks one).
- **Players see it** per object: like the map, only in sight, once seen, or hidden (revealed with a switch).
- Images used are embedded in the scene file, so a scene needs no library.

### 5. Sound
- Sounds are dragged from the Audio library onto the map as tokens: volume, range, enabled, loop, and for one-shots a trigger (manual, on entering range, or both), with a play button on the token. Louder the nearer the party's vision tokens.
- **Make global** moves a sound to the toolbar mixer: a fader per sound, a master fader, play/stop and loop. Global sounds belong to the scene.
- Door open/close sounds, for all doors or per door. Deleting a sound token stops it at once.
- All game audio plays from the GM window to a chosen output (the TV's speakers, say); previews play on the GM's own output.

### 6. Character tokens
- Round tokens for the people the party meets. One square, or 2 × 2 ("4 squares"), always fitting the squares with 1 mm to spare on the table.
- Borders: the bundled frames, or a plain ring in any colour. A portrait from a portraits folder, with zoom and centring.
- Visible (default on), snap to grid (default on), a name. The GM always sees every token; the players see it only when it is Visible, in a vision token's sight and lit (daylight, or a light reaching it), outside hidden areas. The GM sees the others greyed.
- All tokens can be turned together in quarter turns (border, portrait and text), to face the players on any side of the table.
- Dragged or moved with the arrow keys (a square at a time when snapping). Moves **slide** (0.5 s by default; one time for all tokens in the sidebar, or each token's own).

### 7. Showing things to the players
- **Curtain** (C): a picture from a folder replaces the map on the table, with cut, fade, dissolve, wipe or iris transitions, a fit (fill or whole picture) and a slideshow of ticked pictures.
- **Show to players**: a picture from a folder, framed over the map and the curtain: its own size (or smaller to fit), or filling the screen to a 50 px margin; turned in quarter turns (remembered per picture). The PVB outlines it.

### 8. Calibration & orientation
- Calibration as above; a per-display pixels-per-mm value, with a correction from a measured square. PVB orientation buttons place and turn the view.

### 9. Persistence
- Everything is saved in IndexedDB (Dexie) as you go, and restored on the next visit. Folders are remembered (the browser asks permission again each visit).
- Scenes save to an `.ivtt` file (a zip): the scene, every floor, the maps, explored areas, object images, portraits and sounds used. Open, save, and drop a file on the window to open it.
- The curtain, Show to players, map and portrait folders, and the sound output are the GM's own settings, kept across scenes.

## Planned
- Hex grids (square only for now).
- A manual grid fallback: drag a box over N × M map squares.
- Drawing and measurement: freehand and shapes, a ruler, area templates (circle, cone, line, square).
- Dice roller (notation, advantage/disadvantage) with a log.
- Plugin hooks: token data fields, GM sidebar panels, macros, events.
- Tauri packaging for native multi-window, monitor targeting and file access.

## Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Build | Vite |
| UI | React |
| Canvas | PixiJS v8 (WebGL; one shader pass for the map, objects and fog) |
| State | Zustand: the GM window is authoritative, the store is split into slices; the table window is a read-only replica |
| Window sync | `BroadcastChannel` |
| Storage | IndexedDB via Dexie; scene files via fflate |
| Visibility | Custom raycast visibility polygon (no library) |
| Audio | Web Audio |
| Testing | Vitest (geometry, visibility, store, scene files, performance budgets) |
| Lint | oxlint |

## Decisions
- The table is plain and dark where nothing is visible (no texture), to reduce glare under minis.
- Grids are square only; the square size is configurable (default 1" = 25.4 mm).
- The map draws in a single shader pass; the draw loop is on demand (60 fps at most, 30 fps for animation), so a still scene costs nothing.
- The table reuses unchanged state between messages (`shared/reuse.ts`), so caches keyed by identity hold.
- Pictures, maps, portraits and assets are read in place from folders; only the ones a scene uses are copied into its file.
