export function buildHimawariVariableInfo({ product, display }) {
  const meta = display?.meta_json || display?.meta || {};
  const weather = meta.weather_info || display?.weather_info || {};
  const productName = productLabel(product);
  const isRgb = isHimawariRgbProduct(product);
  const unit = isRgb ? "RGB合成" : product?.display_unit || product?.unit || weather.unit || "";

  // 中文说明
  const cnDescription = firstText(
    product?.description_cn,
    product?.description_zh,
    product?.explanation_cn,
    product?.explanation_zh,
  );
  // 英文说明 — 部分产品以 "; " 分隔标签与解释
  const enDescription = firstText(
    product?.description_en,
    product?.description,
    product?.long_name,
    product?.plain_name,
  );
  const { label: enLabel, explanation: enExplanation } = splitEnDescription(enDescription);

  // 要素的英文标识：产品 ID · 英文标签
  const productId = product?.name || product?.key || "";
  const elementEn = productId
    ? productId + (enLabel ? ` · ${enLabel}` : "")
    : enLabel;

  // 含义：中文说明 + 英文解释（不含英文标签部分，空格分隔同排显示）
  const elementMeaning = cnDescription
    ? cnDescription + (enExplanation && enExplanation !== cnDescription ? ` ${enExplanation}` : "")
    : (enExplanation || "");

  return {
    file: meta.scene_id || display?.meta_file || weather.file || "—",
    element: productName || weather.element || "—",
    element_en: elementEn,
    elementMeaning,
    time: meta.observation_time || weather.time || "—",
    level: weather.level || "卫星观测",
    range: weather.range || formatExtent(meta.extent || display?.extent),
    grid: weather.grid || formatGrid(meta.grid || display?.grid),
    unit,
    missing: isRgb ? "—" : weather.missing || product?.missing || "—",
    status: weather.status || "解析完成",
    // 时间分辨率（Himawari 全圆盘 10 分钟扫描间隔）
    timeResolution: "10分钟",
    // 空间分辨率（来自网格分辨率）
    spatialResolution: weather.resolution || (meta.resolution ? `${meta.resolution}°` : ""),
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
    display?.webp_url,
    display?.image_url,
    display?.image,
    display?.url,
    display?.src,
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
  return [
    { key: "wavelength", label: "波长", value: product.wavelength },
    { key: "source_bands", label: "来源", value: formatSourceBands(product.source_bands) },
  ].filter((row) => row.value !== undefined && row.value !== null && row.value !== "");
}

function firstText(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

/**
 * 拆分英文说明为标签部分（要素栏用）和解释部分（含义栏用）。
 * 部分产品以 "; " 分隔（如 B13: "Infrared window brightness temperature; colder..."）。
 * 无分隔时标签和解释相同。
 */
function splitEnDescription(text) {
  if (!text) return { label: "", explanation: "" };
  const idx = text.indexOf("; ");
  if (idx > 0) {
    return {
      label: text.slice(0, idx).trim(),
      explanation: text.slice(idx + 2).trim(),
    };
  }
  return { label: text, explanation: text };
}

function toPublicUrl(value, apiBase) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/\.webp(\?.*)?$/i.test(text)) return "";
  if (/^https?:\/\//i.test(text)) return text;
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
