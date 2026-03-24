# indoor-map

Indoor office map MVP built with `Bun`, `Vite`, `React`, and `MapLibre GL JS`.

## Features

- multi-floor office plan rendered in MapLibre
- click and hover interaction for rooms, desks, and connectors
- floor switching
- 2.5D walls and furniture via `fill-extrusion`
- employee and room search
- client-side multi-floor routing over a dedicated graph
- optional accessible routing mode that avoids stairs
- mock occupancy provider for meeting-space statuses

## Run

```bash
bun install --no-cache
bun run dev
```

Open the local Vite URL shown in the terminal.

## Checks

```bash
bun run check
bun run build
```

## Data Model

Runtime office data lives in [`src/data/generated/office-data.ts`](/home/alexander/Projects/indoor-map/src/data/generated/office-data.ts) and is split into:

- visual features for spaces, structures, and POIs
- a separate routing graph for navigation
- a search index for rooms and employees

This keeps rendering, routing, and occupancy concerns separate while still letting the UI work from one coherent office model.
