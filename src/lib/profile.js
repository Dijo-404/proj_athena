export const LANGUAGE_ORDER = ["ta", "en"];
export const LANGUAGE_LABELS = { ta: "Tamil", en: "English" };
export const LANGUAGE_SPEECH = { ta: "ta-IN", en: "en-IN" };

export function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLanguageList(value) {
  const rawList = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = rawList.map(safeString).filter(Boolean);
  const ordered = [];
  for (const lang of LANGUAGE_ORDER) {
    if (normalized.includes(lang)) ordered.push(lang);
  }
  return ordered;
}

export function getPrimaryLanguage(languages) {
  return normalizeLanguageList(languages)[0] || "ta";
}

export function getLanguageLabel(language) {
  return LANGUAGE_LABELS[language] || "English";
}

export function normalizeProfile(input) {
  const languages = normalizeLanguageList(input?.languages ?? input?.language);
  return {
    name: safeString(input?.name),
    caste_category: safeString(input?.caste_category),
    annual_income: toNumber(input?.annual_income),
    course_level: safeString(input?.course_level),
    course: safeString(input?.course),
    percentage: toNumber(input?.percentage),
    district: safeString(input?.district),
    languages,
    language: getPrimaryLanguage(languages),
  };
}
