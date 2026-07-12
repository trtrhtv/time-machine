/**
 * Stylized visual for each archetype. These are deliberately abstract gradients,
 * NOT photorealistic scenes — Phase 0 is about validating the concept without
 * risking "AI-slop" credibility loss (see ROADMAP.md risks). Real curated
 * archetype art replaces these in Phase 3, keyed by the same archetype id.
 */
export interface SceneVisual {
  gradient: string;
  emoji: string;
}

const SCENES: Record<string, SceneVisual> = {
  "tropical-marine": { gradient: "from-cyan-300 via-teal-400 to-blue-600", emoji: "🐚" },
  "temperate-marine": { gradient: "from-sky-300 via-blue-500 to-slate-700", emoji: "🌊" },
  "polar-marine": { gradient: "from-slate-200 via-cyan-200 to-slate-500", emoji: "🧊" },
  "tropical-land": { gradient: "from-lime-300 via-green-500 to-emerald-700", emoji: "🌿" },
  "temperate-land": { gradient: "from-amber-200 via-lime-500 to-green-700", emoji: "🌾" },
  "polar-land": { gradient: "from-slate-100 via-slate-300 to-slate-500", emoji: "🏔️" },
  "not-yet-formed": { gradient: "from-neutral-800 via-neutral-900 to-black", emoji: "✨" },
};

const FALLBACK: SceneVisual = { gradient: "from-neutral-300 to-neutral-600", emoji: "🌍" };

export function sceneFor(archetypeId: string | null, status?: string): SceneVisual {
  if (status === "not-yet-formed") return SCENES["not-yet-formed"];
  return (archetypeId && SCENES[archetypeId]) || FALLBACK;
}
