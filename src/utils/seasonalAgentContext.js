import {forecastTimestamp} from './seasonalSelection.js';

export function seasonalAgentContext(input = {}) {
  if (input.topic === 'products') return {topic: 'products'};
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(input.fileUuid || ''))) return null;
  const time = forecastTimestamp(input.validTime);
  if (!Number.isFinite(time) || typeof input.variableKey !== 'string' || !input.variableKey.trim() || input.variableKey.length > 160) return null;
  let region, validTimes;
  if (input.region !== undefined) {
    const bbox = input.region?.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(v => typeof v === 'number' && Number.isFinite(v)) ||
      !(-180 <= bbox[0] && bbox[0] < bbox[2] && bbox[2] <= 180 && -90 <= bbox[1] && bbox[1] < bbox[3] && bbox[3] <= 90)) return null;
    region = {name:typeof input.region.name === 'string' ? input.region.name.slice(0,80) : '指定范围', bbox:[...bbox]};
  }
  if (input.validTimes !== undefined) {
    if (!Array.isArray(input.validTimes) || !input.validTimes.length || input.validTimes.length > 36 || !input.validTimes.every(v => Number.isFinite(forecastTimestamp(v)))) return null;
    validTimes = [...new Set(input.validTimes.map(v => new Date(forecastTimestamp(v)).toISOString()))].sort();
    if (!validTimes.includes(new Date(time).toISOString())) return null;
  }
  return {topic:'map', fileUuid:input.fileUuid, variableKey:input.variableKey, validTime:new Date(time).toISOString(),
    ...(region ? {region} : {}), ...(validTimes ? {validTimes} : {})};
}

export function seasonalAgentQuery(context) {
  const safe = seasonalAgentContext(context);
  return safe?.topic === 'products' ? {seasonal_topic:'products'} : safe ? {
    seasonal_topic:'map', seasonal_file_uuid:safe.fileUuid, seasonal_variable:safe.variableKey, seasonal_valid_time:safe.validTime,
    ...(safe.region ? {seasonal_region:JSON.stringify(safe.region)} : {}), ...(safe.validTimes ? {seasonal_valid_times:JSON.stringify(safe.validTimes)} : {}),
  } : {};
}

export function seasonalContextFromQuery(query) {
  try {
    return seasonalAgentContext({topic:query.seasonal_topic, fileUuid:query.seasonal_file_uuid, variableKey:query.seasonal_variable, validTime:query.seasonal_valid_time,
      ...(query.seasonal_region ? {region:JSON.parse(query.seasonal_region)} : {}), ...(query.seasonal_valid_times ? {validTimes:JSON.parse(query.seasonal_valid_times)} : {})});
  } catch { return null; }
}
