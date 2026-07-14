export function fy3ProductName(item) {
  return item?.name || item?.key || "";
}

export function resolveFY3ImageUrl({ product, currentFrame, fallback = "", apiBase = "" }) {
  const key = fy3ProductName(product);
  const frameUrl = currentFrame?.webp_url || currentFrame?.image_url;

  if (key && frameUrl) {
    const replaced = String(frameUrl).replace(/\/latlon\/[^/]+?\.webp(\?.*)?$/i, `/latlon/${key}.webp$1`);
    if (replaced !== frameUrl) return toPublicUrl(replaced, apiBase);
    return toPublicUrl(frameUrl, apiBase);
  }

  if (!key) return toPublicUrl(frameUrl || fallback, apiBase);
  return toPublicUrl(product?.webp_url || product?.image_url || frameUrl || fallback, apiBase);
}

function toPublicUrl(value, apiBase) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/\.webp(\?.*)?$/i.test(text)) return "";
  if (/^(data:|blob:|https?:\/\/)/i.test(text)) return text;
  const base = String(apiBase || "").replace(/\/$/, "");
  if (text.startsWith("/")) return `${base}${text}`;
  if (/^(data|static|assets)\//i.test(text)) return `${base}/${text}`;
  return text;
}
