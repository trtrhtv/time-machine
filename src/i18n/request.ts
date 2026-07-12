import { getRequestConfig } from "next-intl/server";

// Single-locale for now. Adding Hebrew later means: add messages/he.json and
// resolve the locale here (cookie/header) — no component changes required.
const locale = "en";

export default getRequestConfig(async () => ({
  locale,
  messages: (await import(`../../messages/${locale}.json`)).default,
}));
