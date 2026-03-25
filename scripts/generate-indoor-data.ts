import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { indoorDataset } from "../src/data/generated/canonical-indoor-data";

const outputPath = resolve(process.cwd(), "public/indoor-data.json");

await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(indoorDataset, null, 2)}\n`);

console.log(`Wrote ${outputPath}`);
