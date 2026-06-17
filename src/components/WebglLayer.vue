<template>
  <canvas ref="canvas" class="webgl-layer"></canvas>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";

const props = defineProps({ src: String });
const canvas = ref(null);
let gl, program, texture, hasTex = false;

const vert = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const frag = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uTex;
void main(){
  frag = texture(uTex, vec2(vUv.x, 1.0 - vUv.y));
}`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function resize() {
  canvas.value.width = canvas.value.clientWidth;
  canvas.value.height = canvas.value.clientHeight;
  gl.viewport(0, 0, canvas.value.width, canvas.value.height);
}

function draw() {
  resize();
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!hasTex) return;
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function loadTexture() {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    texture = texture || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    hasTex = true;
    draw();
  };
  image.src = props.src;
}

onMounted(() => {
  gl = canvas.value.getContext("webgl2");
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  new ResizeObserver(draw).observe(canvas.value);
  if (props.src) loadTexture();
  else draw();
});

watch(() => props.src, (value) => { hasTex = false; if (value) loadTexture(); else draw(); });
</script>

<style scoped>
.webgl-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
