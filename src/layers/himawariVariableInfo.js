export function buildHimawariVariableInfo({ product, display }) {
  const meta = display?.meta_json || display?.meta || {};
  const weather = meta.weather_info || display?.weather_info || {};
  const productName = productLabel(product);
  const isRgb = isHimawariRgbProduct(product);
  const unit = isRgb ? "RGB合成" : product?.display_unit || product?.unit || weather.unit || "";

  return {
    file: meta.scene_id || display?.meta_file || weather.file || "—",
    element: productName || weather.element || "—",
    time: meta.observation_time || weather.time || "—",
    level: weather.level || "卫星观测",
    range: weather.range || formatExtent(meta.extent || display?.extent),
    grid: weather.grid || formatGrid(meta.grid || display?.grid),
    unit,
    missing: isRgb ? "—" : weather.missing || product?.missing || "—",
    status: weather.status || "解析完成",
    extraRows: buildExtraRows(product),
  };
}

export function resolveHimawariImageUrl({ product, display, fallback = "", apiBase = "" } = {}) {
  const candidates = [
    product?.webp_url,
    product?.image_url,
    product?.image,
    product?.url,
    product?.src,
    product?.png_url,
    product?.png,
    product?.png_data_url,
    display?.webp_url,
    display?.image_url,
    display?.image,
    display?.url,
    display?.src,
    display?.png_url,
    display?.png,
    display?.png_data_url,
    fallback,
  ];

  for (const candidate of candidates) {
    const url = toPublicUrl(candidate, apiBase);
    if (url) return url;
  }
  return "";
}

function productLabel(product) {
  return product?.name_cn || product?.name_zh || product?.long_name || product?.plain_name || product?.name || product?.key || "";
}

export function isHimawariRgbProduct(product) {
  return product?.is_rgb === true ||
    product?.render_mode === "rgb" ||
    product?.render_mode === "image" ||
    product?.product_type === "composite";
}

function buildExtraRows(product) {
  if (!product) return [];
  const cnDescription = firstText(
    product.description_cn,
    product.description_zh,
    product.explanation_cn,
    product.explanation_zh,
  );
  const enDescription = firstText(
    product.description_en,
    product.description,
    product.long_name,
    product.plain_name,
  );
  return [
    { key: "category", label: "类型", value: product.category },
    { key: "wavelength", label: "波长", value: product.wavelength },
    { key: "source_bands", label: "来源", value: formatSourceBands(product.source_bands) },
    { key: "description_cn", label: "说明", value: clipText(cnDescription || enDescription, 34) },
    { key: "description_en", label: "英文", value: enDescription && enDescription !== cnDescription ? clipText(enDescription, 46) : "" },
  ].filter((row) => row.value !== undefined && row.value !== null && row.value !== "");
}

function firstText(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

function clipText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function toPublicUrl(value, apiBase) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(data:|blob:|https?:\/\/)/i.test(text)) return text;
  if (text.startsWith("/")) return `${String(apiBase || "").replace(/\/$/, "")}${text}`;
  if (/^(data|static|assets)\//i.test(text)) return `${String(apiBase || "").replace(/\/$/, "")}/${text}`;
  return "";
}

function formatSourceBands(sourceBands) {
  if (!Array.isArray(sourceBands) || !sourceBands.length) return "";
  return sourceBands.join("、");
}

function formatExtent(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return "";
  const [west, south, east, north] = extent;
  return `${west}°E-${east}°E, ${south}°N-${north}°N`;
}

function formatGrid(grid) {
  if (!grid?.nx || !grid?.ny) return "";
  return `${grid.nx} × ${grid.ny}`;
}
