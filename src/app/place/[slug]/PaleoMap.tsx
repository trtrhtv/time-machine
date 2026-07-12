"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface CoastlineData {
  model: string;
  width: number;
  height: number;
  epochsMa: number[];
  epochs: Record<string, number[][]>;
}

interface FullEpochData {
  model: string;
  width: number;
  height: number;
  ma: number;
  shapes: number[][];
}

interface Props {
  epochMa: number;
  epochsMa: number[];
  pinLat: number | null;
  pinLon: number | null;
  modernLat: number;
  modernLon: number;
  placeName: string;
  playing: boolean;
}

type Mode = "world" | "local";
type Frame = "follow" | "fixed";

// Local view window, in degrees (2:1 like the projection).
const WIN_LON = 40;
const WIN_LAT = 20;

// Full-res grid (must match scripts/build-paleomap.ts FULL level).
const FW = 8000;
const FH = 4000;

// Latitude climate bands behind the ocean.
const OCEAN_BANDS = [
  { from: 90, to: 55, fill: "#7dd3fc" },
  { from: 55, to: 23.5, fill: "#86efac" },
  { from: 23.5, to: -23.5, fill: "#fde68a" },
  { from: -23.5, to: -55, fill: "#86efac" },
  { from: -55, to: -90, fill: "#7dd3fc" },
];

// Stylized land coloring by latitude — a first-order climate heuristic
// (ice/tundra, temperate green, desert belt, tropical green), NOT measured
// terrain. Labeled as such in the UI honesty note.
const LAND_BANDS = [
  { from: 90, to: 55, fill: "#e6ecf0" },
  { from: 55, to: 35, fill: "#8fae7a" },
  { from: 35, to: 15, fill: "#d4b877" },
  { from: 15, to: -15, fill: "#4e8a4e" },
  { from: -15, to: -35, fill: "#d4b877" },
  { from: -35, to: -55, fill: "#8fae7a" },
  { from: -55, to: -90, fill: "#e6ecf0" },
];

function pathsFromShapes(shapes: number[][]): string {
  return shapes
    .map((flat) => {
      let d = `M${flat[0]} ${flat[1]}`;
      for (let i = 2; i < flat.length; i += 2) d += `L${flat[i]} ${flat[i + 1]}`;
      return d + "Z";
    })
    .join("");
}

function useCoastlines(url: string, enabled: boolean) {
  const [data, setData] = useState<CoastlineData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || data || failed) return;
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: CoastlineData) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url, enabled, data, failed]);
  return { data, failed };
}

/** Lazy per-epoch full-resolution paths; prefetches everything during play. */
function useFullPaths(epochMa: number, epochsMa: number[], enabled: boolean, prefetchAll: boolean) {
  const [paths, setPaths] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const wanted = prefetchAll ? epochsMa.map(String) : [String(epochMa)];
    for (const ma of wanted) {
      if (paths[ma] || inFlight.current.has(ma)) continue;
      inFlight.current.add(ma);
      fetch(`/paleomap/coastlines-full-${ma}.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: FullEpochData) =>
          setPaths((prev) => ({ ...prev, [ma]: pathsFromShapes(d.shapes) })),
        )
        .catch(() => inFlight.current.delete(ma));
    }
  }, [enabled, prefetchAll, epochMa, epochsMa, paths]);

  return paths;
}

export function PaleoMap({
  epochMa,
  epochsMa,
  pinLat,
  pinLon,
  modernLat,
  modernLon,
  placeName,
  playing,
}: Props) {
  const t = useTranslations("Place");
  const [mode, setMode] = useState<Mode>("world");
  const [frame, setFrame] = useState<Frame>("follow");
  const hasPin = pinLat != null && pinLon != null;
  const local = mode === "local";

  const world = useCoastlines("/paleomap/coastlines.json", true);
  const fullPaths = useFullPaths(epochMa, epochsMa, local, local && playing);

  const worldPaths = useMemo(() => {
    if (!world.data) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [ma, shapes] of Object.entries(world.data.epochs)) out[ma] = pathsFromShapes(shapes);
    return out;
  }, [world.data]);

  // All geometry is rendered in the FULL 8000×4000 space; the world-level
  // fallback (1000×500) is scaled up 8× until the full-res epoch arrives.
  const W = FW;
  const H = FH;
  const projX = (lon: number) => ((lon + 180) / 360) * W;
  const projY = (lat: number) => ((90 - lat) / 180) * H;

  const fullPath = fullPaths[String(epochMa)];
  const fallbackPath = worldPaths[String(epochMa)] ?? "";
  const upscaling = local && !fullPath;
  const landPath = local ? (fullPath ?? fallbackPath) : fallbackPath;
  const landScale = local && fullPath ? 1 : 8;

  // Camera center: follow the drifting ground, or stand at today's fixed
  // coordinates while the world moves through them.
  const centerLat = frame === "fixed" || !hasPin ? modernLat : pinLat!;
  const centerLon = frame === "fixed" || !hasPin ? modernLon : pinLon!;

  const winW = (WIN_LON / 360) * W;
  const winH = (WIN_LAT / 180) * H;
  const viewBox = local ? `0 0 ${winW} ${winH}` : `0 0 ${W} ${H}`;
  const mapShift = local
    ? `translate(${winW / 2 - projX(centerLon)}px, ${winH / 2 - projY(centerLat)}px)`
    : "translate(0px, 0px)";

  const kmPerLonDeg = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const bar500px = (500 / Math.max(kmPerLonDeg, 1) / 360) * W;

  const loading = !world.data && !world.failed;
  const clipId = "landclip";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-3xl border border-black/10 bg-[#0b1a2b] dark:border-white/10">
        <svg
          viewBox={viewBox}
          className="block w-full"
          role="img"
          aria-label={`Reconstructed map at ${epochMa} million years ago, with ${placeName} marked`}
        >
          <defs>
            <clipPath id={clipId}>
              {landPath && <path d={landPath} transform={`scale(${landScale})`} fillRule="evenodd" />}
            </clipPath>
            {/* Subtle grain so land reads as ground, not flat fill. */}
            <filter id="grain">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" />
              <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.35 0.35 0.35 0 0" />
              <feComposite operator="over" in2="SourceGraphic" />
            </filter>
          </defs>

          <g style={{ transform: mapShift, transition: "transform 900ms cubic-bezier(.4,0,.2,1)" }}>
            {/* ocean climate bands */}
            <g opacity={0.22}>
              {OCEAN_BANDS.map((b, i) => (
                <rect key={i} x={0} y={projY(b.from)} width={W} height={projY(b.to) - projY(b.from)} fill={b.fill} />
              ))}
            </g>
            {/* graticule */}
            <g stroke="#ffffff" strokeOpacity={0.18} strokeWidth={local ? 2 : 8}>
              <line x1={0} y1={projY(0)} x2={W} y2={projY(0)} strokeOpacity={0.35} />
              {[23.5, -23.5, 55, -55].map((lat) => (
                <line key={lat} x1={0} y1={projY(lat)} x2={W} y2={projY(lat)} strokeDasharray="32 48" />
              ))}
            </g>
            {/* land: climate-banded fill clipped to the coastline polygons */}
            {landPath && (
              <>
                <g clipPath={`url(#${clipId})`}>
                  {LAND_BANDS.map((b, i) => (
                    <rect key={i} x={0} y={projY(b.from)} width={W} height={projY(b.to) - projY(b.from)} fill={b.fill} />
                  ))}
                  <rect x={0} y={0} width={W} height={H} fill="#000" opacity={0.06} filter="url(#grain)" />
                </g>
                <path
                  d={landPath}
                  transform={`scale(${landScale})`}
                  fill="none"
                  stroke="#6b5a3e"
                  strokeWidth={(local ? 2.5 : 5) / landScale}
                  fillRule="evenodd"
                />
              </>
            )}
            {/* world view: drifting pin */}
            {!local && hasPin && (
              <g
                style={{
                  transform: `translate(${projX(pinLon!)}px, ${projY(pinLat!)}px)`,
                  transition: "transform 900ms cubic-bezier(.4,0,.2,1)",
                }}
              >
                <circle r={120} fill="#ef4444" opacity={0.25}>
                  <animate attributeName="r" values="90;150;90" dur="2.4s" repeatCount="indefinite" />
                </circle>
                <circle r={45} fill="#ef4444" stroke="#fff" strokeWidth={16} />
              </g>
            )}
            {/* local + follow frame: ghost marker of today's coordinates when nearby */}
          </g>

          {/* local view: center-fixed pin — you stand here */}
          {local && (
            <g transform={`translate(${winW / 2}, ${winH / 2})`}>
              <circle r={winW / 28} fill="#ef4444" opacity={0.25}>
                <animate attributeName="r" values={`${winW / 36};${winW / 22};${winW / 36}`} dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle r={winW / 70} fill="#ef4444" stroke="#fff" strokeWidth={winW / 220} />
            </g>
          )}
          {/* scale bar (local) */}
          {local && (
            <g transform={`translate(${winW - bar500px - winW * 0.04}, ${winH * 0.93})`} stroke="#fff" strokeWidth={winW / 300}>
              <line x1={0} y1={0} x2={bar500px} y2={0} />
              <line x1={0} y1={-winH * 0.012} x2={0} y2={winH * 0.012} />
              <line x1={bar500px} y1={-winH * 0.012} x2={bar500px} y2={winH * 0.012} />
              <text x={bar500px / 2} y={-winH * 0.025} fill="#fff" stroke="none" textAnchor="middle" fontSize={winH * 0.05}>
                500 km
              </text>
            </g>
          )}
        </svg>

        <span className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/55 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
          {epochMa} million years ago
        </span>
        {upscaling && (
          <span className="pointer-events-none absolute right-4 top-3 rounded-full bg-black/45 px-3 py-1 text-xs text-white/80 backdrop-blur">
            {t("mapSharpening")}
          </span>
        )}

        {world.failed && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            {t("mapUnavailable")}
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
            {t("mapLoading")}
          </div>
        )}
      </div>

      {/* View + frame toggles, honesty note */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-full border border-black/15 text-sm dark:border-white/15">
          <button
            type="button"
            onClick={() => setMode("world")}
            className={`px-4 py-1.5 ${mode === "world" ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
          >
            {t("viewWorld")}
          </button>
          <button
            type="button"
            onClick={() => setMode("local")}
            className={`px-4 py-1.5 ${mode === "local" ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
          >
            {t("viewLocal")}
          </button>
        </div>
        {local && (
          <div className="flex overflow-hidden rounded-full border border-black/15 text-sm dark:border-white/15">
            <button
              type="button"
              onClick={() => setFrame("follow")}
              disabled={!hasPin}
              className={`px-4 py-1.5 disabled:opacity-40 ${frame === "follow" && hasPin ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
            >
              {t("frameFollow")}
            </button>
            <button
              type="button"
              onClick={() => setFrame("fixed")}
              className={`px-4 py-1.5 ${frame === "fixed" || !hasPin ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
            >
              {t("frameFixed")}
            </button>
          </div>
        )}
      </div>
      {local && (
        <p className="text-xs text-black/50 dark:text-white/50">
          {frame === "fixed" ? t("frameFixedNote") : t("localHonesty")} {t("landColorNote")}
        </p>
      )}
    </div>
  );
}
