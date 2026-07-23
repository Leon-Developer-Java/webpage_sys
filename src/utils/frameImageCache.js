import { withToken } from "../api";

const frameCache = new Map();
const MAX_CACHED_FRAMES = 256;
const LOAD_TIMEOUT_MS = 20000;

function resolvedFrameUrl(url) {
  const value = String(url || "");
  if (!value || /[?&]token=/.test(value)) return value;
  return withToken(value);
}

function trimFrameCache() {
  if (frameCache.size <= MAX_CACHED_FRAMES) return;
  [...frameCache.entries()]
    .filter(([, entry]) => entry.state !== "loading")
    .sort((left, right) => left[1].lastUsed - right[1].lastUsed)
    .slice(0, frameCache.size - MAX_CACHED_FRAMES)
    .forEach(([key, entry]) => {
      entry.image.onload = null;
      entry.image.onerror = null;
      entry.image.src = "";
      frameCache.delete(key);
    });
}

export function getCachedFrame(url) {
  const key = resolvedFrameUrl(url);
  const entry = frameCache.get(key);
  if (!entry || entry.state !== "ready" || !entry.image.complete || !entry.image.naturalWidth) return null;
  entry.lastUsed = Date.now();
  return entry.image;
}

export function preloadFrame(url) {
  const key = resolvedFrameUrl(url);
  if (!key || typeof Image === "undefined") return Promise.resolve(null);

  const cached = frameCache.get(key);
  if (cached) {
    if (cached.state === "failed") {
      frameCache.delete(key);
    } else {
      cached.lastUsed = Date.now();
      return cached.promise;
    }
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  const entry = { image, state: "loading", lastUsed: Date.now(), promise: null };
  entry.promise = new Promise(resolve => {
    let settled = false;
    const finish = async loaded => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (loaded) {
        try {
          await image.decode?.();
        } catch {
          // onload 已确认图片可用，decode 失败不影响纹理上传。
        }
      }
      entry.state = loaded ? "ready" : "failed";
      entry.lastUsed = Date.now();
      if (!loaded) image.src = "";
      trimFrameCache();
      resolve(loaded ? image : null);
    };
    const timeout = window.setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
  });
  frameCache.set(key, entry);
  image.src = key;
  return entry.promise;
}

export async function preloadFrames(urls, concurrency = 6) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean).map(String))];
  if (!uniqueUrls.length) return { total: 0, loaded: 0, failed: 0 };

  let cursor = 0;
  let loaded = 0;
  const worker = async () => {
    while (cursor < uniqueUrls.length) {
      const index = cursor;
      cursor += 1;
      if (await preloadFrame(uniqueUrls[index])) loaded += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), uniqueUrls.length) }, worker));
  return { total: uniqueUrls.length, loaded, failed: uniqueUrls.length - loaded };
}
