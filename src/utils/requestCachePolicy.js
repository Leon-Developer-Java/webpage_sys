export function requestCacheMode(_url, options = {}) {
  if (options.cache) return null;

  const method = String(options.method || "GET").toUpperCase();
  return method === "GET" || method === "HEAD" ? "no-store" : null;
}
