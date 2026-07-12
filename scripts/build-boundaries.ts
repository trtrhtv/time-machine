/**
 * Precompute step: mountain-belt lines per epoch.
 *
 * Mountains form where plates converge. The GPlates Web Service exposes the
 * reconstructed plate-boundary topologies per epoch (open data) — we keep the
 * convergent features (SubductionZone, OrogenicBelt) and ship them as compact
 * polylines. The renderer raises rugged terrain near these lines, so ranges
 * appear where the model says collision was happening — not randomly.
 *
 * Cache-first via gws.ts like every other fetch in this repo.
 *
 * Run: npx tsx scripts/build-boundaries.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import { gwsGet } from "./gws";

const DATA = join(process.cwd(), "data");
const OUT_DIR = join(process.cwd(), "public", "paleomap");
const MODEL = "muller2022";
const GRID_W = 8000; // same projected space as coastlines-full
const GRID_H = 4000;

// Convergent-margin feature types = where mountain building happens.
const MOUNTAIN_TYPES = new Set(["SubductionZone", "OrogenicBelt"]);

const { epochsMa } = JSON.parse(
  readFileSync(join(DATA, "validation", "places.json"), "utf8"),
) as { epochsMa: number[] };

function project([lon, lat]: number[]): [number, number] {
  return [
    Math.round(((lon + 180) / 360) * GRID_W),
    Math.round(((90 - lat) / 180) * GRID_H),
  ];
}

/** Split a projected line wherever it jumps across the antimeridian seam. */
function splitAtSeam(line: [number, number][]): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < line.length; i++) {
    if (i > 0 && Math.abs(line[i][0] - line[i - 1][0]) > GRID_W / 2) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    cur.push(line[i]);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const epochs: Record<string, number[][]> = {};

  for (const ma of epochsMa) {
    const res = await gwsGet("/topology/plate_boundaries/", { time: ma, model: MODEL });
    if (res.status !== 200) throw new Error(`plate_boundaries(${ma}) → HTTP ${res.status}`);
    const fc = res.body as FeatureCollection;

    const lines: number[][] = [];
    for (const f of fc.features) {
      const ftype = (f.properties as { type?: string })?.type ?? "";
      if (!MOUNTAIN_TYPES.has(ftype)) continue;
      const geoms =
        f.geometry?.type === "LineString"
          ? [(f.geometry as LineString).coordinates]
          : f.geometry?.type === "MultiLineString"
            ? (f.geometry as MultiLineString).coordinates
            : [];
      for (const coords of geoms) {
        const projected = coords.map(project) as [number, number][];
        for (const seg of splitAtSeam(projected)) {
          lines.push(seg.flat());
        }
      }
    }
    epochs[String(ma)] = lines;
    console.log(`${String(ma).padStart(3)} Ma → ${lines.length} mountain-belt lines`);
  }

  const out = { model: MODEL, width: GRID_W, height: GRID_H, epochsMa, epochs };
  const file = join(OUT_DIR, "boundaries.json");
  writeFileSync(file, JSON.stringify(out));
  console.log(`→ ${file} (${(readFileSync(file).length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
