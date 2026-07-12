/**
 * Phase 0 / Task 0.2 — validation dataset.
 *
 * For each of the 10 iconic places × 7 epochs:
 *   1. reconstruct the modern point to its paleo-position (GPlates Web Service)
 *   2. land vs ocean via point-in-polygon against the reconstructed coastline
 *      polygons of the same epoch + model
 *   3. derive latitude band + provisional archetype (data/archetypes.json)
 *
 * The script PROBES the live service first (model list, response shapes)
 * before running the full loop — remembered API details are not trusted.
 * All responses are cached in data/cache/ (see gws.ts), so reruns are free.
 *
 * Outputs: data/validation/results.json + data/validation/RESULTS.md
 *
 * Run: npm run validate
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { gwsGet } from "./gws";

const DATA = join(process.cwd(), "data");
const OUT_DIR = join(DATA, "validation");

// ---------- config ----------

const PREFERRED_MODELS = ["MULLER2022", "MERDITH2021"]; // open licenses only

interface Place {
  name: string;
  lat: number;
  lon: number;
  expectation?: string;
}
const config = JSON.parse(readFileSync(join(OUT_DIR, "places.json"), "utf8")) as {
  epochsMa: number[];
  places: Place[];
};

interface ArchetypeDef {
  id: string;
  label: string;
  environment: "land" | "marine" | null;
  band: "tropical" | "temperate" | "polar" | null;
}
const taxonomy = JSON.parse(readFileSync(join(DATA, "archetypes.json"), "utf8")) as {
  archetypes: ArchetypeDef[];
};

// ---------- result types ----------

type Status = "ok" | "not-yet-formed" | "no-model-coverage" | "error";

interface EpochResult {
  ma: number;
  status: Status;
  paleoLat: number | null;
  paleoLon: number | null;
  environment: "land" | "ocean" | null;
  band: "tropical" | "temperate" | "polar" | null;
  archetypeId: string | null;
  notes: string[];
}

interface PlaceResult extends Place {
  epochs: EpochResult[];
}

// ---------- helpers ----------

function bandOf(lat: number): "tropical" | "temperate" | "polar" {
  const a = Math.abs(lat);
  return a < 23.5 ? "tropical" : a <= 55 ? "temperate" : "polar";
}

function archetypeFor(env: "land" | "ocean", band: string): string {
  const wanted = env === "ocean" ? "marine" : "land";
  const hit = taxonomy.archetypes.find((a) => a.environment === wanted && a.band === band);
  if (!hit) throw new Error(`No archetype for ${wanted}/${band} in data/archetypes.json`);
  return hit.id;
}

function greatCircleDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const d = (x: number) => (x * Math.PI) / 180;
  const a =
    Math.sin(d(lat2 - lat1) / 2) ** 2 +
    Math.cos(d(lat1)) * Math.cos(d(lat2)) * Math.sin(d(lon2 - lon1) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a))) * 180) / Math.PI;
}

/** GWS marks points that don't exist at the target time with null or a 999.99 sentinel. */
function isNullPoint(lon: unknown, lat: unknown): boolean {
  if (lon == null || lat == null) return true;
  const [x, y] = [Number(lon), Number(lat)];
  return !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 360 || Math.abs(y) > 90.01 || x === 999.99 || y === 999.99;
}

function fail(msg: string, body: unknown): never {
  console.error(`\nPROBE FAILED: ${msg}`);
  console.error("Actual response body (first 2000 chars):");
  console.error(JSON.stringify(body).slice(0, 2000));
  process.exit(1);
}

// ---------- probe: verify service + endpoint shapes before the full loop ----------

async function probe(): Promise<string> {
  console.log("Probing GPlates Web Service…");

  const models = await gwsGet("/info/model_names", {});
  if (models.status !== 200 || !Array.isArray(models.body)) {
    fail(`GET /info/model_names returned status ${models.status} or non-array`, models.body);
  }
  const names = (models.body as unknown[]).map(String);
  console.log(`  models available: ${names.join(", ")}`);
  const model = PREFERRED_MODELS.find((m) => names.includes(m));
  if (!model) fail(`Neither ${PREFERRED_MODELS.join(" nor ")} in model list`, names);
  console.log(`  using model: ${model}`);

  // Shape-check the two endpoints we depend on, with one real call each.
  const rec = await gwsGet("/reconstruct/reconstruct_points/", {
    points: "-74.006,40.7128",
    time: 66,
    model: model!,
  });
  const coords = (rec.body as { coordinates?: unknown[][] })?.coordinates;
  if (rec.status !== 200 || !Array.isArray(coords) || !Array.isArray(coords[0])) {
    fail("reconstruct_points did not return {coordinates: [[lon,lat]]}", rec.body);
  }
  console.log(`  reconstruct_points OK → [${coords[0].join(", ")}]`);

  const coast = await gwsGet("/reconstruct/coastlines/", { time: 66, model: model! });
  const fc = coast.body as FeatureCollection;
  const polygonal = (fc?.features ?? []).filter(
    (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
  if (coast.status !== 200 || fc?.type !== "FeatureCollection" || polygonal.length === 0) {
    fail("coastlines did not return a FeatureCollection with polygonal features", coast.body);
  }
  console.log(`  coastlines OK → ${fc.features.length} features (${polygonal.length} polygonal)`);
  return model!;
}

// ---------- pipeline ----------

async function coastPolygons(model: string, ma: number): Promise<Feature<Polygon | MultiPolygon>[]> {
  const res = await gwsGet("/reconstruct/coastlines/", { time: ma, model });
  if (res.status !== 200) throw new Error(`coastlines(${ma}) → HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
  const fc = res.body as FeatureCollection;
  return fc.features.filter(
    (f): f is Feature<Polygon | MultiPolygon> =>
      f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
}

async function reconstructPlace(model: string, place: Place, ma: number): Promise<EpochResult> {
  const r: EpochResult = {
    ma,
    status: "ok",
    paleoLat: null,
    paleoLon: null,
    environment: null,
    band: null,
    archetypeId: null,
    notes: [],
  };

  const res = await gwsGet("/reconstruct/reconstruct_points/", {
    points: `${place.lon},${place.lat}`,
    time: ma,
    model,
  });

  if (res.status >= 400) {
    // e.g. time outside the model's valid range — record the fact, don't fail.
    r.status = "no-model-coverage";
    r.notes.push(`GWS HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    return r;
  }

  const coords = (res.body as { coordinates?: unknown[][] })?.coordinates;
  const pt = coords?.[0];
  if (!pt || isNullPoint(pt[0], pt[1])) {
    r.status = "not-yet-formed";
    r.notes.push("No reconstructed position — crust likely did not exist yet at this time.");
    return r;
  }

  r.paleoLon = Number(Number(pt[0]).toFixed(2));
  r.paleoLat = Number(Number(pt[1]).toFixed(2));
  r.band = bandOf(r.paleoLat);

  const polys = await coastPolygons(model, ma);
  const p = point([r.paleoLon, r.paleoLat]);
  const onLand = polys.some((poly) => booleanPointInPolygon(p, poly));
  r.environment = onLand ? "land" : "ocean";
  r.archetypeId = archetypeFor(r.environment, r.band);
  return r;
}

function addSanityNotes(results: PlaceResult[]): void {
  for (const place of results) {
    const ok = place.epochs.filter((e) => e.status === "ok");
    for (let i = 1; i < ok.length; i++) {
      const a = ok[i - 1];
      const b = ok[i];
      const jump = greatCircleDeg(a.paleoLat!, a.paleoLon!, b.paleoLat!, b.paleoLon!);
      if (jump > 45) {
        b.notes.push(
          `SANITY: ${jump.toFixed(0)}° great-circle jump from ${a.ma} Ma — cross-check vs ancient-earth.`,
        );
      }
    }
    if (place.name === "Reykjavik") {
      for (const e of place.epochs) {
        if (e.ma > 20 && e.status === "ok") {
          e.notes.push(
            "SANITY: Reykjavik should not exist before ~20 Ma but got a position — the model reconstructs the plate, not the (not-yet-erupted) crust. Product should treat young volcanic crust specially.",
          );
        }
      }
    }
  }
}

// ---------- output ----------

const GLOBAL_CAVEATS = [
  "Land/ocean is point-in-polygon against reconstructed *modern* coastline outlines. Shallow epicontinental seas (e.g. the Western Interior Seaway over Denver ~90 Ma, the Tethys shelf over Tel Aviv/Cairo) are NOT captured — such spots will wrongly read 'land'. Fixing this without Scotese paleogeography is a named Phase 1 problem (candidate: paleo-elevation-free heuristics or open paleogeography alternatives).",
  "Positions carry ±100 km (and more at older epochs) uncertainty by design — always shown in the product's accuracy box.",
  "Marine results cannot yet distinguish shallow shelf from open ocean (taxonomy v0).",
];

function writeOutputs(model: string, results: PlaceResult[]): void {
  mkdirSync(OUT_DIR, { recursive: true });

  const machine = {
    model,
    modelLicense: "open (GPlates Web Service bundled reconstruction model)",
    generatedAt: new Date().toISOString(),
    epochsMa: config.epochsMa,
    caveats: GLOBAL_CAVEATS,
    places: results,
  };
  writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(machine, null, 2));

  const lines: string[] = [
    "# Validation results — 10 places × 7 epochs",
    "",
    `Model: **${model}** (GPlates Web Service, open license) · generated ${machine.generatedAt}`,
    "",
    "## Caveats (read first)",
    "",
    ...GLOBAL_CAVEATS.map((c) => `- ${c}`),
    "",
    "## Results",
    "",
    "| Place | Ma | Paleo-position | Env | Band | Archetype | Notes |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const place of results) {
    for (const e of place.epochs) {
      const pos =
        e.status === "ok" ? `${e.paleoLat!.toFixed(1)}°, ${e.paleoLon!.toFixed(1)}°` : `— (${e.status})`;
      lines.push(
        `| ${place.name} | ${e.ma} | ${pos} | ${e.environment ?? "—"} | ${e.band ?? "—"} | ${
          e.archetypeId ?? "—"
        } | ${e.notes.join(" ") || ""} |`,
      );
    }
  }
  lines.push(
    "",
    "## Manual cross-check",
    "",
    "Compare flagged rows against https://dinosaurpictures.org/ancient-earth (different model — expect qualitative, not exact, agreement).",
    "",
  );
  writeFileSync(join(OUT_DIR, "RESULTS.md"), lines.join("\n"));
  console.log(`\nWrote ${join(OUT_DIR, "results.json")} and RESULTS.md`);
}

// ---------- main ----------

async function main() {
  const model = await probe();

  const results: PlaceResult[] = [];
  for (const place of config.places) {
    console.log(`\n${place.name}`);
    const pr: PlaceResult = { ...place, epochs: [] };
    for (const ma of config.epochsMa) {
      try {
        const r = await reconstructPlace(model, place, ma);
        pr.epochs.push(r);
        console.log(
          `  ${String(ma).padStart(3)} Ma → ${
            r.status === "ok"
              ? `${r.paleoLat}, ${r.paleoLon} · ${r.environment} · ${r.archetypeId}`
              : r.status
          }`,
        );
      } catch (err) {
        pr.epochs.push({
          ma,
          status: "error",
          paleoLat: null,
          paleoLon: null,
          environment: null,
          band: null,
          archetypeId: null,
          notes: [String(err)],
        });
        console.error(`  ${ma} Ma → ERROR: ${err}`);
      }
    }
    results.push(pr);
  }

  addSanityNotes(results);
  writeOutputs(model, results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
