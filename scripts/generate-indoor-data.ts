import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { indoorDataset } from "../src/data/generated/canonical-indoor-data";
import type { CanonicalIndoorDataset } from "../src/lib/types";

const outputPath = resolve(process.cwd(), "public/indoor-data.json");

// connectsTo is auto-resolved at runtime by findConnectingRoomId — strip it from the output
const dataset: CanonicalIndoorDataset = {
  ...indoorDataset,
  rooms: indoorDataset.rooms.map((room) => ({
    ...room,
    openings: room.openings?.map(({ connectsTo: _ct, ...o }) => o),
  })),
};

await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);

console.log(`Wrote ${outputPath}`);
