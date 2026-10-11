# imagineVTT — Spec

A lightweight, local-only virtual tabletop for in-person play: the GM runs it on a laptop, and a TV lies flat on the table showing the map under physical miniatures.

## Setup & constraints

- **Two windows, one machine.** A GM window (laptop) has full control. A Table window (TV, fullscreen) is display-only.
- **No network, no accounts.** Everything runs in the GM's browser. The windows sync via `BroadcastChannel`.
- **GM controls everything.** Nobody interacts with the table screen.
- **Physical minis sit on the screen.** The table view must render at true physical scale (1 grid square = 1 inch by default).
- **System-agnostic core** with plugin hooks for game-system modules.

## Core features (MVP)

### 1. Scenes & maps
- Upload a map image. Set grid size, offset and type (square first, hex later).
- The GM pans and zooms freely in the GM window.
- The table viewport shows as a rectangle on the GM map. The GM drags or rotates it to choose what the table shows. The table's zoom is fixed by calibration.

### 1b. Grid matching
- **Detect grid**: finds a square grid drawn on the map image (any line colour, faint lines, busy art), then scales and places the map so its squares land exactly on ours. Runs in a worker in about 0.5–3 s, and can be undone.
- If no grid is found (gridless maps, or grids too fragmented to see), it says so rather than guessing, and the GM scales the map by hand.
- Tested against real battlemaps in `test-maps/`. They aren't committed; the tests skip without them.
- Planned: a manual fallback where the GM drags a box over N×M map squares.

### 2. Table calibration
- A one-time wizard: draw a square on the TV and adjust it until it measures 1 inch (or 25 mm) with a ruler. Store the pixels-per-inch value per display.
- The table view never zooms. The map's grid is scaled so that 1 grid square = 1 physical square.
- Orientation setting: which table edge is "up" (0/90/180/270°).

### 3. Tokens (digital stand-ins for minis)
- Tokens hold position, size, name, image (optional) and a hidden flag.
- On the table, tokens are drawn **minimally or not at all** (configurable: off / base ring / full image), since physical minis cover them.
- Tokens mainly drive vision and serve as the GM's record of where things are.

### 4. Walls, vision & fog
- The GM draws walls, doors (open/closed) and windows (block movement, not sight) as line segments.
- Vision comes from PC tokens: a raycast visibility polygon over the wall segments, clipped by vision range.
- Light sources: bright/dim radius, attachable to tokens or placed on the map.
- Explored-area memory: previously seen areas render dimmed.
- Manual override: the GM can reveal or hide regions by hand.
- The GM window shows everything, with a tint over what the table can't see.

### 5. Drawing & measurement
- Freehand and shape drawing (GM-only or table-visible layers).
- Ruler with distance in grid units.
- AoE templates: circle, cone, line, square. Shown on the table so players can see what's caught under them.

### 6. Dice (optional panel)
- Notation roller (`2d6+3`, `4d6kh3`, adv/dis) with a log in the GM window. Results can optionally flash on the table.

### 7. Persistence
- Campaigns → scenes. Stored in IndexedDB, with map images stored as blobs.
- JSON export/import (with embedded images) for backups.

### 8. Plugin hooks
A typed module API, defined from the start but kept small:
- Register token data fields (e.g. HP, AC) and how they render.
- Register GM sidebar panels.
- Register dice formulas/macros and token context-menu actions.
- Subscribe to events (token moved, turn changed, roll made).

## Out of scope (for now)
Networking/remote play, accounts, player-controlled input, character sheets in core, audio/video, touch input, initiative tracker (a good first plugin candidate).

## Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Build | Vite |
| UI | React |
| Canvas | PixiJS v8 |
| State | Zustand (GM window authoritative; table window is a read-only replica) |
| Window sync | `BroadcastChannel` (Tauri events later) |
| Storage | IndexedDB via Dexie |
| Visibility | Custom raycast visibility polygon (no library) |
| Packaging | Browser first; Tauri later for native multi-window, monitor targeting, file access |
| Testing | Vitest (geometry/visibility/dice logic), Playwright later |

## Decisions
- Fog on the table is plain dark (no texture) to reduce glare under minis.
- Grids are square only in the MVP; hex comes later.
- The grid square / base size is configurable (default 1" = 25.4 mm).
