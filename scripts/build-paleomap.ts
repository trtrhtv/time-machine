/**
 * Phase 3 (visual simulator) — precompute step.
 *
 * The validation run cached full-resolution reconstructed coastlines from the
 * GPlates Web Service (open data) in data/cache/ — ~2,300 polygons / ~8 MB per
 * epoch. That's far too heavy to ship to the browser. This script simplifies
 * each epoch into compact, projected map files the simulator can load and
 * scrub through smoothly:
 *
 *   coastlines.json     1000×500 grid, aggressive simplify — the world view
 *   coastlines-hd.json  4000×2000 grid, light simplify — the zoomed local view
 *                       ("around this spot"), lazy-loaded only when needed
 *
 * Source of truth: the SAME cached muller2022 coastlines the validation used —
 * no new API calls, no re-fetch.
 *
 * Run: npm run build:paleomap
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { FeatureCollection, Polygon } from "geojson";

const DATA = join(process.cwd(), "data");
const CACHE = join(DATA, "cache");
// Served as static assets so the browser loads + caches them once across all
// place pages. Regenerated from data/cache/ by `npm run build:paleomap`.
const OUT_DIR = join(process.cwd(), "public", "paleomap");
const MODEL = "muller2022";

interface Level {
  file: string;
  /** Equirectangular projection box (2:1); coords rounded to ints in it. */
  width: number;
  height: number;
  /** Douglas–Peucker tolerance in projected units. */
  tolerance: number;
  /** Drop islands whose bounding-box span is below this (projected units). */
  minSpan: number;
}

const LEVELS: Level[] = [
  { file: "coastlines.json", width: 1000, height: 500, tolerance: 1.2, minSpan: 4 },
  { file: "coastlines-hd.json", width: 4000, height: 2000, tolerance: 1.0, minSpan: 3 },
];

const { epochsMa } = JSON.parse(
  readFileSync(join(DATA, "validation", "places.json"), "utf8"),
) as { epochsMa: number[] };

type Pt = [number, number];

// Perpendicular distance from p to segment a–b.
function segDist(p: Pt, a: Pt, b: Pt): number {
  const [px, py] = p;
  let [x, y] = a;
  const dx = b[0] - x;
  const dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) [x, y] = [x + dx * t, y + dy * t];
  }
  return Math.hypot(px - x, py - y);
}

function douglasPeucker(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > tol) {
    const left = douglasPeucker(pts.slice(0, idx + 1), tol);
    const right = douglasPeucker(pts.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function bboxSpan(pts: Pt[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

function cacheFileFor(ma: number): string {
  const needle = `_reconstruct_coastlines_time_${ma}_model_${MODEL}_`;
  const hit = readdirSync(CACHE).find((f) => f.includes(needle));
  if (!hit) throw new Error(`No cached coastlines for ${ma} Ma (${MODEL}). Run npm run validate first.`);
  return join(CACHE, hit);
}

function buildEpoch(raw: FeatureCollection, level: Level): number[][] {
  const { width: W, height: H, tolerance, minSpan } = level;
  const project = (lon: number, lat: number): Pt => [
    ((lon + 180) / 360) * W,
    ((90 - lat) / 180) * H,
  ];
  // Split a projected ring wherever it jumps across the antimeridian seam.
  const splitAtSeam = (ring: Pt[]): Pt[][] => {
    const out: Pt[][] = [];
    let cur: Pt[] = [];
    for (let i = 0; i < ring.length; i++) {
      if (i > 0 && Math.abs(ring[i][0] - ring[i - 1][0]) > W / 2) {
        if (cur.length > 1) out.push(cur);
        cur = [];
      }
      cur.push(ring[i]);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  };

  const shapes: number[][] = [];
  for (const feature of raw.features) {
    if (feature.geometry?.type !== "Polygon") continue;
    const outer = (feature.geometry as Polygon).coordinates[0];
    if (!outer || outer.length < 4) continue;
    const projected = outer.map(([lon, lat]) => project(lon, lat));
    for (const seg of splitAtSeam(projected)) {
      const simplified = douglasPeucker(seg, tolerance);
      if (simplified.length < 3 || bboxSpan(simplified) < minSpan) continue;
      // Flat [x0,y0,x1,y1,...] of rounded ints for compactness.
      shapes.push(simplified.flatMap(([x, y]) => [Math.round(x), Math.round(y)]));
    }
  }
  return shapes;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Parse each heavy cache file once, build every level from it.
  const rawByMa = new Map<number, FeatureCollection>();
  for (const ma of epochsMa) {
    rawByMa.set(ma, JSON.parse(readFileSync(cacheFileFor(ma), "utf8")).body as FeatureCollection);
  }

  for (const level of LEVELS) {
    const epochs: Record<string, number[][]> = {};
    let totalPts = 0;
    console.log(`\n${level.file} (${level.width}×${level.height}, tol ${level.tolerance}):`);
    for (const ma of epochsMa) {
      const shapes = buildEpoch(rawByMa.get(ma)!, level);
      epochs[String(ma)] = shapes;
      const pts = shapes.reduce((s, r) => s + r.length / 2, 0);
      totalPts += pts;
      console.log(`  ${String(ma).padStart(3)} Ma → ${shapes.length} shapes, ${pts} points`);
    }
    const out = { model: MODEL, width: level.width, height: level.height, epochsMa, epochs };
    const file = join(OUT_DIR, level.file);
    writeFileSync(file, JSON.stringify(out));
    const kb = (readFileSync(file).length / 1024).toFixed(0);
    console.log(`  → ${totalPts} points total, ${kb} KB`);
  }
}

main();
