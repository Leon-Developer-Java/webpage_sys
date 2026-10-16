export const DISPLAY_PROJECTIONS = ['等经纬','墨卡托','正弦','罗宾逊','兰博托','卫星正视','北极','南极'];

// Display transforms are affine; native values and product fingerprints stay intact.
export function unitPresentation(variable = {}, native = false) {
  const raw = String(variable.units || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, '');
  if (!native && variable.name === 'T2' && ['k','kelvin'].includes(key)) return {unit:'°C',scale:1,offset:-273.15,decimals:1};
  if (!native && variable.name === 'PSFC' && ['pa','pascal','pascals'].includes(key)) return {unit:'hPa',scale:0.01,offset:0,decimals:1};
  const unit = ['ms-1','ms^-1','ms**-1','m/s'].includes(key) ? 'm/s' : raw;
  return {unit,scale:1,offset:0,decimals:variable.name === 'PBLH' ? 0 : 1};
}

export function formatDisplayValue(value, presentation = {scale:1,offset:0,decimals:1}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const converted = value * presentation.scale + presentation.offset;
  if (!Number.isFinite(converted)) return '—';
  const rounded = Number(converted.toFixed(presentation.decimals));
  if (Math.abs(rounded) >= 1e7 || (rounded === 0 && converted !== 0 && Math.abs(converted) < 1e-3)) return converted.toExponential(2);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function paletteGradient(palette) {
  return Array.isArray(palette) && palette.length > 1 && palette.every(c => Array.isArray(c) && c.length === 3 && c.every(n => Number.isFinite(n) && n >= 0 && n <= 255))
    ? 'linear-gradient(to right,' + palette.map(c => 'rgb(' + c.join(',') + ')').join(',') + ')' : null;
}
