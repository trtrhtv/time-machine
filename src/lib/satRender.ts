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

/** 4-octave fBm; freq in cycles per degree. */
function fbm(lon: number, lat: number, freq: number, seed: number): number {
  let v = 0;
  let amp = 0.5;
  let f = freq;
  for (let o = 0; o < 4; o++) {
    v += amp * vnoise(lon * f + 512, lat * f + 512, seed + o);
    amp *= 0.5;
    f *= 2.1;
  }
  return v; // ~0..0.94
}

/** Ridged multifractal — sharp crests, reads as mountain ranges. */
function ridged(lon: number, lat: number, freq: number, seed: number): number {
  let v = 0;
  let amp = 0.55;
  let f = freq;
  for (let o = 0; o < 3; o++) {
    const n = vnoise(lon * f + 907, lat * f + 907, seed + o * 7);
    const r = 1 - Math.abs(2 * n - 1);
    v += amp * r * r;
    amp *= 0.5;
    f *= 2.2;
  }
  return v; // ~0..1
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
  // shelf halo: land stroked wide, in red channel; land fill in green channel.
  mctx.save();
  mctx.scale(scaleX, scaleX);
  // draw three world copies so the antimeridian seam never shows a gap
  for (const off of [-grid.gridW, 0, grid.gridW]) {
    mctx.save();
    mctx.translate(-gx0 + off, -gy0);
    mctx.strokeStyle = "#ff0000";
    mctx.lineWidth = Math.max(2 / scaleX, 0.9 / degPerPx / scaleX * 0.9); // ~0.9° shelf
    mctx.stroke(path);
    mctx.restore();
  }
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
      [7, 0.3],
      [3.5, 0.45],
      [1.5, 0.7],
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
  // noise frequencies scale with zoom so detail is always present
  const fTerrain = 3 / view.lonSpan * 24; // ~24 features across the view
  const fMoist = Math.max(0.15, (3 / view.lonSpan) * 6);
  const fMicro = fTerrain * 5;

  const idxLand = (i: number) => m[i * 4 + 1] > 96; // green channel
  const idxShelf = (i: number) => m[i * 4] > 40; // red channel
  const idxBelt = (i: number) => m[i * 4 + 2] / 255; // blue channel: 0..1 mountain-belt proximity
  const fRiver = fTerrain * 0.55;

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
        const jitter = (fbm(lon, lat, 0.35, epochSeed + 11) - 0.47) * 9;
        const absLat = aLatBase + jitter;
        const moisture = fbm(lon, lat, fMoist, epochSeed + 23);
        const rough = fbm(lon, lat, fMicro, epochSeed + 37);
        c = landColor(absLat, moisture, rough);

        // elevation: base rolling terrain + ridged ranges amplified near
        // convergent plate boundaries (where the model says mountains grew)
        const belt = idxBelt(i);
        const ridge = ridged(lon, lat, fTerrain * 0.8, epochSeed + 91);
        const elev = fbm(lon, lat, fTerrain, epochSeed + 5) * 0.5 + ridge * (0.18 + 0.85 * belt);

        // high ground: fade grass/forest into rock, then snow. The snowline
        // drops toward the poles.
        const rockFrom = 0.52;
        if (elev > rockFrom) c = mix(c, ROCK, Math.min(1, (elev - rockFrom) / 0.22));
        const snowline = 0.8 - (Math.min(Math.abs(lat), 90) / 90) * 0.28;
        if (elev > snowline) c = mix(c, SNOW, Math.min(1, (elev - snowline) / 0.1));

        // hillshade from the full heightfield gradient (NW light), stronger
        // relief inside mountain belts
        const e = 0.35 / fTerrain;
        const hAt = (lo: number, la: number) =>
          fbm(lo, la, fTerrain, epochSeed + 5) * 0.5 +
          ridged(lo, la, fTerrain * 0.8, epochSeed + 91) * (0.18 + 0.85 * belt);
        const hx = hAt(lon + e, lat) - elev;
        const hy = hAt(lon, lat - e) - elev;
        const shade = 1 + (hx + hy) * (2.2 + 2.5 * belt);
        const s = Math.max(0.62, Math.min(1.25, shade));
        c = [c[0] * s, c[1] * s, c[2] * s];

        // rivers: meandering contour threads of a domain-warped field,
        // only across humid low ground — artistic, labeled as such
        if (moisture > 0.34 && elev < snowline && absLat < 70) {
          const warp = fbm(lon, lat, fRiver * 0.5, epochSeed + 101) * 2.4;
          const q = fbm(lon + warp, lat - warp, fRiver, epochSeed + 113);
          const dRiver = Math.abs(q - 0.5);
          const width = 0.004 + 0.01 * Math.max(0, 0.5 - elev);
          if (dRiver < width) {
            const t = 1 - dRiver / width;
            c = mix(c, RIVER, 0.75 * t);
          }
        }

        // beach: land pixel whose 2px neighborhood touches ocean
        const n = i - 2 * bufW;
        const sIdx = i + 2 * bufW;
        const touchingOcean =
          (x > 1 && !idxLand(i - 2)) ||
          (x < bufW - 2 && !idxLand(i + 2)) ||
          (n >= 0 && !idxLand(n)) ||
          (sIdx < bufW * bufH && !idxLand(sIdx));
        if (touchingOcean) c = mix(c, BEACH, 0.65);
      } else {
        const depthN = fbm(lon, lat, fTerrain * 0.6, epochSeed + 51);
        c = mix(DEEP_OCEAN, ABYSS, depthN);
        if (idxShelf(i)) {
          const t = fbm(lon, lat, fMicro * 0.6, epochSeed + 63);
          c = mix(SHELF, COASTAL, t * 0.8);
        }
        // sea ice near the poles
        if (aLatBase > 66) {
          const icy = fbm(lon, lat, fTerrain, epochSeed + 77);
          const amt = Math.min(1, (aLatBase - 66) / 8 + (icy - 0.5));
          if (amt > 0) c = mix(c, SEA_ICE, Math.min(1, amt));
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
