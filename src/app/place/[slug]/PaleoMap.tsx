"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { renderSatellite, type EpochGrid, type Viewport } from "@/lib/satRender";

interface WorldFile {
  width: number;
  height: number;
  epochs: Record<string, number[][]>;
}
interface FullFile {
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

type Lock = "follow" | "fixed" | "free";

const MIN_SPAN = 3; // deg — deepest zoom (~330 km across at the equator)
const MAX_SPAN = 360;
const DATA_LIMIT_SPAN = 12; // below this we are clearly past data resolution

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // --- data: low-res whole file + full-res per-epoch files ---
  const [worldGrids, setWorldGrids] = useState<Record<string, EpochGrid>>({});
  const [fullGrids, setFullGrids] = useState<Record<string, EpochGrid>>({});
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    fetch("/paleomap/coastlines.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: WorldFile) => {
        const grids: Record<string, EpochGrid> = {};
        for (const [ma, shapes] of Object.entries(d.epochs))
          grids[ma] = { gridW: d.width, gridH: d.height, shapes };
        setWorldGrids(grids);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    const wanted = playing ? epochsMa.map(String) : [String(epochMa)];
    for (const ma of wanted) {
      if (fullGrids[ma] || inFlight.current.has(ma)) continue;
      inFlight.current.add(ma);
      fetch(`/paleomap/coastlines-full-${ma}.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: FullFile) =>
          setFullGrids((prev) => ({ ...prev, [ma]: { gridW: d.width, gridH: d.height, shapes: d.shapes } })),
        )
        .catch(() => inFlight.current.delete(ma));
    }
  }, [epochMa, epochsMa, playing, fullGrids]);

  // --- viewport state ---
  // In "follow"/"fixed" the camera center is DERIVED from props each render
  // (so epoch changes re-center automatically); free-pan state only applies
  // in "free" mode.
  const hasPin = pinLat != null && pinLon != null;
  const [lock, setLock] = useState<Lock>("follow");
  const [freeView, setFreeView] = useState<Viewport>({ lonC: 0, latC: 0, lonSpan: 360 });
  const [span, setSpan] = useState(360);
  const [kmAcross, setKmAcross] = useState<number | null>(null);

  const view: Viewport = useMemo(
    () =>
      lock === "follow" && hasPin
        ? { lonC: pinLon!, latC: pinLat!, lonSpan: span }
        : lock === "fixed"
          ? { lonC: modernLon, latC: modernLat, lonSpan: span }
          : { ...freeView, lonSpan: span },
    [lock, hasPin, pinLon, pinLat, modernLon, modernLat, freeView, span],
  );

  const grid = fullGrids[String(epochMa)] ?? worldGrids[String(epochMa)] ?? null;
  const sharpening = !fullGrids[String(epochMa)] && !!worldGrids[String(epochMa)];

  // --- render loop (debounced to animation frames) ---
  const renderPending = useRef(false);
  const draw = useCallback(() => {
    if (renderPending.current) return;
    renderPending.current = true;
    requestAnimationFrame(() => {
      renderPending.current = false;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap || !grid) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.round(wrap.clientWidth * dpr);
      const h = Math.round(w / 2);
      if (canvas.width !== w) {
        canvas.width = w;
        canvas.height = h;
      }
      const res = renderSatellite(canvas, grid, view, epochMa);
      setKmAcross(res.kmAcross);
      // pin overlay: drawn straight onto the canvas after the raster
      const ctx = canvas.getContext("2d")!;
      const latSpan = view.lonSpan * (h / w);
      const drawPin = (lon: number, lat: number, fill: string) => {
        let dLon = lon - view.lonC;
        dLon = ((dLon + 540) % 360) - 180;
        const x = w / 2 + (dLon / view.lonSpan) * w;
        const y = h / 2 - ((lat - view.latC) / latSpan) * h;
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) return;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(5, w / 160), 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.5, w / 340), 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1.2, w / 800);
        ctx.fill();
        ctx.stroke();
      };
      if (hasPin) drawPin(pinLon!, pinLat!, "#ef4444");
      if (lock === "fixed") drawPin(modernLon, modernLat, "#38bdf8");
    });
  }, [grid, view, epochMa, hasPin, pinLat, pinLon, lock, modernLat, modernLon]);

  useEffect(draw, [draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // --- interactions: drag to pan, wheel/buttons to zoom ---
  const dragRef = useRef<{ x: number; y: number; lonC: number; latC: number } | null>(null);

  const wrapLon = (lon: number) => ((lon + 540) % 360) - 180;
  const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat));
  const clampSpan = (s: number) => Math.max(MIN_SPAN, Math.min(MAX_SPAN, s));

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    // A drag breaks any lock — seed free-pan from the current derived center.
    dragRef.current = { x: e.clientX, y: e.clientY, lonC: view.lonC, latC: view.latC };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    const canvas = canvasRef.current;
    if (!d || !canvas) return;
    const degPerCss = view.lonSpan / canvas.clientWidth;
    setLock("free");
    setFreeView({
      lonC: wrapLon(d.lonC - (e.clientX - d.x) * degPerCss),
      latC: clampLat(d.latC + (e.clientY - d.y) * degPerCss),
      lonSpan: span,
    });
  }
  function onPointerUp() {
    dragRef.current = null;
  }
  const zoomBy = useCallback((factor: number) => {
    setSpan((s) => clampSpan(s * factor));
  }, []);
  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    zoomBy(e.deltaY > 0 ? 1.25 : 0.8);
  }
  function recenter(target: Lock) {
    setLock(target);
    if (target !== "free") setSpan((s) => Math.min(s, 40));
  }

  const zoomedPastData = view.lonSpan < DATA_LIMIT_SPAN;
  const loading = !grid && !failed;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-3xl border border-black/10 bg-[#08192e] dark:border-white/10"
      >
        <canvas
          ref={canvasRef}
          className="block w-full cursor-grab touch-none active:cursor-grabbing"
          style={{ aspectRatio: "2 / 1" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          role="img"
          aria-label={`Satellite-style reconstruction at ${epochMa} million years ago, with ${placeName} marked`}
        />

        <span className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/55 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
          {epochMa} million years ago
          {kmAcross != null && ` · ${Math.round(kmAcross).toLocaleString("en-US")} km across`}
        </span>
        {sharpening && (
          <span className="pointer-events-none absolute right-4 top-3 rounded-full bg-black/45 px-3 py-1 text-xs text-white/80 backdrop-blur">
            {t("mapSharpening")}
          </span>
        )}
        {zoomedPastData && (
          <span className="pointer-events-none absolute left-4 top-3 rounded-full bg-amber-500/80 px-3 py-1 text-xs font-medium text-black backdrop-blur">
            {t("beyondData")}
          </span>
        )}

        {/* zoom buttons */}
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-xl border border-white/20 bg-black/45 text-white backdrop-blur">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(0.6)} className="px-3 py-1.5 text-lg hover:bg-white/15">
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1.6)} className="border-t border-white/20 px-3 py-1.5 text-lg hover:bg-white/15">
            −
          </button>
        </div>

        {failed && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">{t("mapUnavailable")}</div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">{t("mapLoading")}</div>
        )}
      </div>

      {/* camera locks */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-full border border-black/15 text-sm dark:border-white/15">
          <button
            type="button"
            onClick={() => recenter("follow")}
            disabled={!hasPin}
            className={`px-4 py-1.5 disabled:opacity-40 ${lock === "follow" ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
          >
            {t("frameFollow")}
          </button>
          <button
            type="button"
            onClick={() => recenter("fixed")}
            className={`px-4 py-1.5 ${lock === "fixed" ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
          >
            {t("frameFixed")}
          </button>
          <button
            type="button"
            onClick={() => {
              setLock("free");
              setFreeView({ lonC: 0, latC: 0, lonSpan: 360 });
              setSpan(360);
            }}
            className={`px-4 py-1.5 ${lock === "free" ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
          >
            {t("viewWorld")}
          </button>
        </div>
        <p className="text-xs text-black/50 dark:text-white/50">{t("dragHint")}</p>
      </div>
      <p className="text-xs text-black/50 dark:text-white/50">
        {lock === "fixed" ? `${t("frameFixedNote")} ` : ""}
        {t("satelliteHonesty")}
      </p>
    </div>
  );
}
