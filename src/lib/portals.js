export const SUPPORTED_PORTAL_HOSTS = [
  "scholarships.gov.in",
  "tnscholarship.net",
  "egrantz.tn.gov.in",
  "buddy4study.com",
];

export function isPortalUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return SUPPORTED_PORTAL_HOSTS.some(
      (h) => host === h || host.endsWith("." + h),
    );
  } catch {
    return false;
  }
}
