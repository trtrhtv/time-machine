"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlaceResult } from "@/lib/validation";
import { epochLabel, accuracyNote, getArchetype } from "@/lib/validation";
import { sceneFor } from "@/lib/scene";

interface Props {
  place: PlaceResult;
  model: string;
  license: string;
  generatedAt: string;
}

function bandLabel(band: string | null): string {
  if (!band) return "—";
  return band.charAt(0).toUpperCase() + band.slice(1);
}

export function PlaceTimeline({ place, model, license, generatedAt }: Props) {
  const t = useTranslations("Place");
  const [i, setI] = useState(place.epochs.length - 1);
  const epoch = place.epochs[i];
  const scene = sceneFor(epoch.archetypeId, epoch.status);
  const arch = getArchetype(epoch.archetypeId);
  const formed = epoch.status === "ok";

  const [copied, setCopied] = useState(false);
  async function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const title = t("atEpoch", { name: place.name, epoch: epochLabel(epoch.ma) });
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch {
      // user dismissed the share sheet — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — nothing further we can do silently
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Scene */}
      <div
        className={`relative flex aspect-[2/1] items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br text-7xl ${scene.gradient}`}
      >
        <span aria-hidden>{scene.emoji}</span>
        <span className="absolute bottom-4 left-5 rounded-full bg-black/40 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
          {epochLabel(epoch.ma)}
        </span>
      </div>

      {/* Scrubber */}
      <div className="flex flex-col gap-3">
        <label htmlFor="epoch" className="text-sm font-medium text-black/55 dark:text-white/55">
          {t("scrubberLabel")}
        </label>
        <input
          id="epoch"
          type="range"
          min={0}
          max={place.epochs.length - 1}
          step={1}
          value={i}
          onChange={(e) => setI(Number(e.target.value))}
          className="w-full accent-foreground"
          aria-valuetext={epochLabel(epoch.ma)}
        />
        <div className="flex justify-between text-xs text-black/45 dark:text-white/45">
          {place.epochs.map((e, idx) => (
            <button
              key={e.ma}
              type="button"
              onClick={() => setI(idx)}
              className={idx === i ? "font-semibold text-foreground" : "hover:text-foreground"}
            >
              {e.ma}
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      {formed ? (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-xl border border-black/10 p-4 dark:border-white/10">
            <dt className="text-sm text-black/50 dark:text-white/50">{t("position")}</dt>
            <dd className="font-mono text-lg">
              {epoch.paleoLat!.toFixed(1)}°, {epoch.paleoLon!.toFixed(1)}°
            </dd>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-black/10 p-4 dark:border-white/10">
            <dt className="text-sm text-black/50 dark:text-white/50">{t("environment")}</dt>
            <dd className="text-lg">{arch?.label ?? epoch.environment ?? "—"}</dd>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-black/10 p-4 dark:border-white/10">
            <dt className="text-sm text-black/50 dark:text-white/50">{t("band")}</dt>
            <dd className="text-lg">{bandLabel(epoch.band)}</dd>
          </div>
        </dl>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-black/10 bg-black/[0.02] p-6 dark:border-white/10 dark:bg-white/[0.03]">
          <h2 className="text-lg font-semibold">{t("notFormedTitle")}</h2>
          <p className="text-black/60 dark:text-white/60">
            {t("notFormedBody", { name: place.name })}
          </p>
        </div>
      )}

      {/* Accuracy box — on every result, always */}
      <aside className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-5 text-sm">
        <h2 className="font-semibold">{t("accuracyTitle")}</h2>
        <p>{t("accuracyModel", { model, license })}</p>
        {formed && <p>{t("accuracyEnvelope", { envelope: accuracyNote(epoch.ma) })}</p>}
        {formed && epoch.environment === "land" && <p>{t("accuracyCoastline")}</p>}
        <p className="text-black/50 dark:text-white/50">
          {t("accuracyGenerated", { generated: new Date(generatedAt).toISOString().slice(0, 10) })}
        </p>
        {epoch.notes.length > 0 && (
          <ul className="list-disc pl-5 text-black/50 dark:text-white/50">
            {epoch.notes.map((n, idx) => (
              <li key={idx}>{n}</li>
            ))}
          </ul>
        )}
      </aside>

      {/* Share */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={share}
          className="rounded-xl bg-foreground px-5 py-2.5 font-medium text-background transition-opacity hover:opacity-90"
        >
          {t("shareButton")}
        </button>
        {copied && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">{t("shareCopied")}</span>
        )}
      </div>
    </div>
  );
}
