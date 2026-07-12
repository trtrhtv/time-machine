"use client";

import { useEffect, useMemo, useState } from "react";

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

// Equirectangular, matching scripts/build-paleomap.ts (W=1000, H=500).
const W = 1000;
const H = 500;
const projX = (lon: number) => ((lon + 180) / 360) * W;
const projY = (lat: number) => ((90 - lat) / 180) * H;

// Latitude climate bands (drawn faint behind the ocean) so you can *see* the
// pin cross from polar → temperate → tropical as it drifts.
const bandY = (lat: number) => projY(lat);
const BANDS = [
  { from: 90, to: 55, fill: "#7dd3fc" }, // polar N
  { from: 55, to: 23.5, fill: "#86efac" }, // temperate N
  { from: 23.5, to: -23.5, fill: "#fde68a" }, // tropical
  { from: -23.5, to: -55, fill: "#86efac" }, // temperate S
  { from: -55, to: -90, fill: "#7dd3fc" }, // polar S
];

export function PaleoMap({ epochMa, pinLat, pinLon, placeName }: Props) {
  const [data, setData] = useState<CoastlineData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/paleomap/coastlines.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: CoastlineData) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // One combined SVG path per epoch (all land as subpaths) — light to render
  // and cheap to swap while scrubbing.
  const paths = useMemo(() => {
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

  const landPath = paths[String(epochMa)] ?? "";
  const hasPin = pinLat != null && pinLon != null;
  const px = hasPin ? projX(pinLon!) : 0;
  const py = hasPin ? projY(pinLat!) : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-black/10 bg-[#0b1a2b] dark:border-white/10">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img"
        aria-label={`Reconstructed world map at ${epochMa} million years ago, with ${placeName} marked`}>
        {/* climate latitude bands */}
        <g opacity={0.22}>
          {BANDS.map((b, i) => (
            <rect key={i} x={0} y={bandY(b.from)} width={W} height={bandY(b.to) - bandY(b.from)} fill={b.fill} />
          ))}
        </g>
        {/* graticule: equator + tropics + polar circles */}
        <g stroke="#ffffff" strokeOpacity={0.18} strokeWidth={1}>
          <line x1={0} y1={projY(0)} x2={W} y2={projY(0)} strokeOpacity={0.35} />
          {[23.5, -23.5, 55, -55].map((lat) => (
            <line key={lat} x1={0} y1={projY(lat)} x2={W} y2={projY(lat)} strokeDasharray="4 6" />
          ))}
        </g>
        {/* land */}
        {landPath && <path d={landPath} fill="#c8b48a" stroke="#8a7654" strokeWidth={0.6} fillRule="evenodd" />}
        {/* pin */}
        {hasPin && (
          <g style={{ transform: `translate(${px}px, ${py}px)`, transition: "transform 600ms cubic-bezier(.4,0,.2,1)" }}>
            <circle r={16} fill="#ef4444" opacity={0.25}>
              <animate attributeName="r" values="12;20;12" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle r={6} fill="#ef4444" stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>

      {/* epoch badge */}
      <span className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/55 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
        {epochMa} million years ago
      </span>

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
          Map data unavailable
        </div>
      )}
      {!data && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
          Loading the ancient world…
        </div>
      )}
    </div>
  );
}
