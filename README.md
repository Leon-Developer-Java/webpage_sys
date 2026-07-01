# 智慧气象 · 前端公共框架（第0阶段）

## 项目概述

本项目是"智慧气象"系统的前端公共框架，由第0阶段（邹聪）负责搭建。框架基于 Vue3 + Vite + Element Plus + Cesium 构建，为成员1-6提供统一的底图、渲染、时间轴等公共组件。各成员只需在 `src/layers/` 下维护自己的业务数据层组件即可。

## 技术栈

| 技术 | 用途 |
|------|------|
| Vue 3 + Vite 6 | 前端框架 + 构建工具 |
| Element Plus | UI 组件库 |
| Cesium (Scene2D) | 公共底图（矢量 / 影像 / 地形 / 境界 四选一） |
| WebGL2 | 气象数据叠加渲染层 |
| Vue Router | 数据总览 / 数据上传 / 智能体 三页路由 |

## 项目结构

```
webpage_sys/
├── src/
│   ├── main.js              # 入口：Vue + Router + ElementPlus
│   ├── router.js            # 路由配置
│   ├── api.js               # 统一请求：parseFile→8002 / 分片上传→8003 / chatStream→8004
│   ├── markdown.js          # 智能体消息 Markdown 渲染（marked + 中文加粗修复 + 净化）
│   ├── App.vue              # 顶栏 + 主题切换 + <router-view>
│   ├── styles/global.css    # CSS 变量（亮/暗主题）、公共组件样式
│   ├── views/
│   │   ├── Overview.vue     # 数据总览页（四屏地图 + 工具栏 + 属性面板 + 时间轴）
│   │   ├── Upload.vue       # 数据上传页
│   │   └── Agent.vue        # 智能体页
│   ├── components/          # 公共组件（框架层，成员无需修改）
│   │   ├── MapBase.vue      # Cesium 2D 底图（<slot> 供业务层叠加）
│   │   ├── WebglLayer.vue   # WebGL2 数据叠加渲染层（接收 PNG + 地理范围）
│   │   ├── TimeAxis.vue     # 时间轴（CSS 进度条，支持平滑播放）
│   │   └── VariableSelect.vue
│   └── layers/              # 业务数据层组件（成员1-6 各自维护）
│       ├── Era5Layer.vue    # 成员1  ERA5
│       ├── GribLayer.vue    # 成员2  GFS / ECMWF
│       ├── CmaLayer.vue     # 成员3  CMA
│       ├── RadarLayer.vue   # 成员4  雷达
│       ├── HimawariLayer.vue # 成员5  葵花卫星
│       ├── HimawariTimeAxis.vue       # Himawari 专属时间轴
│       ├── himawariTimelineTicks.js   # Himawari 专属标签抽稀
│       └── WrfLayer.vue     # 成员6  WRF
└── public/
    └── meta.template.json   # 后端 meta.json 字段规范
```

## 智能体页（Agent.vue）后端对接

智能体页对接独立后端 `backend_agent`（端口 **8004**，详见其 README）。

- 请求：`api.js` 的 `chatStream(messages, context)` → `POST http://127.0.0.1:8004/api/agent/chat`
- 响应：**NDJSON 流式**，每行一个 JSON 事件，前端按类型分发渲染：

  | 事件 | 前端动作 |
  |------|----------|
  | `{type:"text",value}` | 追加到气泡（Markdown 渲染） |
  | `{type:"tool",name,status,label,progress,result}` | 渲染/更新 `ToolCallCard` 进度卡 |
  | `{type:"image",url,caption}` | 气泡内嵌 `<img>` |
  | `{type:"done"}` / `{type:"error",message}` | 收尾 / 错误提示 |

- 助手消息经 `markdown.js` 渲染（依赖 `marked`）。后端服务的图片由 `8004/outputs/*.png` 提供。

## 快速开始

```bash
cd zhihuiqixiangWEB/webpage_sys
npm install
npm run dev -- --port 5177
```

浏览器打开：

```text
http://127.0.0.1:5177
```

前端需要后端 `8002` 同时运行。Himawari 展示依赖：

```text
GET http://127.0.0.1:8002/api/display/HIMAWARI
GET http://127.0.0.1:8002/api/himawari/auto-status
```

后端启动参考：

```bash
cd zhihuiqixiangSQL/backend_system
conda activate zhihuiqixiang
export HIMAWARI_FTP_USER="你的 FTP 用户名"
export HIMAWARI_FTP_PASSWORD="你的 FTP 密码"
uvicorn main:app --reload --host 127.0.0.1 --port 8002
```

只看已有样例、不启动自动 FTP 下载时，后端可加：

```bash
export HIMAWARI_AUTO_DOWNLOAD=0
```

---

## 成员协作指南

### 你只需要修改一个文件

每位成员只需编辑 `src/layers/` 下自己对应的 `.vue` 文件。  
用户在界面选择数据类型（如"雷达"）后，框架自动加载并渲染对应的 Layer 组件，无需修改任何公共代码。

Himawari 的专属前端逻辑放在：

```text
src/layers/HimawariLayer.vue
src/layers/HimawariTimeAxis.vue
src/layers/himawariTimelineTicks.js
```

Himawari 不应为了时间轴标签密度修改公共 `src/components/TimeAxis.vue` 或 `src/utils/timeAxisTicks.js`。

### Layer 组件结构

```vue
<template>
  <!-- 将后端 PNG 叠加渲染到 Cesium 底图上 -->
  <WebglLayer :src="imageUrl" :extent="extent" />

  <!-- 色标图例（自动显示在地图左上角文件信息卡下方） -->
  <div class="layer-legend">
    <small>单位（如 dBZ）</small>
    <div class="legend-bar" :style="{ background: gradient }"></div>
    <ul><li v-for="t in ticks" :key="t">{{ t }}</li></ul>
  </div>
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";

// 替换为后端实际返回的 PNG 地址和地理范围
const imageUrl = "http://your-backend/api/render/output.png";
const extent = [73, 15, 135, 55]; // [west, south, east, north]（十进制度）

const gradient = `linear-gradient(to right, #2563eb, #22c55e, #facc15, #e11d48)`;
const ticks = ["0", "10", "30", "50", "70"];
</script>
```

---

## ⚠️ 图像对齐与 meta.json（开发必读）

### 图像与底图对齐

`WebglLayer` 通过 `extent` 参数将 PNG **精确**叠加到 Cesium 底图，WebGL2 会将 PNG 直接投影到该矩形区域：

> **后端渲染 PNG 时，输出图像的地理范围必须和传给 `WebglLayer` 的 `:extent=[west,south,east,north]` 完全一致。**  
> 只要范围有偏差，图像就会偏移或拉伸，无法与底图对齐。

- `extent = [west, south, east, north]`，单位：十进制度
- 建议分辨率：短边 ≥ 600px，长宽比 = `(east-west) / (north-south)`
- 中国范围参考：`[73, 15, 135, 55]`，宽高比 ≈ 1.55

### meta.json 规范

`public/meta.template.json` 是字段规范模板。后端 `POST /api/files/parse` 返回该结构后，前端自动填充气象信息面板：

```js
// Overview.vue 内部逻辑：
const meta = computed(() => parsed.value || infos[active.value]);
// parsed.value 即 api.parseFile() 返回的 meta 对象
```

```json
{
  "file":    "radar_xh_20250616_1000.cinrad",
  "element": "组合反射率 DBZH",
  "time":    "2025-06-16 10:00",
  "level":   "0.5° 仰角",
  "range":   "73°E-135°E, 15°N-55°N",
  "grid":    "721 × 361",
  "missing": "-9999",
  "unit":    "dBZ",
  "vars":    "1",
  "steps":   "24",
  "extent":  [73, 15, 135, 55]
}
```

> **`extent` 字段必须写入 meta.json**。Layer 组件从后端响应中读取 `extent`，传给 `WebglLayer` 的 `:extent` prop，以确保图像与底图精确对齐。

**完整数据流**：

```
后端解析文件
  → 读取实际地理范围 → 以该范围渲染 PNG
  → 输出 meta.json（含 extent 字段）
  → 前端 api.parseFile() 获取响应
  → Layer 组件将 meta.extent 传给 <WebglLayer :extent="meta.extent" />
  → 气象信息面板自动填充（meta = parsed.value）
```

---

## 多屏联动

双屏 / 四屏模式下，点击左侧工具栏「联动」按钮，所有屏幕视角跟随第一屏（缩放 / 平移同步）。

## 主题切换

点击右上角月亮 / 太阳图标，亮色 / 暗色主题切换，Cesium 底图配色同步更新。

## Himawari 展示说明

- 前端不直接读取 HSD raw，只读取后端返回的 `png_url`、`extent`、`grid`、`variables`、`composites` 和 `timeline`。
- 后端 `/api/display/HIMAWARI` 返回滚动 24 小时窗口内已有的解析结果。
- 窗口规则由后端统一控制：当前时间向前 60 分钟取 10 分钟整点作为右边界，再向前 24 小时。
- 前端时间轴播放完整时次列表；标签由 `HimawariTimeAxis.vue` 专属抽稀到 12 个左右，公共时间轴不受影响。
- 自动下载状态显示在右侧“气象信息”卡片，来源为 `/api/himawari/auto-status`。

## 构建验证

修改前端后运行：

```bash
cd zhihuiqixiangWEB/webpage_sys
npm run build
```

注意 `dist/index.html` 与 `dist/assets` 是构建产物，提交时不要只提交半截构建结果。
