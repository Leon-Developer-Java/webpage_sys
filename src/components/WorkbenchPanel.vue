<template>
  <aside class="workbench glass">
    <div class="wb-head">工作台</div>
    <div class="wb-body">
      <section>
        <div class="wb-sec">数据状态</div>
        <div class="stat-row">
          <div class="stat-c"><div class="sv">1,284</div><div class="sl">总量</div></div>
          <div class="stat-c"><div class="sv ok">847</div><div class="sl">已解析</div></div>
          <div class="stat-c"><div class="sv ac">4</div><div class="sl">待解析</div></div>
        </div>
      </section>
      <section>
        <div class="wb-sec">可用模型</div>
        <div v-for="m in models" :key="m.name" class="model-row">
          <span :class="['mdot', 'mdot-' + m.status]"></span>
          <span class="mname">{{ m.name }}</span>
          <span :class="['mtag', { dim: m.status === 'off' }]">{{ m.label }}</span>
        </div>
      </section>
      <section>
        <div class="wb-sec">快捷指令（点击直接调用模型）</div>
        <div v-for="c in cmdList" :key="c.label" class="cmd-row" @click="$emit('cmd', c.prompt)">
          <code class="cmd-code">{{ c.label }}</code><span>{{ c.desc }}</span>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup>
defineEmits(["cmd"]);

const models = [
  { name: "ERA5 要素场分析", status: "ok", label: "就绪" },
  { name: "GFS/ECMWF 数值预报", status: "ok", label: "就绪" },
  { name: "CMA 模式产品诊断", status: "ok", label: "就绪" },
  { name: "雷达回波外推", status: "ok", label: "就绪" },
  { name: "葵花卫星云图分析", status: "ok", label: "就绪" },
  { name: "WRF 短临降水预测", status: "ok", label: "就绪" },
];

// label：指令短名（展示用）；prompt：点击后直接发送的自然语言；desc：说明
const cmdList = [
  { label: "ERA5", prompt: "用 ERA5 分析气象要素场", desc: "ERA5 要素场分析" },
  { label: "GFS", prompt: "用 GFS/ECMWF 做数值预报", desc: "GFS/ECMWF 数值预报" },
  { label: "CMA", prompt: "用 CMA 模式产品做诊断", desc: "CMA 模式产品诊断" },
  { label: "雷达", prompt: "做雷达回波外推短临预报", desc: "雷达回波外推" },
  { label: "葵花", prompt: "做葵花卫星云图分析", desc: "葵花卫星云图分析" },
  { label: "WRF", prompt: "用 WRF 模型预测短临降水", desc: "WRF 短临降水预测" },
];
</script>

<style scoped>
.workbench {
  flex-shrink: 0;
  width: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wb-head {
  flex-shrink: 0;
  height: 52px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  font-weight: 600;
}

.wb-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  scrollbar-width: none;
}
.wb-body::-webkit-scrollbar { display: none; }
.wb-sec { font-size: 10px; color: var(--muted); letter-spacing: 0.5px; margin-bottom: 8px; }

.stat-row { display: flex; gap: 6px; }
.stat-c {
  flex: 1;
  background: var(--field);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px 9px;
  text-align: center;
}
.sv { font-size: 20px; font-weight: 700; line-height: 1; letter-spacing: -0.5px; }
.sv.ok { color: var(--ok); }
.sv.ac { color: var(--accent); }
.sl { font-size: 10px; color: var(--muted); margin-top: 4px; }

.model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--field);
  font-size: 12px;
  margin-bottom: 5px;
}
.model-row:last-child { margin-bottom: 0; }
.mdot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.mdot-ok  { background: var(--ok); }
.mdot-off { background: rgba(255, 255, 255, 0.2); }
.mdot-run { background: #fbbf24; animation: pulse 1.2s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.mname { flex: 1; color: var(--muted); font-size: 12px; }
.mtag {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(78, 161, 255, 0.12);
  color: var(--accent);
}
.mtag.dim { background: rgba(255, 255, 255, 0.06); color: var(--muted); }

.cmd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--field);
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  margin-bottom: 5px;
  transition: 0.12s;
}
.cmd-row:last-child { margin-bottom: 0; }
.cmd-row:hover { border-color: var(--accent); color: var(--text); }
.cmd-code {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(78, 161, 255, 0.1);
  color: var(--accent);
  font-family: monospace;
}
</style>
