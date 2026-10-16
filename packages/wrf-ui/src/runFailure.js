const DETAIL_LIMIT = 12000;
function technicalDetails(values) {
  const parts = [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];
  const raw = parts.map(value => value.slice(0, DETAIL_LIMIT)).join('\n\n');
  const clean = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, 'Bearer [已脱敏]')
    .replace(/(["']?\b(?:authorization|password|passwd|pwd|access[_-]?token|refresh[_-]?token|token|api[_-]?key|client[_-]?secret|secret)\b["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&]+)?/gi, '$1[已脱敏]')
    .replace(/(--(?:password|passwd|token|api-key|secret)\s+)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[已脱敏]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[已脱敏]@');
  const truncated = parts.some(value => value.length > DETAIL_LIMIT) || clean.length > DETAIL_LIMIT;
  return clean.slice(0, DETAIL_LIMIT) + (truncated ? '\n[技术详情已截断]' : '');
}
// Derive display text without rewriting historical failures or guessing a cause.
export function runFailure(task = {}) {
  const failure = task.failure || {};
  const details = technicalDetails([task.error, failure.message, failure.evidence]);
  if (!details && !failure.failure_class) return null;
  const text = details.toLowerCase();
  const configurationRead = failure.failure_class === 'configuration_generation'
    || text.includes('namelist_layout_error')
    || (text.includes('namelist') && text.includes('end of file')
      && (text.includes('finding group') || text.includes('fio-f-228')));
  const outputValidation = text.includes('empty_output_schedule:')
    || text.includes('wrfout 完整性校验失败')
    || text.includes('缺少输出校验器')
    || (text.includes('traceback') && text.includes('validate_outputs.py'))
    || (failure.failure_class === 'output' && task.runtime?.output_validation?.complete === false);
  let summary;
  if (configurationRead) summary = '运行配置文件读取失败，请核查生成的 namelist。';
  else if (outputValidation) summary = '输出校验失败，结果尚未通过完整性检查。';
  else summary = ({
    output: '结果处理失败，请核查输出及可视化处理。',
    configuration: '运行配置校验失败，请核查配置。',
    data: '驱动资料处理失败，请核查资料。',
    external: '连接或外部服务出现异常，当前状态需要核验。',
  })[failure.failure_class] || '任务出现错误，具体原因尚未确认。';
  if (task.runtime?.remote_wrf_succeeded === true) summary = `远端 WRF 计算已完成；${summary}`;
  return {summary, details};
}
