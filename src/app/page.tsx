import Link from "next/link";
import { useTranslations } from "next-intl";
import { getDataset } from "@/lib/dataset";
import { slugify, getArchetype } from "@/lib/validation";
import { sceneFor } from "@/lib/scene";
import { WaitlistForm } from "./WaitlistForm";

export default function HomePage() {
  const t = useTranslations("HomePage");
  const { places } = getDataset();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="text-xl text-black/70 dark:text-white/70">{t("tagline")}</p>
        <p className="max-w-2xl text-base text-black/55 dark:text-white/55">{t("intro")}</p>
      </header>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{t("placesHeading")}</h2>
          <p className="text-black/55 dark:text-white/55">{t("placesSub")}</p>
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {places.map((place) => {
            // Show the deepest-time reconstructed epoch as the card's teaser —
            // that's the most surprising "this was somewhere else entirely" view.
            const deep = [...place.epochs].reverse().find((e) => e.status === "ok");
            const teaser = deep ?? place.epochs[place.epochs.length - 1];
            const scene = sceneFor(teaser.archetypeId, teaser.status);
            const arch = getArchetype(teaser.archetypeId);
            return (
              <li key={place.name}>
                <Link
                  href={`/place/${slugify(place.name)}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-black/10 transition-shadow hover:shadow-lg dark:border-white/10"
                  aria-label={t("viewPlace", { name: place.name })}
                >
                  <div
                    className={`flex aspect-[16/9] items-center justify-center bg-gradient-to-br text-4xl ${scene.gradient}`}
                  >
                    <span aria-hidden>{scene.emoji}</span>
                  </div>
                  <div className="flex flex-col gap-1 p-4">
                    <span className="text-lg font-medium">{place.name}</span>
                    <span className="text-sm text-black/55 dark:text-white/55">
                      {teaser.status === "ok" && arch
                        ? `${teaser.ma} Ma · ${arch.label}`
                        : `${teaser.ma} Ma · —`}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-black/[0.02] p-8 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{t("waitlistHeading")}</h2>
          <p className="max-w-xl text-black/55 dark:text-white/55">{t("waitlistSub")}</p>
        </div>
        <WaitlistForm />
      </section>
    </main>
  );
}
