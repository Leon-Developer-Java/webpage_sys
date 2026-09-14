const TYPE_LABELS = {
  CMA: "CMA",
  ERA5: "ERA5",
  WRF: "WRF",
  RADAR: "雷达",
  GFS: "GFS",
  ECMWF: "ECMWF",
  HIMAWARI: "葵花卫星",
  FY3: "风云三号",
};

const asArray = value => Array.isArray(value) ? value : value == null ? [] : [value];
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== "");

function normalizeExtent(value) {
  if (Array.isArray(value) && value.length >= 4) return value.slice(0, 4).map(Number);
  if (value && typeof value === "object") {
    const result = [value.west, value.south, value.east, value.north].map(Number);
    if (result.every(Number.isFinite)) return result;
  }
  return [73, 15, 135, 55];
}

function normalizeVariable(item, fallbackName = "") {
  const name = String(first(item?.name, item?.key, item?.short_name, item?.raw_name, item?.productCode, item?.product_code, fallbackName) || "");
  return {
    ...item,
    name,
    label: first(item?.name_cn, item?.label, item?.long_name, item?.description, name),
    unit: first(item?.display_unit, item?.displayUnit, item?.unit, item?.units, ""),
  };
}

function uniqueVariables(items) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const normalized = normalizeVariable(item);
    if (!normalized.name || seen.has(normalized.name)) continue;
    seen.add(normalized.name);
    result.push(normalized);
  }
  return result;
}

function normalizeResolutionOptions(meta, fallback = "native") {
  const declared = asArray(meta?.resolution_options).map(item => typeof item === "string"
    ? { key: item, label: item, playable: true }
    : { ...item, key: String(first(item?.key, item?.name, fallback)) });
  if (declared.length) return declared;
  const keys = [
    ...Object.keys(meta?.resolution_products || {}),
    ...Object.keys(meta?.resolution_layers || {}),
    ...Object.keys(meta?.resolution_assets || {}),
    ...asArray(meta?.available_resolutions).map(String),
  ].filter((key, index, values) => key && values.indexOf(key) === index);
  if (keys.length) return keys.map(key => ({
    key,
    label: meta?.resolution_products?.[key]?.label || meta?.resolution_layers?.[key]?.label || meta?.resolution_assets?.[key]?.label || key,
    playable: true,
  }));
  return [{ key: fallback, label: fallback === "native" ? "原始" : fallback, playable: true }];
}

function makeFrame({ imageUrl, time, extent, width, height, stats, unit }) {
  const values = stats && typeof stats === "object" ? stats : {};
  return {
    image_url: imageUrl || "",
    valid_time: String(time || ""),
    extent: normalizeExtent(extent),
    width: Number(width) || null,
    height: Number(height) || null,
    min: first(values.min, values.scale_min),
    max: first(values.max, values.scale_max),
    mean: values.mean,
    unit: unit || "",
  };
}

function layerFrames(layer, meta) {
  const urls = asArray(first(layer?.webp_urls, layer?.image_urls, layer?.webp_files, layer?.webp_url, layer?.image_url, layer?.webp));
  const times = asArray(first(layer?.times, meta?.times));
  const stats = asArray(first(layer?.stats, layer?.step_stats));
  return urls.map((url, index) => makeFrame({
    imageUrl: url,
    time: first(times[index], times[times.length - 1]),
    extent: first(layer?.extent, layer?.bbox, meta?.extent, meta?.bbox),
    width: first(layer?.width, layer?.grid?.width, layer?.grid?.nx),
    height: first(layer?.height, layer?.grid?.height, layer?.grid?.ny),
    stats: first(stats[index], stats[stats.length - 1], layer),
    unit: first(layer?.display_unit, layer?.displayUnit, layer?.unit, layer?.units),
  }));
}

function variableLayerDocument(resource, selection) {
  const meta = resource.meta || {};
  const layers = meta.variable_layers || {};
  const variables = uniqueVariables([
    ...asArray(meta.variable_options),
    ...asArray(meta.variables),
    ...Object.entries(layers).map(([name, layer]) => ({ ...layer, name })),
  ]).filter(item => layers[item.name]);
  const variable = selection.variable && layers[selection.variable]
    ? selection.variable
    : first(meta.default_variable, variables[0]?.name);
  const baseLayer = layers[variable] || {};
  const resolutionOptions = normalizeResolutionOptions(baseLayer);
  const resolution = resolutionOptions.some(item => item.key === selection.resolution)
    ? selection.resolution
    : first(baseLayer.default_resolution, resolutionOptions[0]?.key, "native");
  const layer = baseLayer.resolution_layers?.[resolution] || baseLayer;
  return documentFromParts(resource, {
    variables,
    variable,
    resolutionOptions,
    resolution,
    frames: layerFrames({ ...baseLayer, ...layer }, meta),
    times: asArray(first(layer?.times, baseLayer?.times, meta.times)),
  });
}

function wrfDocument(resource, selection) {
  const meta = resource.meta || {};
  const resolutionOptions = normalizeResolutionOptions(meta, meta.default_resolution || "native");
  const resolution = resolutionOptions.some(item => item.key === selection.resolution)
    ? selection.resolution
    : first(meta.default_resolution, resolutionOptions[0]?.key);
  const product = meta.resolution_products?.[resolution] || {};
  const variables = uniqueVariables(first(product.variables, meta.variables, []));
  const variable = variables.some(item => item.name === selection.variable)
    ? selection.variable
    : variables[0]?.name;
  const variableIndex = Math.max(0, variables.findIndex(item => item.name === variable));
  const urls = asArray(first(product.webp_files, meta.webp_files));
  const times = asArray(meta.times);
  const stride = Math.max(1, variables.length);
  const frames = urls
    .filter((_, index) => index % stride === variableIndex)
    .map((url, index) => {
      const item = variables[variableIndex] || {};
      const shape = asArray(item.shape);
      return makeFrame({
        imageUrl: url,
        time: first(times[index], times[times.length - 1]),
        extent: first(item.extent, meta.extent, meta.bbox),
        width: shape.at(-1),
        height: shape.at(-2),
        stats: item,
        unit: first(item.display_unit, item.units, item.unit),
      });
    });
  return documentFromParts(resource, { variables, variable, resolutionOptions, resolution, frames, times });
}

function productDocument(resource, selection) {
  const meta = resource.meta || {};
  const products = uniqueVariables([...asArray(meta.products), ...asArray(meta.composites), ...asArray(meta.variables)]);
  const variable = products.some(item => item.name === selection.variable)
    ? selection.variable
    : first(meta.default_variable, products[0]?.name);
  const product = products.find(item => item.name === variable) || {};
  const resolutionOptions = normalizeResolutionOptions(meta);
  const resolution = resolutionOptions.some(item => item.key === selection.resolution)
    ? selection.resolution
    : resolutionOptions[0]?.key;
  const asset = product.resolution_assets?.[resolution] || product;
  const frames = layerFrames({ ...product, ...asset }, meta);
  if (!frames.length) {
    for (const frame of asArray(meta.frames)) {
      const url = first(frame.webp_url, frame.image_url, frame.webp);
      if (url) frames.push(makeFrame({
        imageUrl: url,
        time: first(frame.valid_time, frame.time, frame.time_label),
        extent: first(frame.extent, meta.extent, meta.bbox),
        width: first(frame.width, meta.grid?.width),
        height: first(frame.height, meta.grid?.height),
        stats: frame,
        unit: product.unit,
      }));
    }
  }
  return documentFromParts(resource, {
    variables: products,
    variable,
    resolutionOptions,
    resolution,
    frames,
    times: asArray(first(meta.times, meta.timeline)).map(item => first(item?.valid_time, item?.time, item?.label, item)),
  });
}

function assetVariableName(path, variables) {
  const name = String(path || "").toUpperCase();
  return variables.find(item => name.includes(`.${String(item.name).toUpperCase()}.`))?.name || "";
}

function cmaFileDocument(resource, selection) {
  const meta = resource.meta || {};
  // 对话只展示当前文件实际登记的 WebP。变量声明中的预期路径不能作为
  // 已有图像使用，否则会把 CMA 总览目录中同名文件混入当前文件。
  const assetPaths = [...new Set([
    ...asArray(meta.webp_files),
    meta.default_webp,
  ].filter(Boolean).map(String))];
  const declared = uniqueVariables(meta.variables || []);
  const variables = declared.filter(item => assetPaths.some(path => assetVariableName(path, [item]) === item.name));
  const fallbackVariable = assetVariableName(assetPaths[0], declared) || meta.default_variable;
  const variable = variables.some(item => item.name === selection.variable)
    ? selection.variable
    : fallbackVariable;
  const selectedPaths = assetPaths.filter(path => assetVariableName(path, declared) === variable);
  const item = variables.find(entry => entry.name === variable) || declared.find(entry => entry.name === variable) || {};
  const times = asArray(meta.times).slice(0, selectedPaths.length || 1);
  const frames = selectedPaths.map((path, index) => makeFrame({
    imageUrl: path,
    time: first(times[index], times[0]),
    extent: first(meta.extent, meta.bbox),
    width: meta.spatial?.nx,
    height: meta.spatial?.ny,
    stats: item.stats,
    unit: item.unit,
  }));
  return documentFromParts(resource, {
    variables,
    variable,
    resolutionOptions: [{ key: "native", label: "原始", playable: true }],
    resolution: "native",
    frames,
    times,
  });
}

function endpointDocument(resource, data, selection) {
  if (data.grid) {
    const variables = uniqueVariables(data.variables || []);
    const variable = first(data.grid.variable, selection.variable, variables[0]?.name);
    const resolutionOptions = normalizeResolutionOptions({
      resolution_options: first(data.resolution_options, data.meta_json?.resolution_options, data.meta_json?.extra?.cma?.resolutions),
    });
    const resolution = first(selection.resolution, data.grid.resolution, resolutionOptions[0]?.key);
    const times = asArray(data.times);
    const frame = makeFrame({
      imageUrl: first(data.grid.webp_url, data.image_url),
      time: first(times[selection.timeIndex], times[0]),
      extent: first(data.grid.extent, data.extent),
      width: data.grid.width,
      height: data.grid.height,
      stats: data.grid,
      unit: data.grid.unit,
    });
    return documentFromParts(resource, { variables, variable, resolutionOptions, resolution, frames: [frame], times });
  }
  return productDocument({ ...resource, meta: data }, selection);
}

function radarEndpointDocument(resource, data, selection) {
  const activeProduct = asArray(data.products)[0] || {};
  const activeLevel = asArray(activeProduct.levels)[0] || {};
  const variables = activeProduct.key ? [normalizeVariable(activeProduct)] : [];
  const times = asArray(data.times);
  const frame = makeFrame({
    imageUrl: first(data.webp_url, data.webp, activeLevel.webp_url),
    time: first(times[selection.timeIndex], times[0]),
    extent: first(activeLevel.extent, data.extent, data.frame?.extent),
    width: first(data.grid?.width, data.frame?.width),
    height: first(data.grid?.height, data.frame?.height),
    stats: first(activeLevel.stats, data.frame?.stats, data.weather_info),
    unit: first(activeProduct.unit, activeLevel.unit, data.weather_info?.unit),
  });
  return documentFromParts(resource, {
    variables,
    variable: variables[0]?.name || "",
    resolutionOptions: [{ key: "native", label: "组合反射率", playable: true }],
    resolution: "native",
    frames: [frame],
    times,
  });
}

function documentFromParts(resource, parts) {
  return {
    dataType: String(resource.data_type || "").toUpperCase(),
    title: `${TYPE_LABELS[String(resource.data_type || "").toUpperCase()] || resource.data_type} 数据可视化`,
    name: resource.file_name || resource.file_uuid,
    variables: parts.variables || [],
    selectedVariable: parts.variable || "",
    resolutionOptions: parts.resolutionOptions || [],
    selectedResolution: parts.resolution || "native",
    frames: parts.frames || [],
    times: parts.times?.length ? parts.times : (parts.frames || []).map(frame => frame.valid_time),
  };
}

async function loadEndpoint(resource, selection, context, endpointType, normalize = endpointDocument) {
  const params = new URLSearchParams({
    level_index: "0",
    time_index: String(selection.timeIndex || 0),
    resolution: selection.resolution || "native",
  });
  if (selection.variable) params.set("variable", selection.variable);
  if (resource.meta_path) params.set("meta_file", resource.meta_path);
  const response = await context.fetch(`${context.apiBase}/api/display/${endpointType}?${params}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || `${TYPE_LABELS[endpointType] || endpointType} 数据读取失败。`);
  }
  return normalize(resource, payload.data || {}, selection);
}

export const DISPLAY_PROVIDERS = Object.freeze({
  CMA: { load: cmaFileDocument },
  RADAR: { load: (resource, selection, context) => loadEndpoint(resource, selection, context, "RADAR", radarEndpointDocument) },
  ERA5: { load: variableLayerDocument },
  GFS: { load: variableLayerDocument },
  ECMWF: { load: variableLayerDocument },
  WRF: { load: wrfDocument },
  HIMAWARI: { load: productDocument },
  FY3: { load: productDocument },
});

export function registeredDisplayType(dataType) {
  const normalized = String(dataType || "").trim().toUpperCase();
  return DISPLAY_PROVIDERS[normalized] ? normalized : "";
}

export async function loadDisplayDocument(resource, selection, context = {}) {
  const type = registeredDisplayType(resource?.data_type);
  if (!type) throw new Error(`当前对话窗口尚未接入 ${resource?.data_type || "该类型"} 可视化。`);
  const document = await DISPLAY_PROVIDERS[type].load(resource, selection || {}, context);
  if (!document.frames.length || !document.frames.some(frame => frame.image_url)) {
    throw new Error(`${TYPE_LABELS[type] || type} 当前文件没有可展示的图像资产。`);
  }
  return document;
}
