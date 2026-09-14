// Presentation only: use structured fields, never extract counts or paths from summary prose.
const titles = {
  "weather.data_catalog": "已解析数据集", "weather.asset_overview": "数据资产巡检",
  "weather.parse_task_list": "解析任务", "weather.file_assets": "文件资产",
  "weather.asset_query": "资产筛选结果", "weather.latest_file_assets": "最新成功文件",
  "weather.parse_failure_diagnosis": "解析失败诊断", "weather.wrf_asset_summary": "WRF 要素资产统计",
  "weather.era5_timeseries": "ERA5 时序统计", "weather.radar_echo_change": "雷达回波统计",
  "parser.existing_file": "已有文件解析",
};
const labels = { success: "解析成功", failed: "失败", pending: "待处理", running: "处理中",
  ready: "可用", ok: "有效", missing_source: "源文件缺失", missing_variable: "变量缺失", empty: "无有效数据" };
const arr = value => Array.isArray(value) ? value : [];
const has = value => value !== null && value !== undefined && value !== "";
const nameOf = value => String(value || "").replaceAll("\\", "/").split("/").at(-1);
const status = value => labels[value] || value || "未提供";
const total = (rows, key) => rows.every(row => typeof row[key] === "number" && Number.isFinite(row[key]))
  ? rows.reduce((sum, row) => sum + row[key], 0) : null;
export const formatNumber = value => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value) : "未提供";
const valueText = value => typeof value === "number" ? formatNumber(value) : has(value) ? String(value) : "未提供";
const resolution = value => value === "native" ? "原始网格（间距未标注）" : valueText(value);
const fileCount = items => items.some(item => !item.file_uuid) ? null : new Set(items.map(item => item.file_uuid)).size;

export function fileQuery(file) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(file?.uuid || "")
    ? `查询指定文件资产 file_uuid=${file.uuid}` : "";
}

export function resourceUrl(value, dataBase, workflowBase) {
  if (typeof value !== "string" || !value) return "";
  try {
    const data = new URL(dataBase), workflow = new URL(workflowBase);
    const url = new URL(value, data);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    return (url.origin === data.origin && url.pathname.startsWith("/data/"))
      || (url.origin === workflow.origin && url.pathname.startsWith("/outputs/")) ? url.href : "";
  } catch { return ""; }
}

export function presentWorkflow(run) {
  const r = run.result || {}, p = run.parameters || {}, template = run.template_id;
  const view = { title: titles[template] || "工作流结果", headline: "", metrics: [], notes: [],
    tables: [], files: [], filters: [], sources: [], warnings: [...arr(r.warnings)],
    imageCaption: ["weather.era5_timeseries", "weather.radar_echo_change"].includes(template)
      ? "分析图表；请结合表格中的单位和统计口径查看。" : "单条资产预览，不是统计汇总图。" };
  const metric = (label, value, unit = "") => view.metrics.push({ label, value: formatNumber(value), unit });
  const table = (id, title, columns, rows, note = "") => view.tables.push({ id, title,
    columns: columns.map(([key, label]) => ({ key, label })), rows, note });
  const fileMap = new Map();
  const file = (item, kind = "文件") => {
    const path = item.source_file || item.source_path || item.file_path || "";
    const meta = item.meta_file || item.meta_path || "";
    const key = item.file_uuid || path || meta || item.dataset_id;
    if (!key) return null;
    if (!fileMap.has(key)) {
      const entry = { id: view.files.length + 1, kind, uuid: item.file_uuid || "", path, meta,
        name: item.original_file_name || item.dataset_id || nameOf(path || meta) || "未返回文件名",
        dataType: item.data_type || "", status: status(item.parse_status || item.file_parse_status),
        previewUrl: item.default_webp_url || "", datasetId: item.dataset_id || "",
        created: item.create_time || "", finished: item.parse_finished_at || "",
        variables: arr(item.variables).map(v => typeof v === "string" ? v : `${v.name}${v.units ? ` (${v.units})` : ""}`).join("、") };
      fileMap.set(key, entry);
      view.files.push(entry);
    }
    const entry = fileMap.get(key);
    return { fileId: entry.id, label: `[${entry.kind} ${entry.id}] ${entry.name}` };
  };
  const taskRows = items => items.map(item => ({ file: file(item), type: valueText(item.data_type),
    status: status(item.parse_status), images: valueText(item.webp_count),
    created: valueText(item.create_time), error: item.parse_error || "—" }));
  const assetRows = items => items.map(item => ({ file: file(item),
    element: item.element_label || item.element_key || "未提供", resolution: resolution(item.resolution_key),
    time: valueText(item.valid_time), status: status(item.asset_status),
    mean: valueText(item.mean_value), unit: item.display_unit || item.raw_unit || "未提供" }));
  const tasksTable = (items, title = "任务明细") => table("tasks", title,
    [["file", "文件"], ["type", "数据类型"], ["status", "解析状态"], ["images", "图像数"], ["created", "入库时间（原值）"], ["error", "失败原因"]], taskRows(items));
  const assetsTable = items => table("assets", "资产明细",
    [["file", "所属文件"], ["element", "要素"], ["resolution", "登记分辨率"], ["time", "有效时间（原值）"], ["status", "资产状态"], ["mean", "已登记均值"], ["unit", "均值单位"]],
    assetRows(items), "一条资产通常对应一个文件中的某个要素、层次或分辨率，不等于一个源文件。未登记的时间、均值或单位显示为“未提供”，不代表 0。");

  const filterNames = { data_type: "数据类型", element_key: "要素", variable: "变量", parse_status: "解析状态",
    time_start: "开始时间", time_end: "结束时间", limit: "请求上限", threshold: "回波阈值" };
  for (const [key, label] of Object.entries(filterNames)) if (has(p[key])) view.filters.push({ label, value: valueText(p[key]) });
  view.referenceRunId = arr(run.events).findLast(e => e.data?.reference_run_id)?.data.reference_run_id || "";
  if (view.referenceRunId) view.notes.push("本次引用的是本会话已记录的结果，没有用系统最新文件替代。文件名称和标识见下方引用目录。");
  for (const source of arr(r.sources)) {
    if (source.source_file || source.meta_file) file(source);
    if (source.database) view.sources.push(`${source.database}${source.tables || source.table ? ` · ${arr(source.tables).join("、") || source.table}` : ""}`);
    if (source.provider === "weather-system") view.sources.push("天气系统已有数据与工具");
  }
  if (r.file) file(r.file);

  if (run.status !== "succeeded") {
    const inputEvent = arr(run.events).findLast(e => e.type === "need_input");
    const missing = arr(inputEvent?.data?.missing);
    const inputNames = { file_uuid: "文件标识", file_path: "原始文件路径", meta_file: "元数据文件路径", meta_files: "元数据文件列表", variable: "变量名", element_key: "要素名", data_type: "数据类型" };
    const recognitionError = arr(run.events).findLast(e => e.type === "recognition_error");
    const reason = String(recognitionError?.message || r.summary || arr(run.events).at(-1)?.message || "");
    if (run.status === "waiting_confirmation") {
      const isWinterArchive = String(r.archive_id || "").startsWith("jilin_2025_winter_era5_");
      view.headline = isWinterArchive
        ? "冬季覆冰档案预演已完成，尚未创建回放任务。请核对范围与确认操作。"
        : "文件检查已通过，尚未开始解析。请核对目标文件和写入风险，再决定是否确认。";
    } else if (run.status === "need_input") {
      view.headline = inputEvent?.data?.question || (missing.length ? `还需要补充${missing.map(k => inputNames[k] || k).join("、")}，当前没有执行查询或解析。` : inputEvent?.message || "请说明要查询的数据或文件，本次尚未执行。");
      if (run.recognition?.mode === "llm") view.notes.push("直接在输入框回答即可，本会话会保留已提供的信息。尚未执行查询或解析；文件路径和标识请提供实际值。");
      else if (missing.includes("file_uuid")) view.notes.push("先查询文件列表，再点击文件旁的“填入查询”，或输入 file_uuid=完整UUID；文件名不能代替文件标识。");
      else view.notes.push("请在输入框中补充 name=value 参数；文件路径加双引号。不要省略实际变量名或路径。");
    } else if (run.status === "unsupported") {
      view.headline = "当前工作流不支持这个请求，没有调用其他智能体执行。";
      if (run.recognition?.mode === "llm" && reason) view.notes.push(reason);
      view.notes.push(`可尝试：${arr(arr(run.events).findLast(e => e.type === "unsupported")?.data?.supported).join("、") || "巡检数据资产、查询最新 WRF 文件资产、汇总 WRF T2 资产"}。`);
    } else {
      view.headline = run.status === "rejected" ? "输入未通过检查，本次请求已被拒绝。" : "本次处理没有完成，不能将已有中间结果当作成功结果。";
      if (/时间维/.test(reason)) view.notes.push("所选数据没有明确的时间维，不能进行时序分析。请换用包含时间维的元数据及源文件。");
      else if (/路径必须位于|越界|outside data root/.test(reason)) view.notes.push("文件必须位于 backend_system/data 内；请核对路径，不支持任意桌面文件。");
      else if (/parse-existing/.test(reason)) view.notes.push("当前解析服务缺少或无法访问兼容接口，请先完成服务联调，不要重复确认。");
      else if (reason) view.notes.push(reason.split("\n")[0].slice(0, 240));
    }
    if (p.file_path || r.approved_inputs?.file_path) file({ file_path: r.approved_inputs?.file_path || p.file_path }, "请求文件");
    return view;
  }

  switch (template) {
    case "weather.data_catalog": {
      const datasets = arr(r.datasets);
      view.headline = datasets.length ? `本次返回 ${datasets.length} 个已解析数据集，变量数和可用图像见下表。` : "本次没有返回匹配的数据集。";
      metric("本次返回数据集", datasets.length, "个");
      table("datasets", "数据集目录", [["file", "数据集"], ["type", "类型"], ["variables", "已登记变量数"], ["times", "已登记时次数"], ["images", "图像数"]],
        datasets.map(item => ({ file: file(item, "数据集"), type: valueText(item.data_type), variables: Array.isArray(item.variables) ? item.variables.length : "未提供", times: valueText(item.times), images: valueText(item.png_count) })));
      view.notes.push("目录中的时次数来自已登记信息，不保证源变量具有可用于分析的时间维。数据集标识不是文件 UUID；变量清单可在引用目录中展开。");
      if (r.using_sample) view.warnings.push("本次使用了样例数据，不代表实际业务数据。");
      break;
    }
    case "weather.asset_overview": {
      const data = r.data || {}, counts = arr(data.detail_counts);
      view.headline = `数据库登记了 ${formatNumber(data.task_total)} 条上传或采集任务。任务状态和已入库资产分别统计如下。`;
      metric("登记任务", data.task_total, "条");
      metric("已入库资产", Array.isArray(data.detail_counts) ? total(counts, "asset_count") : null, "条");
      table("task-status", "任务状态分布", [["type", "类型"], ["status", "解析状态"], ["count", "任务数"]],
        arr(data.status_summary).map(item => ({ type: item.data_type, status: status(item.parse_status), count: item.count })));
      table("asset-count", "已入库资产分布", [["type", "类型"], ["files", "文件数"], ["assets", "资产数"], ["elements", "常见要素（资产数）"]],
        counts.map(item => ({ type: item.data_type, files: item.file_count, assets: item.asset_count,
          elements: arr(item.top_elements).map(e => `${e.element_key}：${e.count}`).join("；") })));
      tasksTable(arr(data.latest_tasks), "最近任务示例（不代表全部任务）");
      view.notes.push("任务数、文件数和资产数是不同口径；同一文件可生成多条资产。没有列出的数据类型不据此推断为 0。");
      break;
    }
    case "weather.parse_task_list": {
      const tasks = arr(r.tasks);
      view.headline = `本次返回 ${tasks.length} 条解析任务，按入库时间由近到远排列。`;
      metric("返回任务", tasks.length, "条"); tasksTable(tasks);
      view.notes.push("列表受查询上限约束，不代表数据库全部任务数。入库时间不等于气象观测时间。");
      break;
    }
    case "weather.file_assets":
    case "weather.latest_file_assets":
    case "weather.asset_query": {
      const assets = arr(r.assets);
      view.headline = r.file ? `已找到 ${r.file.original_file_name || "指定文件"}，本次返回 ${assets.length} 条资产明细。` : `按当前条件返回 ${assets.length} 条资产明细。`;
      metric("返回资产明细", assets.length, "条"); assetsTable(assets);
      metric("明细涉及文件", fileCount(assets), "个");
      view.notes.push("本次只展示接口返回的明细，受查询上限约束，不代表全库匹配总数。");
      if (template === "weather.latest_file_assets") view.notes.push("“最新”按入库时间选择成功解析文件，不代表气象观测时间最新。");
      break;
    }
    case "weather.wrf_asset_summary": {
      const records = arr(r.records), assets = arr(r.assets), count = total(records, "asset_count");
      view.headline = `WRF ${p.element_key || assets[0]?.element_key || "所选要素"} 在本次统计范围内有 ${formatNumber(count)} 条资产，接口返回其中 ${assets.length} 条明细。`;
      metric("本次统计资产", count, "条"); metric("返回资产明细", assets.length, "条");
      metric("明细涉及文件", fileCount(assets), "个");
      table("resolution", "按登记分辨率统计", [["resolution", "登记分辨率"], ["count", "资产数"]], records.map(item => ({ resolution: resolution(item.resolution_key), count: item.asset_count })));
      table("asset-status", "按资产状态统计", [["status", "资产状态"], ["count", "资产数"]], arr(r.status_records).map(item => ({ status: status(item.asset_status), count: item.asset_count })));
      assetsTable(assets);
      view.notes.push("统计先按上限读取候选资产，再筛选指定文件，不保证覆盖全库。明细最多返回 50 条，“明细涉及文件”只对返回的明细去重。");
      view.notes.push("此处统计的是资产数量，不是温度等气象值。native 表示原始网格，实际间距未标注，不从图片路径推断 1 km 或 3 km。");
      break;
    }
    case "weather.parse_failure_diagnosis": {
      const groups = arr(r.groups), count = total(groups, "count");
      view.headline = groups.length ? `返回 ${groups.length} 类失败原因，对应 ${formatNumber(count)} 条失败任务。` : "当前返回的分组中没有失败任务。";
      metric("返回分组对应失败任务", count, "条"); metric("失败原因类别", groups.length, "类");
      table("failures", "原因与处理建议", [["type", "类型"], ["count", "任务数"], ["reason", "失败原因"], ["retry", "是否适合直接重试"], ["suggestion", "建议"]],
        groups.map(item => ({ type: item.data_type, count: item.count, reason: item.parse_error, retry: item.retryable === true ? "建议核对后重试" : item.retryable === false ? "不建议" : "未提供", suggestion: item.suggestion })));
      tasksTable(arr(r.tasks), "最近失败任务（最多 10 条）");
      view.notes.push("失败原因分组受查询上限限制；任务示例与分组总数不等同。这里只提供诊断，不执行重试。");
      break;
    }
    case "weather.era5_timeseries":
    case "weather.radar_echo_change": {
      const radar = template === "weather.radar_echo_change", records = arr(r.records);
      const valid = records.filter(item => radar ? item.status === "ok" : Number.isFinite(item.mean));
      const unit = r.unit || r.display_unit || "单位未提供";
      view.headline = `本次返回 ${records.length} 条${radar ? "雷达" : "时序"}记录，其中 ${valid.length} 条有有效统计值。`;
      metric("有效统计记录", valid.length, "条"); metric("缺失或异常记录", records.length - valid.length, "条");
      table("timeseries", radar ? "逐时次回波统计" : "逐时次空间统计",
        [["time", "时间（原值）"], ["mean", `均值（${unit}）`], ["max", `最大值（${unit}）`], ...(radar ? [["threshold", "强回波阈值（原值）"], ["strong", "达到阈值的数据点数"]] : [["min", `最小值（${unit}）`]]), ["status", "状态"], ...(radar ? [["file", "来源文件"]] : [])],
        records.map(item => ({ time: valueText(item.time), mean: valueText(item.mean), max: valueText(item.max), min: valueText(item.min),
          threshold: valueText(item.threshold), strong: valueText(item.strong_count), status: radar ? status(item.status) : Number.isFinite(item.mean) ? "有效" : "无有效均值", file: radar ? file(item) : null })));
      view.notes.push(radar ? "均值、最大值基于文件内有限数值；达到阈值的数据点数采用 ≥ 阈值，不是回波覆盖面积。" : "每个时次对非时间维度做空间归约，均值与最大/最小值含义不同；此处不重新计算统计值。");
      if (valid.length < 2) view.notes.push("有效记录不足两条，不能判断变化趋势。");
      if (!r.unit && !r.display_unit) view.notes.push("接口没有返回结构化单位，数值保留原值，不擅自标成 °C、K 或 dBZ；完整原工具说明见技术详情。");
      view.notes.push("表格数值最多显示三位小数；完整数值保留在技术详情中。");
      break;
    }
    case "parser.existing_file":
      view.headline = "解析步骤已完成，返回的源文件与元数据见下方引用目录。";
      if (r.file_path || r.meta_file) file(r);
      break;
    default:
      view.headline = "处理已完成。此能力尚未配置专用展示，请展开技术详情核对原始结果。";
  }
  view.sources = [...new Set(view.sources)];
  return view;
}
