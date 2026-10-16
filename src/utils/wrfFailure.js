// Keep historical failure records unchanged; derive a clearer presentation.
export function wrfConfigurationFailure(failure, logs = "") {
  const text = `${failure?.message || ""}\n${failure?.evidence || ""}\n${logs}`.toLowerCase();
  return failure?.failure_class === "configuration_generation"
    || text.includes("namelist_layout_error")
    || (text.includes("namelist") && text.includes("end of file")
      && (text.includes("finding group") || text.includes("fio-f-228")));
}

export const configurationFailureAdvice = "系统生成的配置文件无法读取。请修复生成器，重新校验并确认计划；无需盲目调整气象参数，不要直接重试旧配置。";

// Do not expose remote tracebacks, credentials or absolute deployment paths.
export function safeError(value) {
  const text=String(value||'');
  if (/Traceback|FileNotFoundError|Bearer\s|\/mnt\/|\/Users\/|\/home\//i.test(text)) return '操作未完成，详细诊断已保留，请重新核验任务状态。';
  return text.slice(0,600);
}
