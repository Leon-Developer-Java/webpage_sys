import { forecastTimestamp } from './seasonalSelection.js';

/** Validate against actual server metadata; never silently substitute a frame. */
export function resolveSeasonalMapSelection(resource, variableKey, validTime, validTimes, region) {
  if (!/^SEASONAL_?PRECIP(?:ITATION)?$/i.test(String(resource?.data_type || ''))) throw new Error('该文件不是季节降水产品。');
  const layers = resource.meta?.variable_layers;
  const layer = layers?.[variableKey];
  if (!layer || !Array.isArray(layer.frames)) throw new Error('指定变量不存在，未替换为其他要素。');
  const target = forecastTimestamp(validTime);
  const matches = layer.frames.flatMap((frame,index) => forecastTimestamp(frame.valid_time) === target ? [index] : []);
  if (!Number.isFinite(target) || matches.length !== 1) throw new Error('指定有效时次不存在或不唯一，未替换为最新图。');
  if (region) {
    const extent = layer.extent || resource.meta.extent;
    const [w,s,e,n] = region.bbox;
    if (!Array.isArray(extent) || !(extent[0] <= w && extent[1] <= s && extent[2] >= e && extent[3] >= n)) throw new Error('该产品不覆盖指定地区，未显示其他区域的数据。');
  }
  const frames = seasonalMapFrames(layer, validTimes);
  return {variableKey, frameIndex:frames.findIndex(frame => forecastTimestamp(frame.valid_time) === target)};
}

export function seasonalMapFrames(layer, validTimes) {
  if (!validTimes) return layer.frames;
  return validTimes.map(time => {
    const matches = layer.frames.filter(frame => forecastTimestamp(frame.valid_time) === forecastTimestamp(time));
    if (matches.length !== 1) throw new Error('目标时段有缺失或重复帧，未替换月份。');
    return matches[0];
  });
}
