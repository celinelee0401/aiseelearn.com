export function urlWithUnit(currentUrl, unitId) {
  const url = new URL(currentUrl);
  url.searchParams.set("unit", unitId);
  return url.href;
}
