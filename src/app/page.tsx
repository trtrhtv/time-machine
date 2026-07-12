import { useTranslations } from "next-intl";

// Placeholder page — the Phase 0 validation site design comes after the
// RESULTS.md review. Do not build UI here yet.
export default function HomePage() {
  const t = useTranslations("HomePage");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="text-lg text-gray-500">{t("tagline")}</p>
    </main>
  );
}
