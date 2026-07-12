/**
 * Server-only loaders for the validation dataset. Imports `node:fs`, so this
 * must never be pulled into a Client Component — import the pure helpers from
 * ./validation there instead.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slugify, type PlaceResult, type ValidationDataset } from "./validation";

let cached: ValidationDataset | null = null;

/** Read + parse the validation dataset once per process. */
export function getDataset(): ValidationDataset {
  if (!cached) {
    const file = join(process.cwd(), "data", "validation", "results.json");
    cached = JSON.parse(readFileSync(file, "utf8")) as ValidationDataset;
  }
  return cached;
}

export function getPlaceBySlug(slug: string): PlaceResult | null {
  return getDataset().places.find((p) => slugify(p.name) === slug) ?? null;
}
