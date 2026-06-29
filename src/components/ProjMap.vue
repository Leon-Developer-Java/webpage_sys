<template>
  <div ref="box" class="projmap">
    <canvas ref="canvas" class="proj-canvas"></canvas>
    <slot></slot>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  projection: { type: String, default: "等经纬" },
  tileUrl: String,
  vector: Boolean,
  data: Object,
  grid: { type: Boolean, default: true },
  dark: Boolean,
  syncView: Object,
});
const emit = defineEmits(["view-change"]);

const PROJ = { "等经纬": 0, "墨卡托": 1, "正弦": 2, "罗宾逊": 3, "兰博托": 4, "卫星正视": 5, "北极": 6, "南极": 7 };
const D2R = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const LON0 = 105 * D2R;
const ORTHO_LAT0 = 20 * D2R;

const f1 = 25 * D2R, f2 = 47 * D2R;
const LCC_N = Math.log(Math.cos(f1) / Math.cos(f2)) / Math.log(Math.tan(Math.PI / 4 + f2 / 2) / Math.tan(Math.PI / 4 + f1 / 2));
const LCC_F = Math.cos(f1) * Math.pow(Math.tan(Math.PI / 4 + f1 / 2), LCC_N) / LCC_N;
const LCC_RHO0 = LCC_F;

const RA = [1.0000, 0.9986, 0.9954, 0.9900, 0.9822, 0.9730, 0.9600, 0.9427, 0.9216, 0.8962, 0.8679, 0.8350, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const RB = [0.0000, 0.0620, 0.1240, 0.1860, 0.2480, 0.3100, 0.3720, 0.4340, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0000];

const MAXZ = 19;
const NE_COAST = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson";
const NE_BORDER = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_boundary_lines_land.geojson";

const box = ref(null);
const canvas = ref(null);
let gl, quadProg, lineProg, qloc = {}, lloc = {};
let quadBuf, lineBuf, lineCount = 0, allLines = [];
let baseTex, dataTex, hasBase = false, hasData = false, baseMerc = false;
let baseBox = [-Math.PI, -HALF_PI, Math.PI, HALF_PI];
let center = [0, 0], scale = 1.6, aspect = 1;
let viewLon = LON0, orthoLat = ORTHO_LAT0;
let dragging = false, lastX = 0, lastY = 0, ro;

function centerLon() { return (PROJ[props.projection] ?? 0) === 5 ? viewLon : LON0; }
let mosaicToken = 0, mosaicTimer = 0, animRAF = 0, applyingSync = false, dataTextureToken = 0;
const tileCache = new Map();

const quadVert = `#version 300 es
in vec2 aPos; out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const quadFrag = `#version 300 es
precision highp float;
in vec2 vNdc; out vec4 frag;
uniform int uProj;
uniform vec2 uCenter; uniform float uScale; uniform float uAspect;
uniform float uLon0, uN, uF, uRho0, uOrthoLat0;
uniform float uGrid;
uniform vec3 uOcean, uGridColor;
uniform int uHasBase, uHasData, uBaseMerc;
uniform sampler2D uBase, uData;
uniform vec4 uBaseBox, uDataBox; uniform float uDataAlpha;

const float PI = 3.141592653589793;
const float HP = 1.5707963267948966;

bool invert(int p, vec2 c, out float lon, out float lat){
  if(p == 0){ lon = c.x; lat = c.y; return abs(c.x) <= PI && abs(c.y) <= HP; }
  if(p == 1){ lon = c.x; lat = 2.0*atan(exp(c.y)) - HP; return abs(c.x) <= PI; }
  if(p == 2){ lat = c.y; if(abs(lat) > HP) return false; lon = c.x / cos(lat); return abs(lon) <= PI; }
  if(p == 3){
    float RA[19]; float RB[19];
    RA[0]=1.0000;RA[1]=0.9986;RA[2]=0.9954;RA[3]=0.9900;RA[4]=0.9822;RA[5]=0.9730;RA[6]=0.9600;RA[7]=0.9427;RA[8]=0.9216;RA[9]=0.8962;RA[10]=0.8679;RA[11]=0.8350;RA[12]=0.7986;RA[13]=0.7597;RA[14]=0.7186;RA[15]=0.6732;RA[16]=0.6213;RA[17]=0.5722;RA[18]=0.5322;
    RB[0]=0.0000;RB[1]=0.0620;RB[2]=0.1240;RB[3]=0.1860;RB[4]=0.2480;RB[5]=0.3100;RB[6]=0.3720;RB[7]=0.4340;RB[8]=0.4958;RB[9]=0.5571;RB[10]=0.6176;RB[11]=0.6769;RB[12]=0.7346;RB[13]=0.7903;RB[14]=0.8435;RB[15]=0.8936;RB[16]=0.9394;RB[17]=0.9761;RB[18]=1.0000;
    float ya = abs(c.y) / 1.3523;
    if(ya > 1.0) return false;
    float len = RA[18]; lat = HP;
    for(int i = 0; i < 18; i++){
      if(ya >= RB[i] && ya <= RB[i+1]){
        float t = (ya - RB[i]) / (RB[i+1] - RB[i]);
        lat = (float(i) + t) * 5.0 * (PI / 180.0);
        len = RA[i] + t * (RA[i+1] - RA[i]);
        break;
      }
    }
    lat *= sign(c.y);
    lon = c.x / (0.8487 * len);
    return abs(lon) <= PI;
  }
  if(p == 4){
    float dy = uRho0 - c.y;
    float rho = sign(uN) * sqrt(c.x*c.x + dy*dy);
    if(rho == 0.0) return false;
    float th = atan(sign(uN)*c.x, sign(uN)*dy);
    lon = th / uN;
    lat = 2.0 * atan(pow(uF/rho, 1.0/uN)) - HP;
    return abs(lon) <= PI;
  }
  if(p == 5){
    float rho = length(c);
    if(rho > 1.0) return false;
    if(rho < 1e-6){ lon = 0.0; lat = uOrthoLat0; return true; }
    float cc = asin(rho);
    lat = asin(cos(cc)*sin(uOrthoLat0) + c.y*sin(cc)*cos(uOrthoLat0)/rho);
    lon = atan(c.x*sin(cc), rho*cos(uOrthoLat0)*cos(cc) - c.y*sin(uOrthoLat0)*sin(cc));
    return true;
  }
  if(p == 6){
    float r = length(c);
    lat = HP - 2.0*atan(r);
    lon = atan(c.x, -c.y);
    return lat > -HP * 0.5;
  }
  float r = length(c);
  lat = 2.0*atan(r) - HP;
  lon = atan(c.x, c.y);
  return lat < HP * 0.5;
}

float gline(float v, float step){
  float f = v / step;
  float d = abs(f - floor(f + 0.5));
  float w = fwidth(f) * 1.5;
  return 1.0 - smoothstep(0.0, w, d);
}

void main(){
  vec2 c = uCenter + vNdc * vec2(uScale * uAspect, uScale);
  float lon, lat;
  if(!invert(uProj, c, lon, lat)){ frag = vec4(0.0); return; }
  lon += uLon0;
  lon = mod(lon + PI, 2.0*PI) - PI;

  vec3 col = uOcean;
  if(uHasBase == 1){
    float bu = 0.0, bv = 0.0;
    if(uBaseMerc == 1){
      float lt = clamp(lat, -1.4844, 1.4844);
      float mx = (lon / PI + 1.0) * 0.5;
      float my = (1.0 - log(tan(PI * 0.25 + lt * 0.5)) / PI) * 0.5;
      bu = (mx - uBaseBox.x) / (uBaseBox.z - uBaseBox.x);
      bv = clamp((my - uBaseBox.y) / (uBaseBox.w - uBaseBox.y), 0.0, 1.0);
    } else {
      bu = (lon - uBaseBox.x) / (uBaseBox.z - uBaseBox.x);
      bv = (uBaseBox.w - lat) / (uBaseBox.w - uBaseBox.y);
    }
    if(bu >= 0.0 && bu <= 1.0 && bv >= 0.0 && bv <= 1.0) col = texture(uBase, vec2(bu, bv)).rgb;
  }
  if(uHasData == 1){
    float u = (lon - uDataBox.x) / (uDataBox.z - uDataBox.x);
    float v = (uDataBox.w - lat) / (uDataBox.w - uDataBox.y);
    if(u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0){
      vec4 d = texture(uData, vec2(u, v));
      col = mix(col, d.rgb, d.a * uDataAlpha);
    }
  }
  float g = max(gline(lon, radians(15.0)), gline(lat, radians(15.0)));
  col = mix(col, uGridColor, g * 0.28 * uGrid);
  frag = vec4(col, 1.0);
}`;

const lineVert = `#version 300 es
in vec2 aPlane;
uniform vec2 uCenter; uniform float uScale; uniform float uAspect;
void main(){
  vec2 ndc = (aPlane - uCenter) / vec2(uScale * uAspect, uScale);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const lineFrag = `#version 300 es
precision highp float;
out vec4 frag; uniform vec3 uColor;
void main(){ frag = vec4(uColor, 1.0); }`;

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function makeProgram(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function wrapPi(a) { return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }

function forward(p, lon, lat) {
  if (p === 0) return [lon, lat];
  if (p === 1) { if (Math.abs(lat) > 85 * D2R) return null; return [lon, Math.log(Math.tan(Math.PI / 4 + lat / 2))]; }
  if (p === 2) return [lon * Math.cos(lat), lat];
  if (p === 3) {
    const a = Math.abs(lat) / (5 * D2R), i = Math.min(17, Math.floor(a)), t = a - i;
    const len = RA[i] + t * (RA[i + 1] - RA[i]), yy = RB[i] + t * (RB[i + 1] - RB[i]);
    return [0.8487 * len * lon, 1.3523 * yy * Math.sign(lat || 1)];
  }
  if (p === 4) {
    if (lat <= -89 * D2R) return null;
    const rho = LCC_F / Math.pow(Math.tan(Math.PI / 4 + lat / 2), LCC_N), th = LCC_N * lon;
    return [rho * Math.sin(th), LCC_RHO0 - rho * Math.cos(th)];
  }
  if (p === 5) {
    const cc = Math.sin(orthoLat) * Math.sin(lat) + Math.cos(orthoLat) * Math.cos(lat) * Math.cos(lon);
    if (cc < 0) return null;
    return [Math.cos(lat) * Math.sin(lon), Math.cos(orthoLat) * Math.sin(lat) - Math.sin(orthoLat) * Math.cos(lat) * Math.cos(lon)];
  }
  if (p === 6) { if (lat < -80 * D2R) return null; const r = Math.tan(Math.PI / 4 - lat / 2); return [r * Math.sin(lon), -r * Math.cos(lon)]; }
  if (lat > 80 * D2R) return null; const r = Math.tan(Math.PI / 4 + lat / 2); return [r * Math.sin(lon), r * Math.cos(lon)];
}

function invert(p, x, y) {
  if (p === 0) return Math.abs(x) <= Math.PI && Math.abs(y) <= HALF_PI ? [x, y] : null;
  if (p === 1) return Math.abs(x) > Math.PI ? null : [x, 2 * Math.atan(Math.exp(y)) - HALF_PI];
  if (p === 2) { if (Math.abs(y) > HALF_PI) return null; const lon = x / Math.cos(y); return Math.abs(lon) > Math.PI ? null : [lon, y]; }
  if (p === 3) {
    const ya = Math.abs(y) / 1.3523;
    if (ya > 1) return null;
    let lat = HALF_PI, len = RA[18];
    for (let i = 0; i < 18; i++) if (ya >= RB[i] && ya <= RB[i + 1]) { const t = (ya - RB[i]) / (RB[i + 1] - RB[i]); lat = (i + t) * 5 * D2R; len = RA[i] + t * (RA[i + 1] - RA[i]); break; }
    lat *= Math.sign(y || 1);
    const lon = x / (0.8487 * len);
    return Math.abs(lon) > Math.PI ? null : [lon, lat];
  }
  if (p === 4) {
    const dy = LCC_RHO0 - y, rho = Math.sign(LCC_N) * Math.sqrt(x * x + dy * dy);
    if (rho === 0) return null;
    const th = Math.atan2(Math.sign(LCC_N) * x, Math.sign(LCC_N) * dy);
    const lon = th / LCC_N, lat = 2 * Math.atan(Math.pow(LCC_F / rho, 1 / LCC_N)) - HALF_PI;
    return Math.abs(lon) > Math.PI ? null : [lon, lat];
  }
  if (p === 5) {
    const rho = Math.hypot(x, y);
    if (rho > 1) return null;
    if (rho < 1e-6) return [0, orthoLat];
    const cc = Math.asin(rho);
    const lat = Math.asin(Math.cos(cc) * Math.sin(orthoLat) + y * Math.sin(cc) * Math.cos(orthoLat) / rho);
    const lon = Math.atan2(x * Math.sin(cc), rho * Math.cos(orthoLat) * Math.cos(cc) - y * Math.sin(orthoLat) * Math.sin(cc));
    return [lon, lat];
  }
  if (p === 6) { const r = Math.hypot(x, y), lat = HALF_PI - 2 * Math.atan(r); return lat <= -HALF_PI * 0.5 ? null : [Math.atan2(x, -y), lat]; }
  const r = Math.hypot(x, y), lat = 2 * Math.atan(r) - HALF_PI;
  return lat >= HALF_PI * 0.5 ? null : [Math.atan2(x, y), lat];
}

function fitView() {
  const p = PROJ[props.projection] ?? 0;
  let latMin = -85, latMax = 85;
  if (p === 6) { latMin = -5; latMax = 90; }
  if (p === 7) { latMin = -90; latMax = 5; }
  if (p === 4) { latMin = 0; latMax = 60; }
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  const loMax = p === 4 ? 100 : 180, loMin = p === 4 ? -100 : -180;
  for (let la = latMin; la <= latMax; la += 5)
    for (let lo = loMin; lo <= loMax; lo += 10) {
      const q = forward(p, lo * D2R, la * D2R);
      if (!q || !isFinite(q[0]) || !isFinite(q[1])) continue;
      mnx = Math.min(mnx, q[0]); mxx = Math.max(mxx, q[0]);
      mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]);
    }
  center = [(mnx + mxx) / 2, (mny + mxy) / 2];
  scale = Math.max((mxy - mny) / 2, (mxx - mnx) / 2 / aspect) * 1.08;
}

function fitExtent(ext) {
  const p = PROJ[props.projection] ?? 0;
  const [w, s, e, n] = ext.map(Number);
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9, ok = false;
  const dla = (n - s) / 8 || 1, dlo = (e - w) / 8 || 1;
  for (let la = s; la <= n + 1e-6; la += dla)
    for (let lo = w; lo <= e + 1e-6; lo += dlo) {
      const q = forward(p, wrapPi(lo * D2R - centerLon()), la * D2R);
      if (!q || !isFinite(q[0]) || !isFinite(q[1])) continue;
      ok = true;
      mnx = Math.min(mnx, q[0]); mxx = Math.max(mxx, q[0]);
      mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]);
    }
  if (!ok) return null;
  return { center: [(mnx + mxx) / 2, (mny + mxy) / 2], scale: Math.max((mxy - mny) / 2, (mxx - mnx) / 2 / aspect) * 1.35 };
}

function animateTo(target) {
  cancelAnimationFrame(animRAF);
  const c0 = center.slice(), s0 = scale, t0 = performance.now(), dur = 700;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    center = [c0[0] + (target.center[0] - c0[0]) * e, c0[1] + (target.center[1] - c0[1]) * e];
    scale = s0 + (target.scale - s0) * e;
    render();
    if (k < 1) animRAF = requestAnimationFrame(step);
    else if (props.tileUrl) scheduleMosaic();
  };
  animRAF = requestAnimationFrame(step);
}

function flyTo(ext) {
  if (!Array.isArray(ext) || ext.length !== 4) return;
  const t = fitExtent(ext);
  if (t) animateTo(t);
}

function zoomBy(factor) {
  scale = Math.min(20, Math.max(0.02, scale * factor));
  render();
  if (props.tileUrl) scheduleMosaic();
}

function home() {
  viewLon = LON0; orthoLat = ORTHO_LAT0;
  fitView(); render();
  if (props.tileUrl) scheduleMosaic();
}

function emitView() {
  emit("view-change", { center: center.slice(), scale, viewLon, orthoLat });
}

defineExpose({ flyTo, zoomBy, home });

function makeTexture(source, slot, lonBox, merc) {
  const tex = slot === 0 ? (baseTex || gl.createTexture()) : (dataTex || gl.createTexture());
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (slot === 0) { baseTex = tex; hasBase = true; baseBox = lonBox; baseMerc = !!merc; } else { dataTex = tex; hasData = true; }
}

function loadDataTexture(url, token) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (token !== dataTextureToken) return;
    makeTexture(img, 1);
    render();
  };
  img.onerror = () => {
    if (token !== dataTextureToken) return;
    hasData = false;
    render();
  };
  img.src = url;
}

function visibleBox() {
  const p = PROJ[props.projection] ?? 0;
  let mnLa = 90, mxLa = -90, mnLo = 180, mxLo = -180, ok = false, wrap = false;
  for (let i = 0; i <= 12; i++)
    for (let j = 0; j <= 12; j++) {
      const x = center[0] + (i / 12 * 2 - 1) * scale * aspect;
      const y = center[1] + (j / 12 * 2 - 1) * scale;
      const inv = invert(p, x, y);
      if (!inv) continue;
      ok = true;
      const lo = wrapPi(inv[0] + centerLon()) / D2R, la = inv[1] / D2R;
      mnLa = Math.min(mnLa, la); mxLa = Math.max(mxLa, la);
      mnLo = Math.min(mnLo, lo); mxLo = Math.max(mxLo, lo);
    }
  if (!ok) return null;
  if (mxLo - mnLo > 180 || mxLa > 84 || mnLa < -84) wrap = true;
  return { mnLa: Math.max(-85, mnLa), mxLa: Math.min(85, mxLa), mnLo, mxLo, wrap };
}

function mercY(la) { const l = Math.max(-85, Math.min(85, la)) * D2R; return (1 - Math.log(Math.tan(Math.PI / 4 + l / 2)) / Math.PI) / 2; }

function buildMosaic() {
  const vb = visibleBox();
  if (!vb) return;
  const cssW = box.value.clientWidth;
  const lonSpan = vb.wrap ? 360 : Math.max(1, vb.mxLo - vb.mnLo);
  let z = Math.round(Math.log2(360 / Math.max(1e-4, lonSpan / cssW * 256)));
  z = Math.min(MAXZ, Math.max(0, z));
  let X0, X1, Y0, Y1, n;
  for (; z >= 0; z--) {
    n = Math.pow(2, z);
    const mx0 = vb.wrap ? 0 : (vb.mnLo + 180) / 360, mx1 = vb.wrap ? 1 : (vb.mxLo + 180) / 360;
    X0 = Math.max(0, Math.min(n - 1, Math.floor(mx0 * n)));
    X1 = Math.max(0, Math.min(n - 1, Math.floor(mx1 * n)));
    Y0 = Math.max(0, Math.min(n - 1, Math.floor(mercY(vb.mxLa) * n)));
    Y1 = Math.max(0, Math.min(n - 1, Math.floor(mercY(vb.mnLa) * n)));
    if ((X1 - X0 + 1) * (Y1 - Y0 + 1) <= 40) break;
  }
  if (z < 0) { z = 0; n = 1; X0 = 0; X1 = 0; Y0 = 0; Y1 = 0; }
  const token = ++mosaicToken;
  const cols = X1 - X0 + 1, rows = Y1 - Y0 + 1;
  const cv = document.createElement("canvas");
  cv.width = cols * 256; cv.height = rows * 256;
  const ctx = cv.getContext("2d");
  const jobs = [];
  for (let ty = Y0; ty <= Y1; ty++)
    for (let tx = X0; tx <= X1; tx++)
      jobs.push(loadTile(z, tx, ty).then(img => { if (img) ctx.drawImage(img, (tx - X0) * 256, (ty - Y0) * 256); }));
  Promise.all(jobs).then(() => {
    if (token !== mosaicToken) return;
    makeTexture(cv, 0, [X0 / n, Y0 / n, (X1 + 1) / n, (Y1 + 1) / n], true);
    render();
  });
}

function loadTile(z, x, y) {
  const url = props.tileUrl.replace("{z}", z).replace("{y}", y).replace("{x}", x);
  if (tileCache.has(url)) return Promise.resolve(tileCache.get(url));
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { tileCache.set(url, img); resolve(img); };
    img.onerror = () => { tileCache.set(url, null); resolve(null); };
    img.src = url;
  });
}

function scheduleMosaic() {
  clearTimeout(mosaicTimer);
  mosaicTimer = setTimeout(buildMosaic, 160);
}

async function loadVectors() {
  const [coast, border] = await Promise.all([fetch(NE_COAST).then(r => r.json()), fetch(NE_BORDER).then(r => r.json())]);
  allLines = [];
  collectLines(coast, allLines);
  collectLines(border, allLines);
  rebuildLines();
  render();
}

function collectLines(geojson, out) {
  for (const ft of geojson.features) addGeom(ft.geometry, out);
}

function addGeom(g, out) {
  if (!g) return;
  if (g.type === "LineString") out.push(g.coordinates);
  else if (g.type === "MultiLineString" || g.type === "Polygon") for (const c of g.coordinates) out.push(c);
  else if (g.type === "MultiPolygon") for (const poly of g.coordinates) for (const ring of poly) out.push(ring);
}

function rebuildLines() {
  const p = PROJ[props.projection] ?? 0, verts = [];
  for (const line of allLines) {
    let prev = null;
    for (const pt of line) {
      const q = forward(p, wrapPi(pt[0] * D2R - centerLon()), pt[1] * D2R);
      if (!q || !isFinite(q[0]) || !isFinite(q[1])) { prev = null; continue; }
      if (prev && Math.abs(q[0] - prev[0]) < 0.5 && Math.abs(q[1] - prev[1]) < 0.5) verts.push(prev[0], prev[1], q[0], q[1]);
      prev = q;
    }
  }
  lineCount = verts.length / 2;
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
}

function resize() {
  const w = box.value.clientWidth, h = box.value.clientHeight, dpr = devicePixelRatio || 1;
  canvas.value.width = w * dpr; canvas.value.height = h * dpr;
  aspect = w / h;
  gl.viewport(0, 0, canvas.value.width, canvas.value.height);
  if (props.tileUrl) scheduleMosaic();
  render();
}

function render() {
  if (!gl) return;
  gl.clear(gl.COLOR_BUFFER_BIT);
  const ocean = props.dark ? [0.043, 0.102, 0.169] : [0.482, 0.733, 0.839];
  gl.useProgram(quadProg);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(qloc.aPos);
  gl.vertexAttribPointer(qloc.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(qloc.uProj, PROJ[props.projection] ?? 0);
  gl.uniform2f(qloc.uCenter, center[0], center[1]);
  gl.uniform1f(qloc.uScale, scale);
  gl.uniform1f(qloc.uAspect, aspect);
  gl.uniform1f(qloc.uLon0, centerLon());
  gl.uniform1f(qloc.uN, LCC_N);
  gl.uniform1f(qloc.uF, LCC_F);
  gl.uniform1f(qloc.uRho0, LCC_RHO0);
  gl.uniform1f(qloc.uOrthoLat0, orthoLat);
  gl.uniform1f(qloc.uGrid, props.grid ? 1 : 0);
  gl.uniform3f(qloc.uOcean, ocean[0], ocean[1], ocean[2]);
  gl.uniform3f(qloc.uGridColor, 1, 1, 1);
  gl.uniform1i(qloc.uHasBase, hasBase ? 1 : 0);
  gl.uniform1i(qloc.uHasData, hasData ? 1 : 0);
  gl.uniform1i(qloc.uBaseMerc, baseMerc ? 1 : 0);
  gl.uniform4f(qloc.uBaseBox, baseBox[0], baseBox[1], baseBox[2], baseBox[3]);
  const e = props.data?.extent;
  if (e) gl.uniform4f(qloc.uDataBox, e[0] * D2R, e[1] * D2R, e[2] * D2R, e[3] * D2R);
  gl.uniform1f(qloc.uDataAlpha, props.data?.alpha ?? 1);
  if (hasBase) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, baseTex); gl.uniform1i(qloc.uBase, 0); }
  if (hasData) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dataTex); gl.uniform1i(qloc.uData, 1); }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (props.vector && lineCount > 0) {
    const lc = props.dark ? [0.86, 0.90, 0.96] : [0.16, 0.20, 0.26];
    gl.useProgram(lineProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.enableVertexAttribArray(lloc.aPlane);
    gl.vertexAttribPointer(lloc.aPlane, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(lloc.uCenter, center[0], center[1]);
    gl.uniform1f(lloc.uScale, scale);
    gl.uniform1f(lloc.uAspect, aspect);
    gl.uniform3f(lloc.uColor, lc[0], lc[1], lc[2]);
    gl.drawArrays(gl.LINES, 0, lineCount);
  }
}

function onDown(e) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
function onMove(e) {
  if (!dragging) return;
  if ((PROJ[props.projection] ?? 0) === 5) {
    viewLon -= (e.clientX - lastX) * 0.005;
    orthoLat = Math.max(-1.4, Math.min(1.4, orthoLat + (e.clientY - lastY) * 0.005));
    lastX = e.clientX; lastY = e.clientY;
    if (props.vector) rebuildLines();
    if (props.tileUrl) scheduleMosaic();
    render(); emitView();
    return;
  }
  center[0] -= (e.clientX - lastX) / box.value.clientWidth * 2 * scale * aspect;
  center[1] += (e.clientY - lastY) / box.value.clientHeight * 2 * scale;
  lastX = e.clientX; lastY = e.clientY;
  render(); emitView();
}
function onUp() { if (dragging && props.tileUrl) scheduleMosaic(); dragging = false; }
function onWheel(e) {
  e.preventDefault();
  scale = Math.min(20, Math.max(0.02, scale * Math.exp(e.deltaY * 0.001)));
  render(); emitView();
  if (props.tileUrl) scheduleMosaic();
}

onMounted(() => {
  gl = canvas.value.getContext("webgl2", { alpha: true });
  quadProg = makeProgram(quadVert, quadFrag);
  lineProg = makeProgram(lineVert, lineFrag);
  qloc.aPos = gl.getAttribLocation(quadProg, "aPos");
  for (const n of ["uProj", "uCenter", "uScale", "uAspect", "uLon0", "uN", "uF", "uRho0", "uOrthoLat0", "uGrid", "uOcean", "uGridColor", "uHasBase", "uHasData", "uBaseMerc", "uBase", "uData", "uBaseBox", "uDataBox", "uDataAlpha"])
    qloc[n] = gl.getUniformLocation(quadProg, n);
  lloc.aPlane = gl.getAttribLocation(lineProg, "aPlane");
  for (const n of ["uCenter", "uScale", "uAspect", "uColor"]) lloc[n] = gl.getUniformLocation(lineProg, n);
  quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  lineBuf = gl.createBuffer();
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  aspect = box.value.clientWidth / box.value.clientHeight;
  fitView();
  if (props.tileUrl) scheduleMosaic();
  if (props.vector) loadVectors();
  if (props.data?.src) loadDataTexture(props.data.src, ++dataTextureToken);
  ro = new ResizeObserver(resize);
  ro.observe(box.value);
  canvas.value.addEventListener("pointerdown", onDown);
  addEventListener("pointermove", onMove);
  addEventListener("pointerup", onUp);
  canvas.value.addEventListener("wheel", onWheel, { passive: false });
});

watch(() => props.projection, () => { viewLon = LON0; orthoLat = ORTHO_LAT0; fitView(); if (props.vector && allLines.length) rebuildLines(); if (props.tileUrl) scheduleMosaic(); render(); });
watch(() => [props.grid, props.dark], render);
watch(() => props.tileUrl, v => { hasBase = false; ++mosaicToken; if (v) scheduleMosaic(); else render(); });
watch(() => props.vector, v => { if (v) { if (allLines.length) rebuildLines(); else loadVectors(); } render(); });
watch(() => props.data, () => {
  ++dataTextureToken;
  hasData = false;
  render();
  if (props.data?.src) loadDataTexture(props.data.src, dataTextureToken);
}, { deep: true });
watch(() => props.syncView, v => {
  if (!v || applyingSync) return;
  applyingSync = true;
  center = v.center.slice(); scale = v.scale; viewLon = v.viewLon; orthoLat = v.orthoLat;
  if (props.vector && allLines.length) rebuildLines();
  if (props.tileUrl) scheduleMosaic();
  render();
  applyingSync = false;
}, { deep: true });

onBeforeUnmount(() => {
  ro?.disconnect();
  clearTimeout(mosaicTimer);
  removeEventListener("pointermove", onMove);
  removeEventListener("pointerup", onUp);
});
</script>

<style scoped>
.projmap { position: relative; width: 100%; height: 100%; overflow: hidden; }
.proj-canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; }
.proj-canvas:active { cursor: grabbing; }
</style>
