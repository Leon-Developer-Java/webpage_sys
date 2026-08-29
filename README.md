# 智慧气象前端（webpage_sys）

Vue 3 + Vite 单页应用，提供登录、气象数据总览、数据上传、智能体、模型运行、ERA5 历史数据和 WRF 工作台。地图由项目内的 WebGL2 投影画布渲染，不依赖 Cesium。

## 运行环境

- Node.js 20（当前验证版本为 20.18；Vite 6 也支持兼容的 Node 18/22 版本）
- npm 10 或更高版本
- 支持 WebGL2 的现代浏览器

安装和启动：

```powershell
cd D:\weather_prediction_system\webpage_sys
npm ci
npm run dev
```

开发地址为 `http://127.0.0.1:5177`。

## 后端服务

开发模式未设置 Vite 环境变量时使用以下地址：

| 服务 | 默认地址 | 用途 |
| --- | --- | --- |
| `backend` | `http://127.0.0.1:8002` | 展示接口和 `/data` 资源 |
| `backend_upload` | `http://127.0.0.1:8003` | 上传、任务、目录和自动采集 |
| `backend_agent` | `http://127.0.0.1:8004` | 智能体 NDJSON 流式接口 |
| `backend_auth` | `http://127.0.0.1:8005` | 登录、注册和用户管理 |
| `backend_model` | `http://127.0.0.1:8006` | 模型运行与结果资源 |
| WRF 服务 | `http://127.0.0.1:8007` | WRF 任务与展示 |
| ERA5 历史服务 | `http://127.0.0.1:8010` | ERA5 历史状态、更新和展示 |

对应环境变量：

```text
VITE_API_BASE
VITE_UPLOAD_BASE
VITE_AGENT_BASE
VITE_AUTH_BASE
VITE_MODEL_BASE
VITE_WRF_BASE
VITE_ERA5_HISTORY_API_BASE
```

生产构建使用 [.env.production](./.env.production)。其中空字符串表示同源请求，由 nginx 将 `/api`、`/data`、`/outputs` 等路径反向代理到对应服务；生产环境不要填写服务器自身的 `127.0.0.1`。

## 页面与权限

| 路由 | 页面 | 最低角色 |
| --- | --- | --- |
| `/login` | 登录/注册 | 未登录可用 |
| `/` | 多屏气象总览 | role 1 |
| `/era5-history` | ERA5 历史数据 | 未登录可访问 |
| `/upload` | 数据上传与解析状态 | role 2 |
| `/agent` | 智能体 | role 2 |
| `/model` | 模型运行 | role 2 |
| `/wrf` | WRF 工作台 | role 2 |

JWT 和用户信息保存在浏览器 `localStorage`。请求会自动添加 `Authorization: Bearer ...`；Token 过半生命周期时通过 `backend_auth` 静默刷新，收到 401 后自动退出。

## 数据链路

普通文件和 FY-3/Himawari 集合统一通过 `backend_upload:8003` 分片上传：

```text
浏览器分片上传
  -> backend_upload 写入共享 DB 和私有 raw 存储
  -> backend Adapter Worker 异步解析
  -> backend/data 生成 meta/WebP
  -> backend_upload 目录接口选择资源
  -> backend:8002 提供展示响应和 /data 文件
```

上传成功只表示文件已入队。前端继续轮询 `pending/running/success/failed`，不再把同一文件二次提交给 8002。FY-3/Himawari 在上传前调用集合准备接口，由服务端判断 science/geo、波段和分段完整性。

## 目录结构

```text
webpage_sys/
├─ src/
│  ├─ api.js                 # 服务地址、鉴权、上传、目录、模型和 WRF 请求
│  ├─ router.js              # 页面路由与角色守卫
│  ├─ views/                 # Overview、Upload、Agent、Model、WRF 等页面
│  ├─ components/
│  │  ├─ ProjMap.vue         # WebGL2 多投影底图
│  │  ├─ WebglLayer.vue      # 气象栅格叠加
│  │  ├─ TimeAxis.vue        # 公共时间轴
│  │  └─ MetaPanel.vue       # 气象属性与统计面板
│  ├─ layers/                # ERA5、CMA、Radar、FY3、Himawari、WRF 等图层
│  └─ utils/                 # 帧缓存、投影与播放辅助逻辑
├─ public/                   # 本地海岸线、国界和 meta 模板
├─ tests/                    # Node 内置测试运行器用例
├─ package.json
└─ vite.config.js
```

图层资源必须提供与图像一致的 `extent=[west,south,east,north]`。时间、要素、分辨率和 WebP URL 应来自后端 meta/目录响应，不要在组件中写演示数据作为真实回退。

## 测试与构建

```powershell
npm test
npm run build
```

`npm test` 使用 Node 内置测试运行器；`npm run build` 输出到 `dist/`。提交依赖变更时必须同时更新 `package.json` 和 `package-lock.json`，协作者应优先使用 `npm ci`。
