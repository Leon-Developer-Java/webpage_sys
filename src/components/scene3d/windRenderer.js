// Original Nanjing WebGPU display kernels; field preparation and business calculations run on the server.
import {requestWindDevice} from './windDevice';
  const MAX_PARTICLE_COUNT = 24000;
  const ACTIVE_LEVELS = 32;
  const WIND_MAX = 12;
  const FIELD_TOP_HEIGHT = 4500;
  const VOLUME_GRID_X = 48;
  const VOLUME_GRID_Y = 48;
  const VOLUME_GRID_Z = 16;
  const BODY_SAMPLE_COUNT = MAX_PARTICLE_COUNT;
  const STREAMLINE_SEGMENTS = 12;
  const LAYER_GRID_X = 102;
  const LAYER_GRID_Y = 102;
  const LAYER_COUNT = 16;
  const LAYER_VERTEX_COUNT = (LAYER_GRID_X - 1) * (LAYER_GRID_Y - 1) * LAYER_COUNT * 6;
  const VOLUME_EDGE_COUNT =
    (VOLUME_GRID_X - 1) * VOLUME_GRID_Y * VOLUME_GRID_Z
    + VOLUME_GRID_X * (VOLUME_GRID_Y - 1) * VOLUME_GRID_Z
    + VOLUME_GRID_X * VOLUME_GRID_Y * (VOLUME_GRID_Z - 1);

  export class WrfWindWebGpu {
    constructor(canvas, viewer, manifest, options = {}) {
      this.canvas = canvas;
      this.viewer = viewer;
      this.manifest = manifest;
      this.status = options.status || (() => {});
      this.fetch = options.fetch;
      this.terrainScale = 1;
      this.displayHeight = 2000;
      this.particleCount = 8000;
      this.smoothing = 1;
      this.renderMode = "particles";
      this.bodyResolution = 900;
      this.speedThreshold = 0;
      this.cropPolygon = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0];
      this.frameIndex = -1;
      this.running = false;
      this.lastTime = performance.now();
      this.disposed = false;
      this.deviceGeneration = 0;
      this.recoveryAttempts = 0;
      this.requestedFrame = 0;
    }

    async initialise() {
      const generation=++this.deviceGeneration;
      const {device}=await requestWindDevice(navigator.gpu);
      if(this.disposed||generation!==this.deviceGeneration){device.destroy();throw new DOMException('Aborted','AbortError');}
      this.device=device;
      device.lost.then(info=>{
        if(this.disposed||this.device!==device||info.reason==='destroyed')return;
        if(performance.now()-(this.readyAt||0)>30000)this.recoveryAttempts=0;
        this.running=false;cancelAnimationFrame(this.animation);
        this.context?.unconfigure();
        this.recoverOriginalDisplay();
      });
      device.addEventListener('uncapturederror',event=>{
        if(!this.disposed&&this.device===device)this.status(`原风场 GPU 错误：${event.error.message}`);
      });
      this.context = this.canvas.getContext("webgpu");
      if(!this.context)throw new Error('原风场 WebGPU 画布创建失败');
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" });
      device.pushErrorScope('validation');
      this.createResources();
      const validation=await device.popErrorScope();
      if(validation)throw new Error('原风场渲染初始化失败：'+validation.message);
      await this.loadTerrain();
      this.frameIndex=-1;
      await this.setFrame(this.requestedFrame);
      if(this.disposed||generation!==this.deviceGeneration)return this;
      this.running = true;
      this.readyAt=performance.now();
      this.lastTime = performance.now();
      this.animation = requestAnimationFrame((time) => this.draw(time));
      return this;
    }

    recoverOriginalDisplay(){
      if(this.disposed||this.recoveryTimer)return;
      if(++this.recoveryAttempts>3){this.status('原风场显卡连接恢复失败，请点击“重连原风场”');return;}
      this.status(`原风场显卡连接中断，正在恢复原显示（${this.recoveryAttempts}/3）…`);
      this.recoveryTimer=setTimeout(async()=>{
        this.recoveryTimer=null;
        try{await this.initialise();}
        catch(error){
          if(this.disposed)return;
          this.device?.destroy();
          this.recoverOriginalDisplay();
        }
      },this.recoveryAttempts*500);
    }

    createResources() {
      const { device } = this;
      const shader = device.createShaderModule({ code: this.shaderCode() });
      const seed = new Float32Array(MAX_PARTICLE_COUNT * 4);
      for (let i = 0; i < MAX_PARTICLE_COUNT; i += 1) {
        seed[i * 4] = Math.random();
        seed[i * 4 + 1] = Math.random();
        seed[i * 4 + 2] = Math.pow(Math.random(), 3.0);
        seed[i * 4 + 3] = Math.random() * 8;
      }
      this.particleBuffers = [0, 1].map(() => device.createBuffer({
        size: seed.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }));
      this.particleBuffers.forEach((buffer) => device.queue.writeBuffer(buffer, 0, seed));
      this.ping = 0;
      this.uniformBuffer = device.createBuffer({
        size: 128,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.cropBuffer = device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(this.cropBuffer, 0, new Float32Array(this.cropPolygon));
      const { x, y } = this.manifest.dimensions;
      this.windTexture = device.createTexture({
        size: [x, y, ACTIVE_LEVELS],
        dimension: "3d",
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.terrainTexture = device.createTexture({
        size: [x, y],
        format: "r32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.bindGroupLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, texture: { sampleType: "unfilterable-float", viewDimension: "3d" } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, texture: { sampleType: "unfilterable-float", viewDimension: "2d" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      ] });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
      this.computePipeline = device.createComputePipeline({
        layout,
        compute: { module: shader, entryPoint: "updateParticles" },
      });
      this.renderPipeline = device.createRenderPipeline({
        layout,
        vertex: { module: shader, entryPoint: "vertexMain" },
        fragment: {
          module: shader,
          entryPoint: "fragmentMain",
          targets: [{
            format: this.format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          }],
        },
        primitive: { topology: "line-list" },
      });
      this.volumePipeline = device.createRenderPipeline({
        layout,
        vertex: { module: shader, entryPoint: "layerVertexMain" },
        fragment: {
          module: shader,
          entryPoint: "layerFragmentMain",
          targets: [{
            format: this.format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.streamlinePipeline = device.createRenderPipeline({
        layout,
        vertex: { module: shader, entryPoint: "streamVertexMain" },
        fragment: {
          module: shader,
          entryPoint: "fragmentMain",
          targets: [{
            format: this.format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          }],
        },
        primitive: { topology: "line-list" },
      });
      this.connectorPipeline = device.createRenderPipeline({
        layout,
        vertex: { module: shader, entryPoint: "connectorVertexMain" },
        fragment: {
          module: shader,
          entryPoint: "fragmentMain",
          targets: [{
            format: this.format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          }],
        },
        primitive: { topology: "line-list" },
      });
      const createGroup = (output, input) => device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: output } },
          { binding: 1, resource: { buffer: this.uniformBuffer } },
          { binding: 2, resource: this.windTexture.createView() },
          { binding: 3, resource: this.terrainTexture.createView() },
          { binding: 4, resource: { buffer: input } },
          { binding: 5, resource: { buffer: this.cropBuffer } },
        ],
      });
      this.bindGroups = [
        createGroup(this.particleBuffers[0], this.particleBuffers[1]),
        createGroup(this.particleBuffers[1], this.particleBuffers[0]),
      ];
    }

    async loadTerrain() {
      const response = await this.fetch("/api/scene3d/assets/wrf3d/terrain_height.f32");
      if (!response.ok) throw new Error("WRF 地形高度读取失败");
      const values = new Float32Array(await response.arrayBuffer());
      const { x, y } = this.manifest.dimensions;
      this.device.queue.writeTexture(
        { texture: this.terrainTexture },
        values,
        { bytesPerRow: x * 4, rowsPerImage: y },
        [x, y],
      );
    }

    async setFrame(index) {
      this.requestedFrame=index;
      if (!this.manifest.frames[index] || index === this.frameIndex) return;
      const device=this.device;
      this.loadingFrame = index;
      const response = await this.fetch(`/api/scene3d/datasets/nanjing/render/${index}`);
      if (!response.ok) throw new Error('服务器风场纹理读取失败');
      const packed = new Float32Array(await response.arrayBuffer());
      if (this.loadingFrame !== index || this.disposed || this.device!==device) return;
      const {x,y} = this.manifest.dimensions;
      this.device.queue.writeTexture({texture:this.windTexture}, packed,
        {bytesPerRow:x*16,rowsPerImage:y}, [x,y,ACTIVE_LEVELS]);
      this.frameIndex=index;
      this.status(`风场 ${index+1}/${this.manifest.frames.length}`);
    }

    setTerrainScale(value) {
      this.terrainScale = value;
    }

    setParticleCount(value) {
      this.particleCount = Math.max(500, Math.min(MAX_PARTICLE_COUNT, Math.round(value)));
    }

    setSmoothing(value) {
      this.smoothing = Math.max(0, Math.min(2, Number(value)));
    }

    setRenderMode(mode) {
      this.renderMode = mode === "volume" ? "volume" : "particles";
      this.smoothing = this.renderMode === "volume" ? 0 : 1;
      this.status(this.renderMode === "volume" ? "WebGPU 高度分层" : "WebGPU 风粒子");
    }

    setSpeedThreshold(value) {
      this.speedThreshold = Math.max(0, Math.min(WIND_MAX, Number(value)));
    }

    setCropPolygon(points) {
      const field = this.manifest.bounds;
      const width = field.east - field.west;
      const height = field.north - field.south;
      const normalized = points.flatMap((point) => [
        (point.longitude - field.west) / width,
        (point.latitude - field.south) / height,
      ]);
      this.cropPolygon = [...normalized, 1, 0, 0, 0];
      this.device.queue.writeBuffer(this.cropBuffer, 0, new Float32Array(this.cropPolygon));
    }

    clearCropBounds() {
      this.cropPolygon = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0];
      this.device.queue.writeBuffer(this.cropBuffer, 0, new Float32Array(this.cropPolygon));
    }

    setBodyResolution(value) {
      this.bodyResolution = Math.max(300, Math.min(2000, Number(value)));
    }

    setDisplayHeight(value) {
      this.displayHeight = value;
    }

    resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
    }

    writeUniforms(deltaSeconds) {
      const matrix = Cesium.Matrix4.multiply(
        this.viewer.camera.frustum.projectionMatrix,
        this.viewer.camera.viewMatrix,
        new Cesium.Matrix4(),
      );
      const values = new Float32Array(32);
      Cesium.Matrix4.toArray(matrix, values, 0);
      const bounds = this.manifest.bounds;
      values.set([
        Cesium.Math.toRadians(bounds.west), Cesium.Math.toRadians(bounds.south),
        Cesium.Math.toRadians(bounds.east), Cesium.Math.toRadians(bounds.north),
      ], 16);
      values.set([
        Math.min(deltaSeconds, 0.05),
        this.manifest.projection.dx * this.manifest.dimensions.x,
        this.manifest.projection.dy * this.manifest.dimensions.y,
        this.displayHeight,
      ], 20);
      values.set([this.terrainScale, WIND_MAX, this.smoothing, this.particleCount], 24);
      values.set([this.canvas.width, this.canvas.height, performance.now() * 0.001, this.speedThreshold], 28);
      this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
    }

    draw(time) {
      if (!this.running) return;
      this.resize();
      this.writeUniforms((time - this.lastTime) / 1000);
      this.lastTime = time;
      const computeEncoder = this.device.createCommandEncoder();
      const compute = computeEncoder.beginComputePass();
      compute.setPipeline(this.computePipeline);
      compute.setBindGroup(0, this.bindGroups[this.ping]);
      compute.dispatchWorkgroups(Math.ceil(MAX_PARTICLE_COUNT / 128));
      compute.end();
      this.device.queue.submit([computeEncoder.finish()]);
      const renderEncoder = this.device.createCommandEncoder();
      const render = renderEncoder.beginRenderPass({ colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      }] });
      render.setBindGroup(0, this.bindGroups[1 - this.ping]);
      if (this.renderMode === "volume") {
        render.setPipeline(this.volumePipeline);
        render.draw(LAYER_VERTEX_COUNT);
      } else {
        render.setPipeline(this.renderPipeline);
        render.draw(this.particleCount * 10);
      }
      render.end();
      this.device.queue.submit([renderEncoder.finish()]);
      this.ping = 1 - this.ping;
      this.animation = requestAnimationFrame((next) => this.draw(next));
    }

    destroy() {
      this.disposed=true; this.running=false;
      this.deviceGeneration++;clearTimeout(this.recoveryTimer);
      cancelAnimationFrame(this.animation);
      this.context?.unconfigure(); this.device?.destroy();
    }

    shaderCode() {
      return `
struct Particle { positionAge: vec4<f32> };
struct Uniforms {
  viewProjection: mat4x4<f32>,
  bounds: vec4<f32>,
  params: vec4<f32>,
  display: vec4<f32>,
  viewport: vec4<f32>,
};
struct CropUniform {
  p01: vec4<f32>,
  p23: vec4<f32>,
  state: vec4<f32>,
};
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var windField: texture_3d<f32>;
@group(0) @binding(3) var terrainField: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> previousParticles: array<Particle>;
@group(0) @binding(5) var<uniform> crop: CropUniform;

fn cropVisible(p: vec2<f32>) -> f32 {
  if (crop.state.x < 0.5) { return 1.0; }
  let p0 = crop.p01.xy;
  let p1 = crop.p01.zw;
  let p2 = crop.p23.xy;
  let p3 = crop.p23.zw;
  let c0 = (p1.x - p0.x) * (p.y - p0.y) - (p1.y - p0.y) * (p.x - p0.x);
  let c1 = (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x);
  let c2 = (p3.x - p2.x) * (p.y - p2.y) - (p3.y - p2.y) * (p.x - p2.x);
  let c3 = (p0.x - p3.x) * (p.y - p3.y) - (p0.y - p3.y) * (p.x - p3.x);
  let crosses = vec4<f32>(c0, c1, c2, c3);
  let inside = all(crosses >= vec4<f32>(0.0)) || all(crosses <= vec4<f32>(0.0));
  return select(0.0, 1.0, inside);
}

fn hash(value: f32) -> f32 { return fract(sin(value * 78.233) * 43758.5453); }

fn windCell(cell: vec3<i32>) -> vec4<f32> {
  return textureLoad(windField, cell, 0);
}

fn windTrilinear(p: vec3<f32>) -> vec4<f32> {
  let dims = vec3<i32>(textureDimensions(windField));
  let maximum = dims - vec3<i32>(1);
  let grid = clamp(p, vec3<f32>(0.0), vec3<f32>(1.0)) * vec3<f32>(maximum);
  let low = clamp(vec3<i32>(floor(grid)), vec3<i32>(0), maximum);
  let high = min(low + vec3<i32>(1), maximum);
  let fraction = fract(grid);
  let c00 = mix(windCell(vec3<i32>(low.x, low.y, low.z)), windCell(vec3<i32>(high.x, low.y, low.z)), fraction.x);
  let c10 = mix(windCell(vec3<i32>(low.x, high.y, low.z)), windCell(vec3<i32>(high.x, high.y, low.z)), fraction.x);
  let c01 = mix(windCell(vec3<i32>(low.x, low.y, high.z)), windCell(vec3<i32>(high.x, low.y, high.z)), fraction.x);
  let c11 = mix(windCell(vec3<i32>(low.x, high.y, high.z)), windCell(vec3<i32>(high.x, high.y, high.z)), fraction.x);
  let lower = mix(c00, c10, fraction.y);
  let upper = mix(c01, c11, fraction.y);
  return mix(lower, upper, fraction.z);
}

fn windAt(p: vec3<f32>) -> vec4<f32> {
  let dims = vec3<f32>(textureDimensions(windField));
  let strength = clamp(uniforms.display.z, 0.0, 2.0);
  let nativeCellMetres = uniforms.params.y / max(dims.x - 1.0, 1.0);
  let requestedCells = clamp(900.0 / max(nativeCellMetres, 1.0), 1.0, 7.0);
  let enhanced = step(1.85, strength);
  let horizontalRadius = mix(mix(1.0, 4.0, strength * 0.5), requestedCells, enhanced);
  let verticalRadius = mix(mix(0.5, 2.0, strength * 0.5), max(1.0, requestedCells * 0.5), enhanced);
  let offset = vec3<f32>(horizontalRadius / max(dims.x - 1.0, 1.0), horizontalRadius / max(dims.y - 1.0, 1.0), verticalRadius / max(dims.z - 1.0, 1.0));
  let centre = windTrilinear(p);
  let neighbourhood = centre * 0.28
    + windTrilinear(p + vec3<f32>(offset.x, 0.0, 0.0)) * 0.12
    + windTrilinear(p - vec3<f32>(offset.x, 0.0, 0.0)) * 0.12
    + windTrilinear(p + vec3<f32>(0.0, offset.y, 0.0)) * 0.12
    + windTrilinear(p - vec3<f32>(0.0, offset.y, 0.0)) * 0.12
    + windTrilinear(p + vec3<f32>(0.0, 0.0, offset.z)) * 0.12
    + windTrilinear(p - vec3<f32>(0.0, 0.0, offset.z)) * 0.12;
  let smoothed = mix(centre, neighbourhood, clamp(strength, 0.0, 1.0));
  return vec4<f32>(smoothed.xyz, length(smoothed.xyz));
}

fn windAtLayer(p: vec3<f32>) -> vec4<f32> {
  let dims = vec3<f32>(textureDimensions(windField));
  let levelMaximum = max(dims.z - 1.0, 1.0);
  let fixedLevel = round(clamp(p.z, 0.0, 1.0) * levelMaximum) / levelMaximum;
  return windAt(vec3<f32>(p.xy, fixedLevel));
}

fn windNearestLayer(p: vec3<f32>) -> vec4<f32> {
  let dims = vec3<i32>(textureDimensions(windField));
  let maximum = dims - vec3<i32>(1);
  let cell = clamp(
    vec3<i32>(round(clamp(p, vec3<f32>(0.0), vec3<f32>(1.0)) * vec3<f32>(maximum))),
    vec3<i32>(0),
    maximum
  );
  let raw = windCell(cell);
  return vec4<f32>(raw.xyz, length(raw.xyz));
}

@compute @workgroup_size(128)
fn updateParticles(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${MAX_PARTICLE_COUNT}u) { return; }
  var p = previousParticles[id.x].positionAge;
  let velocity = windAt(p.xyz).xyz;
  let speedup = 16.0;
  p.x += velocity.x * uniforms.params.x * speedup / uniforms.params.y;
  p.y += velocity.y * uniforms.params.x * speedup / uniforms.params.z;
  p.z += velocity.z * uniforms.params.x * speedup / ${FIELD_TOP_HEIGHT.toFixed(1)};
  p.w += uniforms.params.x;
  let seed = f32(id.x) * 0.75487766 + floor(p.w * 0.2) * 13.17;
  let outside = any(p.xyz < vec3<f32>(0.0)) || any(p.xyz > vec3<f32>(1.0));
  if (outside) {
    let enterFromX = abs(velocity.x) >= abs(velocity.y);
    let entryX = select(1.0, 0.0, velocity.x >= 0.0);
    let entryY = select(1.0, 0.0, velocity.y >= 0.0);
    p.x = select(hash(seed + 5.3), entryX, enterFromX);
    p.y = select(entryY, hash(seed + 17.7), enterFromX);
    p.z = pow(hash(seed + 39.4), 3.0);
    p.w = 0.0;
  }
  particles[id.x].positionAge = p;
}

fn ecef(normalized: vec3<f32>) -> vec3<f32> {
  let lon = mix(uniforms.bounds.x, uniforms.bounds.z, normalized.x);
  let lat = mix(uniforms.bounds.y, uniforms.bounds.w, normalized.y);
  let dims = vec2<i32>(textureDimensions(terrainField));
  let cell = clamp(vec2<i32>(normalized.xy * vec2<f32>(dims)), vec2<i32>(0), dims - vec2<i32>(1));
  let terrain = textureLoad(terrainField, cell, 0).x;
  let height = terrain * uniforms.display.x + normalized.z * ${FIELD_TOP_HEIGHT.toFixed(1)};
  let a = 6378137.0;
  let e2 = 0.00669437999014;
  let sinLat = sin(lat);
  let cosLat = cos(lat);
  let n = a / sqrt(1.0 - e2 * sinLat * sinLat);
  return vec3<f32>((n + height) * cosLat * cos(lon), (n + height) * cosLat * sin(lon), (n * (1.0 - e2) + height) * sinLat);
}

fn colour(speed: f32) -> vec3<f32> {
  let t = clamp(speed / uniforms.display.y, 0.0, 1.0);
  if (t < 0.25) { return mix(vec3<f32>(0.027, 0.341, 1.0), vec3<f32>(0.0, 0.918, 0.973), t * 4.0); }
  if (t < 0.5) { return mix(vec3<f32>(0.0, 0.918, 0.973), vec3<f32>(0.384, 1.0, 0.125), (t - 0.25) * 4.0); }
  if (t < 0.75) { return mix(vec3<f32>(0.384, 1.0, 0.125), vec3<f32>(1.0, 0.941, 0.0), (t - 0.5) * 4.0); }
  return mix(vec3<f32>(1.0, 0.941, 0.0), vec3<f32>(1.0, 0.078, 0.02), (t - 0.75) * 4.0);
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) colour: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let particleIndex = vertexIndex / 10u;
  let localVertex = vertexIndex % 10u;
  let copyIndex = localVertex / 2u;
  let isHead = localVertex % 2u == 1u;
  let baseP = previousParticles[particleIndex].positionAge.xyz;
  let dims = vec3<f32>(textureDimensions(windField));
  let cell = vec3<f32>(1.0) / max(dims - vec3<f32>(1.0), vec3<f32>(1.0));
  let spread = clamp(uniforms.display.z, 0.0, 2.0);
  var fillOffset = vec3<f32>(0.0);
  if (copyIndex == 1u) {
    fillOffset = vec3<f32>(cell.x * 0.72, cell.y * 0.46, cell.z * 0.32) * spread;
  } else if (copyIndex == 2u) {
    fillOffset = vec3<f32>(-cell.x * 0.72, -cell.y * 0.46, -cell.z * 0.32) * spread;
  } else if (copyIndex == 3u) {
    fillOffset = vec3<f32>(cell.x * 1.08, -cell.y * 0.82, cell.z * 0.56) * max(spread - 0.75, 0.0);
  } else if (copyIndex == 4u) {
    fillOffset = vec3<f32>(-cell.x * 1.08, cell.y * 0.82, -cell.z * 0.56) * max(spread - 0.75, 0.0);
  }
  let p = clamp(baseP + fillOffset, vec3<f32>(0.0), vec3<f32>(1.0));
  let wind = windAt(p);
  let tailMetres = 55.0;
  let tailPoint = p - vec3<f32>(
    wind.x * tailMetres / uniforms.params.y,
    wind.y * tailMetres / uniforms.params.z,
    wind.z * tailMetres / ${FIELD_TOP_HEIGHT.toFixed(1)}
  );
  let headClip = uniforms.viewProjection * vec4<f32>(ecef(p), 1.0);
  let tailClip = uniforms.viewProjection * vec4<f32>(ecef(tailPoint), 1.0);
  let age = previousParticles[particleIndex].positionAge.w;
  let ageFade = smoothstep(0.0, 0.8, age);
  var output: VertexOutput;
  output.position = select(tailClip, headClip, isHead);
  var fillAlpha = 1.0;
  if (copyIndex == 1u || copyIndex == 2u) {
    fillAlpha = clamp(spread, 0.0, 1.0) * 0.58;
  } else if (copyIndex == 3u || copyIndex == 4u) {
    fillAlpha = clamp((spread - 0.75) / 1.25, 0.0, 1.0) * 0.48;
  }
  let thresholdAlpha = select(0.0, 1.0, wind.w >= uniforms.viewport.w);
  let heightAlpha = select(0.0, 1.0, p.z * ${FIELD_TOP_HEIGHT.toFixed(1)} <= uniforms.params.w);
  let cropAlpha = cropVisible(p.xy);
  output.colour = vec4<f32>(colour(wind.w), select(0.18, 0.95, isHead) * ageFade * fillAlpha * thresholdAlpha * heightAlpha * cropAlpha);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.colour.a < 0.001) { discard; }
  return input.colour;
}

@vertex
fn streamVertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let verticesPerParticle = ${STREAMLINE_SEGMENTS * 2}u;
  let particleIndex = vertexIndex / verticesPerParticle;
  let localVertex = vertexIndex % verticesPerParticle;
  let segmentIndex = localVertex / 2u;
  let endpoint = localVertex % 2u;
  let targetStep = segmentIndex + endpoint;
  var p = previousParticles[particleIndex].positionAge.xyz;
  let baseWind = windAt(p);
  var wind = baseWind;
  let stepSeconds = 6.0;

  for (var step = 0u; step < ${STREAMLINE_SEGMENTS}u; step = step + 1u) {
    if (step < targetStep) {
      let firstWind = windAt(p);
      let midpoint = clamp(p - vec3<f32>(
        firstWind.x * stepSeconds * 0.5 / uniforms.params.y,
        firstWind.y * stepSeconds * 0.5 / uniforms.params.z,
        firstWind.z * stepSeconds * 0.5 / ${FIELD_TOP_HEIGHT.toFixed(1)}
      ), vec3<f32>(0.0), vec3<f32>(1.0));
      let midpointWind = windAt(midpoint);
      p = clamp(p - vec3<f32>(
        midpointWind.x * stepSeconds / uniforms.params.y,
        midpointWind.y * stepSeconds / uniforms.params.z,
        midpointWind.z * stepSeconds / ${FIELD_TOP_HEIGHT.toFixed(1)}
      ), vec3<f32>(0.0), vec3<f32>(1.0));
      wind = midpointWind;
    }
  }

  let fade = 1.0 - f32(targetStep) / f32(${STREAMLINE_SEGMENTS});
  let colourBand = round(baseWind.w * 2.0) * 0.5;
  var output: VertexOutput;
  output.position = uniforms.viewProjection * vec4<f32>(ecef(p), 1.0);
  let thresholdAlpha = select(0.0, 1.0, baseWind.w >= uniforms.viewport.w);
  let heightAlpha = select(0.0, 1.0, p.z * ${FIELD_TOP_HEIGHT.toFixed(1)} <= uniforms.params.w);
  output.colour = vec4<f32>(colour(colourBand) * 0.82, mix(0.42, 0.88, fade) * thresholdAlpha * heightAlpha);
  return output;
}

@vertex
fn connectorVertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let connectorIndex = vertexIndex / 2u;
  let endpoint = vertexIndex % 2u;
  let activeCount = max(u32(uniforms.display.w), 1u);
  let nextIndex = (connectorIndex + 1u) % activeCount;
  let particleIndex = select(connectorIndex, nextIndex, endpoint == 1u);
  let p = previousParticles[particleIndex].positionAge.xyz;
  let wind = windAt(p);
  let colourBand = round(wind.w * 2.0) * 0.5;
  var output: VertexOutput;
  output.position = uniforms.viewProjection * vec4<f32>(ecef(p), 1.0);
  let thresholdAlpha = select(0.0, 1.0, wind.w >= uniforms.viewport.w);
  output.colour = vec4<f32>(colour(colourBand) * 0.72, 0.24 * thresholdAlpha);
  return output;
}

@vertex
fn volumeVertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let gx = ${VOLUME_GRID_X}u;
  let gy = ${VOLUME_GRID_Y}u;
  let gz = ${VOLUME_GRID_Z}u;
  let xEdges = (gx - 1u) * gy * gz;
  let yEdges = gx * (gy - 1u) * gz;
  let edgeIndex = vertexIndex / 2u;
  let endpoint = vertexIndex % 2u;
  var p = vec3<f32>(0.0);

  if (edgeIndex < xEdges) {
    let x = edgeIndex % (gx - 1u);
    let yz = edgeIndex / (gx - 1u);
    let y = yz % gy;
    let z = yz / gy;
    p = vec3<f32>(f32(x + endpoint) / f32(gx - 1u), f32(y) / f32(gy - 1u), f32(z) / f32(gz - 1u));
  } else if (edgeIndex < xEdges + yEdges) {
    let local = edgeIndex - xEdges;
    let y = local % (gy - 1u);
    let xz = local / (gy - 1u);
    let x = xz % gx;
    let z = xz / gx;
    p = vec3<f32>(f32(x) / f32(gx - 1u), f32(y + endpoint) / f32(gy - 1u), f32(z) / f32(gz - 1u));
  } else {
    let local = edgeIndex - xEdges - yEdges;
    let z = local % (gz - 1u);
    let xy = local / (gz - 1u);
    let x = xy % gx;
    let y = xy / gx;
    p = vec3<f32>(f32(x) / f32(gx - 1u), f32(y) / f32(gy - 1u), f32(z + endpoint) / f32(gz - 1u));
  }

  let wind = windAt(p);
  var output: VertexOutput;
  output.position = uniforms.viewProjection * vec4<f32>(ecef(p), 1.0);
  output.colour = vec4<f32>(colour(wind.w), 0.12);
  return output;
}

struct BodyOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) colour: vec4<f32>,
  @location(1) local: vec2<f32>,
  @location(2) @interpolate(flat) visible: f32,
};

@vertex
fn layerVertexMain(@builtin(vertex_index) vertexIndex: u32) -> BodyOutput {
  let gx = ${LAYER_GRID_X}u;
  let gy = ${LAYER_GRID_Y}u;
  let layerCount = ${LAYER_COUNT}u;
  let cellsPerLayer = (gx - 1u) * (gy - 1u);
  let verticesPerLayer = cellsPerLayer * 6u;
  let layer = min(vertexIndex / verticesPerLayer, layerCount - 1u);
  let localVertex = vertexIndex % verticesPerLayer;
  let cellIndex = localVertex / 6u;
  let corner = localVertex % 6u;
  let x = cellIndex % (gx - 1u);
  let y = cellIndex / (gx - 1u);
  let right = corner == 2u || corner == 4u || corner == 5u;
  let top = corner == 1u || corner == 2u || corner == 4u;
  let px = (f32(x) + select(0.0, 1.0, right)) / f32(gx - 1u);
  let py = (f32(y) + select(0.0, 1.0, top)) / f32(gy - 1u);
  let pz = f32(layer) / max(f32(layerCount - 1u), 1.0);
  let p = vec3<f32>(px, py, pz);
  let cellCentre = vec3<f32>(
    (f32(x) + 0.5) / f32(gx - 1u),
    (f32(y) + 0.5) / f32(gy - 1u),
    pz
  );
  let cellWind = windNearestLayer(cellCentre);
  let layerFade = mix(0.075, 0.035, f32(layer) / max(f32(layerCount - 1u), 1.0));
  var output: BodyOutput;
  output.position = uniforms.viewProjection * vec4<f32>(ecef(p), 1.0);
  let speedBand = round(cellWind.w * 2.0) * 0.5;
  output.colour = vec4<f32>(colour(speedBand), layerFade);
  output.local = vec2<f32>(0.0);
  let speedVisible = cellWind.w >= uniforms.viewport.w;
  let heightVisible = pz * ${FIELD_TOP_HEIGHT.toFixed(1)} <= uniforms.params.w;
  let insideCrop = cropVisible(cellCentre.xy) > 0.5;
  output.visible = select(0.0, 1.0, speedVisible && heightVisible && insideCrop);
  return output;
}

@fragment
fn layerFragmentMain(input: BodyOutput) -> @location(0) vec4<f32> {
  if (input.visible < 0.5) { discard; }
  return input.colour;
}

@vertex
fn bodyVertexMain(@builtin(vertex_index) vertexIndex: u32) -> BodyOutput {
  let sampleIndex = vertexIndex / 6u;
  let corner = vertexIndex % 6u;
  let advected = previousParticles[sampleIndex].positionAge.xyz;
  let horizontalStep = vec2<f32>(
    900.0 / max(uniforms.params.y, 1.0),
    900.0 / max(uniforms.params.z, 1.0)
  );
  let colourPoint = vec3<f32>(
    (floor(advected.x / horizontalStep.x) + 0.5) * horizontalStep.x,
    (floor(advected.y / horizontalStep.y) + 0.5) * horizontalStep.y,
    (floor(advected.z * 4.0) + 0.5) / 4.0
  );
  let wind = windAt(clamp(colourPoint, vec3<f32>(0.0), vec3<f32>(1.0)));
  let right = corner == 2u || corner == 4u || corner == 5u;
  let top = corner == 1u || corner == 2u || corner == 4u;
  let local = vec2<f32>(select(-1.0, 1.0, right), select(-1.0, 1.0, top));
  let speedScale = clamp(wind.w / uniforms.display.y, 0.0, 1.0);
  let fieldDims = vec3<f32>(textureDimensions(windField));
  let cell = vec3<f32>(1.0) / max(fieldDims - vec3<f32>(1.0), vec3<f32>(1.0));
  let nativeCellMetres = uniforms.params.y / max(fieldDims.x - 1.0, 1.0);
  let bodyCells = clamp(900.0 / max(nativeCellMetres, 1.0), 1.0, 7.0);
  let bodyScale = bodyCells * 0.52;
  let bodyPoint = clamp(
    advected + vec3<f32>(local.x * cell.x * bodyScale, local.y * cell.y * bodyScale, 0.0),
    vec3<f32>(0.0), vec3<f32>(1.0)
  );
  let clip = uniforms.viewProjection * vec4<f32>(ecef(bodyPoint), 1.0);
  var output: BodyOutput;
  output.position = clip;
  let colourBand = round(wind.w * 2.0) * 0.5;
  let bodyColour = clamp(colour(colourBand) * 0.82, vec3<f32>(0.0), vec3<f32>(1.0));
  let thresholdAlpha = select(0.0, 1.0, wind.w >= uniforms.viewport.w);
  output.colour = vec4<f32>(bodyColour, mix(0.15, 0.25, speedScale) * thresholdAlpha);
  output.local = local;
  output.visible = thresholdAlpha;
  return output;
}

@fragment
fn bodyFragmentMain(input: BodyOutput) -> @location(0) vec4<f32> {
  if (input.visible < 0.5) { discard; }
  let radius = length(input.local);
  let softness = 1.0 - smoothstep(0.05, 1.0, radius);
  return vec4<f32>(input.colour.rgb, input.colour.a * max(softness, 0.34));
}
`;
    }
  }
