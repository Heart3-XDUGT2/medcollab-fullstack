const DEFAULT_LOGOUT_ORIGINS = Object.freeze(["http://127.0.0.1:8081"]);
const error = () =>
  new Error(
    "PORTAL_LOGOUT_ORIGINS must be a JSON array of HTTP(S) origins without credentials, paths, query or fragment.",
  );

export function parseLogoutOrigins(raw) {
  if (raw === undefined) return DEFAULT_LOGOUT_ORIGINS;
  if (typeof raw !== "string" || raw.length > 8192) throw error();
  let values;
  try {
    values = JSON.parse(raw);
  } catch {
    throw error();
  }
  if (!Array.isArray(values) || values.length > 32) throw error();
  const result = values.map((value) => {
    if (
      typeof value !== "string" ||
      !/^https?:\/\/[^\s/?#\\@]+\/?$/i.test(value)
    )
      throw error();
    try {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        !url.hostname
      )
        throw error();
      return url.origin;
    } catch {
      throw error();
    }
  });
  return Object.freeze([...new Set(result)]);
}
