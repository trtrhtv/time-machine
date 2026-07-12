"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { joinWaitlist, type WaitlistState } from "./actions";

const initial: WaitlistState = { status: "idle" };

export function WaitlistForm() {
  const t = useTranslations("HomePage");
  const [state, action, pending] = useActionState(joinWaitlist, initial);

  if (state.status === "success") {
    return (
      <p className="rounded-xl bg-emerald-500/10 px-5 py-4 text-emerald-700 dark:text-emerald-300">
        {t("waitlistSuccess")}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="email">
        {t("waitlistPlaceholder")}
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder={t("waitlistPlaceholder")}
        className="flex-1 rounded-xl border border-black/15 bg-white/70 px-4 py-3 text-base outline-none focus:border-black/40 dark:border-white/15 dark:bg-white/5 dark:focus:border-white/40"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-foreground px-5 py-3 font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? t("waitlistPending") : t("waitlistButton")}
      </button>
      {(state.status === "invalid" || state.status === "error") && (
        <p role="alert" className="self-center text-sm text-red-600 dark:text-red-400">
          {state.status === "invalid" ? t("waitlistInvalid") : t("waitlistError")}
        </p>
      )}
    </form>
  );
}
