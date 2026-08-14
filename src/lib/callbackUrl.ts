const APP_ORIGIN = "https://app.invalid";

export function normalizeCallbackUrl(
  value: string | string[] | undefined,
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return "/";

  try {
    const url = new URL(candidate, APP_ORIGIN);
    if (url.origin !== APP_ORIGIN) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function requestedCallbackUrl(pathname: string, search: string): string {
  return normalizeCallbackUrl(`${pathname}${search}`);
}
