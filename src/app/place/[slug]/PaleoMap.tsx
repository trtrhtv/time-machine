"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

interface CoastlineData {
  model: string;
  width: number;
  height: number;
  epochsMa: number[];
  epochs: Record<string, number[][]>;
}

interface Props {
  epochMa: number;
  pinLat: number | null;
  pinLon: number | null;
  placeName: string;
}

type Mode = "world" | "local";

// Local view window, in degrees (2:1 like the projection).
const WIN_LON = 40;
const WIN_LAT = 20;

// Latitude climate bands (drawn faint behind the ocean) so you can *see* the
// pin cross from polar → temperate → tropical as it drifts.
const BANDS = [
  { from: 90, to: 55, fill: "#7dd3fc" }, // polar N
  { from: 55, to: 23.5, fill: "#86efac" }, // temperate N
  { from: 23.5, to: -23.5, fill: "#fde68a" }, // tropical
  { from: -23.5, to: -55, fill: "#86efac" }, // temperate S
  { from: -55, to: -90, fill: "#7dd3fc" }, // polar S
];

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

/** One combined SVG path per epoch — light to render, cheap to swap. */
function usePaths(data: CoastlineData | null) {
  return useMemo(() => {
    if (!data) return {};
    const out: Record<string, string> = {};
    for (const [ma, shapes] of Object.entries(data.epochs)) {
      out[ma] = shapes
        .map((flat) => {
          let d = `M${flat[0]} ${flat[1]}`;
          for (let i = 2; i < flat.length; i += 2) d += `L${flat[i]} ${flat[i + 1]}`;
          return d + "Z";
        })
        .join("");
    }
    return out;
  }, [data]);
}

export function PaleoMap({ epochMa, pinLat, pinLon, placeName }: Props) {
  const t = useTranslations("Place");
  const [mode, setMode] = useState<Mode>("world");
  const hasPin = pinLat != null && pinLon != null;
  const local = mode === "local" && hasPin;

  const world = useCoastlines("/paleomap/coastlines.json", true);
  const hd = useCoastlines("/paleomap/coastlines-hd.json", mode === "local");
  const worldPaths = usePaths(world.data);
  const hdPaths = usePaths(hd.data);

  const data = local ? hd.data : world.data;
  const paths = local ? hdPaths : worldPaths;
  const landPath = paths[String(epochMa)] ?? "";
  const W = data?.width ?? 1000;
  const H = data?.height ?? 500;
  const projX = (lon: number) => ((lon + 180) / 360) * W;
  const projY = (lat: number) => ((90 - lat) / 180) * H;

  // World view: fixed viewBox, pin drifts. Local view: viewBox is a window and
  // the whole map slides under a center-fixed pin ("stay on the spot").
  const winW = (WIN_LON / 360) * W;
  const winH = (WIN_LAT / 180) * H;
  const viewBox = local ? `0 0 ${winW} ${winH}` : `0 0 ${W} ${H}`;
  const mapShift = local
    ? `translate(${winW / 2 - projX(pinLon!)}px, ${winH / 2 - projY(pinLat!)}px)`
    : "translate(0px, 0px)";
  const px = hasPin ? projX(pinLon!) : 0;
  const py = hasPin ? projY(pinLat!) : 0;

  // Honest scale bar for the local view: km per degree of longitude shrinks
  // with latitude.
  const kmPerLonDeg = 111.32 * Math.cos(((pinLat ?? 0) * Math.PI) / 180);
  const bar500px = (500 / Math.max(kmPerLonDeg, 1) / 360) * W; // 500 km in projected units

  const loading = local ? !hd.data && !hd.failed : !world.data && !world.failed;
  const failed = local ? hd.failed : world.failed;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-3xl border border-black/10 bg-[#0b1a2b] dark:border-white/10">
        <svg
          viewBox={viewBox}
          className="block w-full"
          role="img"
          aria-label={`Reconstructed map at ${epochMa} million years ago, with ${placeName} marked`}
        >
          {/* Everything geographic lives in one group so the local view can
              slide the world under the pin with a smooth transition. */}
          <g style={{ transform: mapShift, transition: "transform 600ms cubic-bezier(.4,0,.2,1)" }}>
            <g opacity={0.22}>
              {BANDS.map((b, i) => (
                <rect key={i} x={0} y={projY(b.from)} width={W} height={projY(b.to) - projY(b.from)} fill={b.fill} />
              ))}
            </g>
            <g stroke="#ffffff" strokeOpacity={0.18} strokeWidth={local ? W / 2000 : 1}>
              <line x1={0} y1={projY(0)} x2={W} y2={projY(0)} strokeOpacity={0.35} />
              {[23.5, -23.5, 55, -55].map((lat) => (
                <line key={lat} x1={0} y1={projY(lat)} x2={W} y2={projY(lat)} strokeDasharray="4 6" />
              ))}
            </g>
            {landPath && (
              <path
                d={landPath}
                fill="#c8b48a"
                stroke="#8a7654"
                strokeWidth={local ? W / 4000 : 0.6}
                fillRule="evenodd"
              />
            )}
            {/* In world view the pin lives inside the sliding group and drifts. */}
            {!local && hasPin && (
              <g style={{ transform: `translate(${px}px, ${py}px)`, transition: "transform 600ms cubic-bezier(.4,0,.2,1)" }}>
                <circle r={16} fill="#ef4444" opacity={0.25}>
                  <animate attributeName="r" values="12;20;12" dur="2.4s" repeatCount="indefinite" />
                </circle>
                <circle r={6} fill="#ef4444" stroke="#fff" strokeWidth={2} />
              </g>
            )}
          </g>
          {/* In local view the pin is fixed dead-center; the world moves. */}
          {local && (
            <g transform={`translate(${winW / 2}, ${winH / 2})`}>
              <circle r={winW / 28} fill="#ef4444" opacity={0.25}>
                <animate attributeName="r" values={`${winW / 36};${winW / 22};${winW / 36}`} dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle r={winW / 70} fill="#ef4444" stroke="#fff" strokeWidth={winW / 220} />
            </g>
          )}
          {/* Scale bar (local view only) */}
          {local && (
            <g transform={`translate(${winW - bar500px - winW * 0.04}, ${winH * 0.93})`} stroke="#fff" strokeWidth={winW / 300}>
              <line x1={0} y1={0} x2={bar500px} y2={0} />
              <line x1={0} y1={-winH * 0.012} x2={0} y2={winH * 0.012} />
              <line x1={bar500px} y1={-winH * 0.012} x2={bar500px} y2={winH * 0.012} />
              <text
                x={bar500px / 2}
                y={-winH * 0.025}
                fill="#fff"
                stroke="none"
                textAnchor="middle"
                fontSize={winH * 0.05}
              >
                500 km
              </text>
            </g>
          )}
        </svg>

        <span className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/55 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
          {epochMa} million years ago
        </span>

        {failed && (
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

      {/* View toggle + honesty note */}
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
            disabled={!hasPin}
            className={`px-4 py-1.5 disabled:opacity-40 ${mode === "local" ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
          >
            {t("viewLocal")}
          </button>
        </div>
        {local && (
          <p className="text-xs text-black/50 dark:text-white/50">{t("localHonesty")}</p>
        )}
      </div>
    </div>
  );
}
