// NetCDF valid times without an offset are UTC, regardless of browser timezone.
export function forecastTimestamp(value) {
  if (!value) return Number.NaN;
  let text = String(value).replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/(\.\d{3})\d+/, '$1');
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += 'Z';
  return Date.parse(text);
}

export function seasonalIssueTime(resource) {
  const values = resource?.attributes?.issue_times;
  const provided = resource?.meta?.issue_time || resource?.meta?.run_time || (Array.isArray(values) ? values[0] : values);
  const time = forecastTimestamp(provided);
  if (Number.isFinite(time)) return new Date(time).toISOString();
  // Legacy catalogues omit issue_times. These provider filenames encode the
  // initialization month; do not guess it from a generic uploaded filename.
  const match = String(resource?.file_name || '').match(/^(?:CDS_[a-z_]+_s[\d.]+_|[\w.]+\.prate\.)(\d{4})(\d{2})(?:\.|_)/i);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return '';
  return `${match[1]}-${match[2]}-01T00:00:00.000Z`;
}

export function seasonalResourceTimes(resource) {
  const meta = resource?.meta || resource || {};
  const times = resource?.times?.length ? resource.times : meta.times;
  if (times?.length) return [...new Set(times)].sort((a,b) => forecastTimestamp(a) - forecastTimestamp(b));
  return [...new Set(Object.values(meta.variable_layers || {}).flatMap(layer =>
    (layer.frames || []).map(frame => frame.valid_time).filter(Boolean),
  ))].sort((a,b) => forecastTimestamp(a) - forecastTimestamp(b));
}

export function matchingSeasonalTimes(resource, start, end) {
  return seasonalResourceTimes(resource).filter(value => {
    const time = forecastTimestamp(value);
    return (!Number.isFinite(start) || time >= start) && (!Number.isFinite(end) || time <= end);
  });
}

export function filterSeasonalResource(resource, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return resource;
  const original = resource.meta || {};
  const layers = {};
  for (const [key, layer] of Object.entries(original.variable_layers || {})) {
    const allFrames = layer.frames?.length ? layer.frames : (layer.image_urls || []).map((url,index) => ({
      url, valid_time: layer.times?.[index], forecast_hour: layer.forecast_hours?.[index], forecast_label: layer.forecast_labels?.[index],
    }));
    const frames = allFrames.filter(frame => {
      const time = forecastTimestamp(frame.valid_time);
      return time >= start && time <= end;
    });
    if (!frames.length) continue;
    layers[key] = {...layer, frames, times: frames.map(frame => frame.valid_time),
      image_urls: frames.map(frame => frame.url), image_url: frames[0].url,
      forecast_hours: frames.map(frame => frame.forecast_hour), forecast_labels: frames.map(frame => frame.forecast_label),
      valid_hours: frames.map(frame => new Date(forecastTimestamp(frame.valid_time)).getUTCHours()),
      valid_time_hours: frames.map(frame => new Date(forecastTimestamp(frame.valid_time)).getUTCHours()),
    };
  }
  const defaultKey = layers[original.default_variable] ? original.default_variable : Object.keys(layers)[0];
  const layer = layers[defaultKey];
  const times = [...new Set(Object.values(layers).flatMap(item => item.times))].sort((a,b) => forecastTimestamp(a) - forecastTimestamp(b));
  const presentation = {times: layer?.times || [], frames: layer?.frames || [], image_url: layer?.image_url || '', image_urls: layer?.image_urls || [],
    forecast_hours: layer?.forecast_hours || [], forecast_labels: layer?.forecast_labels || [],
  };
  const meta = {...original, ...presentation, variable_layers: layers, default_variable: defaultKey,
    variable_options: (original.variable_options || []).filter(option => layers[option.key]),
    weather_info: {...original.weather_info, ...presentation},
  };
  return {...resource, meta, times, frame_count: times.length, time_start: times[0] || null, time_end: times.at(-1) || null};
}

export function formatForecastTime(value, zone = 'UTC') {
  const time = forecastTimestamp(value);
  if (!Number.isFinite(time)) return '未提供';
  return new Date(time + (zone === 'Asia/Shanghai' ? 8 * 3600000 : 0)).toISOString().slice(0,16).replace('T',' ');
}
