// Authenticated API state must not be reused across users or task transitions.
// Static products retain normal browser caching; explicit caller policy wins.
export function requestCacheMode(url, options = {}) {
  if (options.cache != null) return options.cache;
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  try {
    const path = new URL(String(url), 'http://request-policy.invalid').pathname;
    return path === '/api' || path.startsWith('/api/') ? 'no-store' : undefined;
  } catch {
    return undefined;
  }
}
