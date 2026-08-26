import {
  DEFAULT_LANGUAGE,
  isValidLanguage,
  type SupportedLanguage,
} from "@/lib/i18n";

export function resolveCatalogLanguage(
  value: string | null,
): SupportedLanguage {
  return value && isValidLanguage(value) ? value : DEFAULT_LANGUAGE;
}
