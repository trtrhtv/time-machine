import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getDataset, getPlaceBySlug } from "@/lib/dataset";
import { slugify } from "@/lib/validation";
import { PlaceTimeline } from "./PlaceTimeline";

// Fully precomputed: one static page per place, no runtime data fetching.
export function generateStaticParams() {
  return getDataset().places.map((p) => ({ slug: slugify(p.name) }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const place = getPlaceBySlug(slug);
  if (!place) return {};
  const title = `${place.name} through deep time · Local Time Machine`;
  const description = `Where the ground beneath ${place.name} sat across 540 million years of continental drift.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PlacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const place = getPlaceBySlug(slug);
  if (!place) notFound();

  const { model, modelLicense, generatedAt } = getDataset();
  const t = await getTranslations("Place");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="w-fit text-sm text-black/50 transition-colors hover:text-foreground dark:text-white/50"
        >
          {t("back")}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{place.name}</h1>
      </div>

      <PlaceTimeline
        place={place}
        model={model}
        license={modelLicense}
        generatedAt={generatedAt}
      />
    </main>
  );
}
