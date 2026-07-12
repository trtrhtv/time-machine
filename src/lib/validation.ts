/**
 * Types + pure helpers for the Phase 0 validation dataset. This module is
 * safe to import from Client Components — it does NOT touch the filesystem.
 * The fs-backed loaders live in ./dataset (server-only).
 */
import archetypesJson from "../../data/archetypes.json";

export type EpochStatus = "ok" | "not-yet-formed" | "no-model-coverage" | "error";
export type Environment = "land" | "ocean";
export type Band = "tropical" | "temperate" | "polar";

export interface EpochResult {
  ma: number;
  status: EpochStatus;
  paleoLat: number | null;
  paleoLon: number | null;
  environment: Environment | null;
  band: Band | null;
  archetypeId: string | null;
  notes: string[];
}

export interface PlaceResult {
  name: string;
  lat: number;
  lon: number;
  expectation?: string;
  epochs: EpochResult[];
}

export interface ValidationDataset {
  model: string;
  modelLicense: string;
  generatedAt: string;
  epochsMa: number[];
  caveats: string[];
  places: PlaceResult[];
}

export interface Archetype {
  id: string;
  label: string;
  environment: "land" | "marine" | null;
  band: Band | null;
  description: string;
  sceneAsset: string | null;
}

const archetypes = (archetypesJson as { archetypes: Archetype[] }).archetypes;

export function getArchetype(id: string | null): Archetype | null {
  if (!id) return null;
  return archetypes.find((a) => a.id === id) ?? null;
}

/** URL-safe slug for a place name, e.g. "New York" -> "new-york". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "540 Ma" -> "540 million years ago". */
export function epochLabel(ma: number): string {
  return `${ma.toLocaleString("en-US")} million years ago`;
}

/**
 * Human, non-overclaiming accuracy note. Inter-model spread grows with age
 * (see data/validation/REVIEW.md: ~5° at ≤150 Ma, ~20–25° at ≥400 Ma), so the
 * envelope widens for older epochs rather than a flat "±100 km" everywhere.
 */
export function accuracyNote(ma: number): string {
  if (ma <= 90) return "≈ ±100 km";
  if (ma <= 250) return "≈ a few hundred km";
  return "≈ several hundred to >1,000 km";
}
