/**
 * Satellite-style renderer for reconstructed paleo-coastlines.
 *
 * What it does: rasterizes an epoch's coastline polygons (open GPlates data)
 * into a Blue-Marble-like image — climate-banded land with procedural terrain
 * texture and hillshading, shallow shelves hugging the coasts, sea ice near
 * the poles. Texture is deterministic in WORLD coordinates, so panning and
 * zooming stay coherent and detail never pixelates.
 *
 * What it is NOT: imagery. No satellite photographed the deep past, and the
 * finest paleotopography datasets are ~1° (~111 km) per cell. Everything finer
 * than the coastline data here is explicit artistic texture — the UI must say
 * so whenever zoomed past data resolution.
 */

export interface EpochGrid {
  gridW: number; // projection space of the shape ints (e.g. 8000)
  gridH: number;
  shapes: number[][]; // flat [x0,y0,x1,y1,...] rings
}

export interface Viewport {
  lonC: number; // center longitude, degrees
  latC: number; // center latitude, degrees
  lonSpan: number; // viewport width, degrees of longitude
}

// ---------- deterministic noise (stable in world space) ----------

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const sm = (t: number) => t * t * (3 - 2 * t);

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = sm(x - ix);
  const fy = sm(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Anti-aliasing cutoff: octaves whose wavelength falls under ~2 output pixels
// alias into per-pixel speckle (the "TV static" ice caps). Set per render.
let AA_MAX_FREQ = Infinity;

/** 4-octave fBm; freq in cycles per degree. Octaves past the AA cutoff are skipped. */
function fbm(lon: number, lat: number, freq: number, seed: number): number {
  let v = 0;
  let amp = 0.5;
  let f = freq;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    if (f > AA_MAX_FREQ) break;
    v += amp * vnoise(lon * f + 512, lat * f + 512, seed + o);
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return norm > 0 ? (v / norm) * 0.94 : 0.47; // keep the 0..~0.94 scale stable
}

/** Ridged multifractal — sharp crests, reads as mountain ranges. */
function ridged(lon: number, lat: number, freq: number, seed: number): number {
  let v = 0;
  let amp = 0.55;
  let f = freq;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    if (f > AA_MAX_FREQ) break;
    const n = vnoise(lon * f + 907, lat * f + 907, seed + o * 7);
    const r = 1 - Math.abs(2 * n - 1);
    v += amp * r * r;
    norm += amp;
    amp *= 0.5;
    f *= 2.2;
  }
  return norm > 0 ? (v / norm) * 0.96 : 0.4;
}

// ---------- palettes ----------

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const DEEP_OCEAN: RGB = [8, 34, 66];
const ABYSS: RGB = [5, 24, 50];
const SHELF: RGB = [24, 84, 128];
const COASTAL: RGB = [46, 124, 168];
const ICE: RGB = [232, 239, 244];
const SEA_ICE: RGB = [214, 228, 238];
const TUNDRA: RGB = [138, 132, 112];
const BOREAL: RGB = [58, 82, 52];
const FOREST: RGB = [62, 105, 48];
const GRASS: RGB = [148, 158, 88];
const DESERT: RGB = [198, 168, 106];
const SAVANNA: RGB = [138, 148, 74];
const RAINFOREST: RGB = [38, 84, 34];
const BEACH: RGB = [214, 198, 152];
const ROCK: RGB = [128, 112, 96];
const SNOW: RGB = [242, 246, 250];
const RIVER: RGB = [40, 92, 130];

/** Land color from |lat| (with jitter) and moisture noise — climate heuristic. */
function landColor(absLat: number, moisture: number, rough: number): RGB {
  if (absLat > 68) return mix(ICE, TUNDRA, Math.max(0, (72 - absLat) / 8) * 0.4);
  if (absLat > 55) return mix(TUNDRA, BOREAL, moisture);
  if (absLat > 35) return mix(GRASS, FOREST, moisture);
  if (absLat > 12) {
    // subtropics: the desert belt, broken by wetter regions
    return moisture < 0.48 ? mix(DESERT, [178, 148, 92], rough) : mix(SAVANNA, FOREST, (moisture - 0.48) * 2);
  }
  return moisture > 0.4 ? mix(RAINFOREST, FOREST, rough * 0.5) : mix(SAVANNA, GRASS, rough);
}

// ---------- geometry caching ----------

const pathCache = new WeakMap<EpochGrid, Path2D>();

function epochPath(grid: EpochGrid): Path2D {
  let p = pathCache.get(grid);
  if (p) return p;
  p = new Path2D();
  for (const flat of grid.shapes) {
    p.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
    p.closePath();
  }
  pathCache.set(grid, p);
  return p;
}

const lineCache = new WeakMap<EpochGrid, Path2D>();

/** Open polylines (mountain-belt lines) — stroked, never closed. */
function epochLines(grid: EpochGrid): Path2D {
  let p = lineCache.get(grid);
  if (p) return p;
  p = new Path2D();
  for (const flat of grid.shapes) {
    p.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
  }
  lineCache.set(grid, p);
  return p;
}

// ---------- main render ----------

export interface RenderResult {
  kmAcross: number;
}

/**
 * Renders one epoch into `target` at the given viewport. Internally rasterizes
 * at a capped buffer size and upscales — this is what gives the soft
 * "satellite" look and keeps the per-pixel pass fast.
 */
export function renderSatellite(
  target: HTMLCanvasElement,
  grid: EpochGrid,
  view: Viewport,
  epochSeed: number,
  belts?: EpochGrid | null,
): RenderResult {
  const outW = target.width;
  const outH = target.height;
  const bufW = Math.min(960, outW);
  const bufH = Math.round((bufW * outH) / outW);

  const latSpan = view.lonSpan * (bufH / bufW);
  const lonL = view.lonC - view.lonSpan / 2;
  const latT = view.latC + latSpan / 2;
  const degPerPx = view.lonSpan / bufW;

  // --- masks: land fill + shelf halo, drawn in grid space ---
  const scaleX = bufW / ((view.lonSpan / 360) * grid.gridW);
  const gx0 = ((lonL + 180) / 360) * grid.gridW;
  const gy0 = ((90 - latT) / 180) * grid.gridH;

  const mask = document.createElement("canvas");
  mask.width = bufW;
  mask.height = bufH;
  const mctx = mask.getContext("2d", { willReadFrequently: true })!;
  const path = epochPath(grid);
  const degToGrid = grid.gridW / 360;
  // Shelf halo → red channel as a smooth GRADED field (layered strokes with
  // additive blending and round joins — miter joins produce ugly spikes).
  mctx.save();
  mctx.scale(scaleX, scaleX);
  mctx.lineCap = "round";
  mctx.lineJoin = "round";
  mctx.globalCompositeOperation = "lighter";
  for (const [deg, alpha] of [
    [2.4, 0.25],
    [1.2, 0.3],
    [0.5, 0.3],
  ] as const) {
    mctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    mctx.lineWidth = deg * degToGrid;
    // draw three world copies so the antimeridian seam never shows a gap
    for (const off of [-grid.gridW, 0, grid.gridW]) {
      mctx.save();
      mctx.translate(-gx0 + off, -gy0);
      mctx.stroke(path);
      mctx.restore();
    }
  }
  mctx.globalCompositeOperation = "source-over";
  for (const off of [-grid.gridW, 0, grid.gridW]) {
    mctx.save();
    mctx.translate(-gx0 + off, -gy0);
    mctx.fillStyle = "#00ff00";
    mctx.fill(path, "evenodd");
    mctx.restore();
  }
  // mountain-belt proximity → blue channel, layered strokes for a soft field.
  // Belt lines live in their own grid space (8000×4000); scale into the
  // coastline grid so they align even over the low-res fallback.
  if (belts && belts.shapes.length) {
    const lines = epochLines(belts);
    const sf = grid.gridW / belts.gridW;
    const degToBelt = belts.gridW / 360;
    mctx.globalCompositeOperation = "lighter";
    mctx.lineCap = "round";
    mctx.lineJoin = "round";
    for (const [deg, alpha] of [
      [9, 0.1],
      [7, 0.12],
      [5.2, 0.15],
      [3.6, 0.18],
      [2.2, 0.2],
      [1.2, 0.22],
    ] as const) {
      mctx.strokeStyle = `rgba(0,0,255,${alpha})`;
      mctx.lineWidth = deg * degToBelt;
      for (const off of [-grid.gridW, 0, grid.gridW]) {
        mctx.save();
        mctx.translate(-gx0 + off, -gy0);
        mctx.scale(sf, sf);
        mctx.stroke(lines);
        mctx.restore();
      }
    }
    mctx.globalCompositeOperation = "source-over";
  }
  mctx.restore();
  const m = mctx.getImageData(0, 0, bufW, bufH).data;

  // --- per-pixel colorize ---
  const img = new ImageData(bufW, bufH);
  const px = img.data;
  // GEO-ANCHORED frequencies (cycles per degree): the landscape must not
  // shift when the user zooms. Only micro grain scales with the view.
  const fTerrain = 0.9;
  const fMoist = 0.22;
  const fRiver = 0.5;
  const fMicro = Math.min(40, (24 / view.lonSpan) * 5);
  const zoomedIn = view.lonSpan < 90;
  // octaves finer than ~2.5 px would alias into speckle — skip them
  AA_MAX_FREQ = 1 / (2.5 * degPerPx);

  const idxLand = (i: number) => m[i * 4 + 1] > 96; // green channel
  const shelfAt = (i: number) => m[i * 4] / 255; // red channel: 0..1 graded shelf proximity
  const idxBelt = (i: number) => m[i * 4 + 2] / 255; // blue channel: 0..1 mountain-belt proximity

  for (let y = 0; y < bufH; y++) {
    const lat = latT - (y + 0.5) * degPerPx;
    const aLatBase = Math.abs(lat);
    for (let x = 0; x < bufW; x++) {
      const i = y * bufW + x;
      let lon = lonL + (x + 0.5) * degPerPx;
      lon = ((lon + 540) % 360) - 180; // wrap for noise coherence

      const land = idxLand(i);
      let c: RGB;

      if (land) {
        const jitter = (fbm(lon, lat, 0.15, epochSeed + 11) - 0.47) * 10;
        const absLat = aLatBase + jitter;
        // moisture blends a continental-scale field with regional variation so
        // deserts come out patchy, not a uniform latitude stripe
        const moisture =
          0.55 * fbm(lon, lat, 0.07, epochSeed + 29) + 0.45 * fbm(lon, lat, fMoist, epochSeed + 23);
        const rough = fbm(lon, lat, fMicro, epochSeed + 37);
        c = landColor(absLat, moisture, rough);
        // continent-scale albedo variation — real land is not one flat tone
        const albedo = 0.93 + 0.14 * fbm(lon, lat, 0.05, epochSeed + 41);
        c = [c[0] * albedo, c[1] * albedo, c[2] * albedo];

        // elevation: base rolling terrain + ridged ranges amplified near
        // convergent plate boundaries (where the model says mountains grew).
        // smoothstep on the belt field hides the stroke-layer quantization.
        const beltRaw = idxBelt(i);
        const belt = beltRaw * beltRaw * (3 - 2 * beltRaw);
        const ridge = ridged(lon, lat, fTerrain * 0.8, epochSeed + 91);
        const elev = fbm(lon, lat, fTerrain, epochSeed + 5) * 0.5 + ridge * (0.18 + 0.62 * belt);

        // high ground: fade grass/forest into rock, then snow — only the
        // crests go white, not whole belts. The snowline drops poleward.
        const rockFrom = 0.5;
        if (elev > rockFrom) c = mix(c, ROCK, Math.min(1, (elev - rockFrom) / 0.28));
        const snowline = 0.92 - (Math.min(Math.abs(lat), 90) / 90) * 0.3;
        if (elev > snowline) c = mix(c, SNOW, Math.min(1, (elev - snowline) / 0.16));

        // hillshade from the heightfield gradient (NW light). Slope is taken
        // per-degree and normalized by the sample step, so relief stays
        // strong and consistent at every zoom; belts get extra drama.
        const e = Math.max(0.12, degPerPx * 1.5);
        const hAt = (lo: number, la: number) =>
          fbm(lo, la, fTerrain, epochSeed + 5) * 0.5 +
          ridged(lo, la, fTerrain * 0.8, epochSeed + 91) * (0.18 + 0.85 * belt);
        const slope = (hAt(lon + e, lat) - elev + (hAt(lon, lat - e) - elev)) / e;
        const shade = 1 + slope * (0.55 + 0.6 * belt);
        const s = Math.max(0.55, Math.min(1.35, shade));
        c = [c[0] * s, c[1] * s, c[2] * s];
        // hypsometric lift: higher ground reads slightly lighter/warmer
        c = [c[0] * (0.94 + 0.18 * elev), c[1] * (0.94 + 0.15 * elev), c[2] * (0.94 + 0.1 * elev)];

        // rivers: meandering threads across humid low ground — only visible
        // once zoomed in, thin and translucent (artistic, labeled as such)
        if (zoomedIn && moisture > 0.4 && elev < snowline && absLat < 70) {
          const warp = fbm(lon, lat, fRiver * 0.4, epochSeed + 101) * 2.0;
          const q = fbm(lon + warp, lat - warp, fRiver, epochSeed + 113);
          const dRiver = Math.abs(q - 0.5);
          const width = 0.0035 + 0.006 * Math.max(0, 0.45 - elev);
          if (dRiver < width) {
            const t = 1 - dRiver / width;
            c = mix(c, RIVER, 0.55 * t);
          }
        }

        // beach: a subtle 1px shoreline tint, only when zoomed in — at world
        // view a "beach" would be an 80 km-wide halo
        if (zoomedIn) {
          const n = i - bufW;
          const sIdx = i + bufW;
          const touchingOcean =
            (x > 0 && !idxLand(i - 1)) ||
            (x < bufW - 1 && !idxLand(i + 1)) ||
            (n >= 0 && !idxLand(n)) ||
            (sIdx < bufW * bufH && !idxLand(sIdx));
          if (touchingOcean) c = mix(c, BEACH, 0.4);
        }
      } else {
        // ocean: deep tone with slow basin variation, brightening smoothly
        // across the graded shelf toward the coast
        const depthN = fbm(lon, lat, 0.25, epochSeed + 51);
        c = mix(DEEP_OCEAN, ABYSS, depthN);
        const shelf = shelfAt(i);
        if (shelf > 0.02) {
          const sh = Math.pow(Math.min(1, shelf * 1.1), 0.8) * 0.85;
          const tone = fbm(lon, lat, fMoist, epochSeed + 63);
          c = mix(c, mix(SHELF, COASTAL, tone * 0.7), sh);
        }
        // sea ice: solid cap with a slow, wide-wavelength edge — not speckle
        if (aLatBase > 58) {
          const edge = (fbm(lon, lat, 0.12, epochSeed + 77) - 0.5) * 10;
          const t = (aLatBase - (68 + edge)) / 5;
          if (t > 0) c = mix(c, SEA_ICE, Math.min(1, t));
        }
      }

      const o = i * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    }
  }

  // --- upscale to target with smoothing (soft satellite feel) ---
  const buf = document.createElement("canvas");
  buf.width = bufW;
  buf.height = bufH;
  buf.getContext("2d")!.putImageData(img, 0, 0);
  const ctx = target.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(buf, 0, 0, outW, outH);

  const kmAcross = view.lonSpan * 111.32 * Math.cos((view.latC * Math.PI) / 180);
  return { kmAcross: Math.abs(kmAcross) };
}
