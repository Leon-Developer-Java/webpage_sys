const statuses = {
  succeeded:'已完成',partial_success:'部分结果',failed:'已失败',cancelled:'已取消',
  running:'运行中',queued:'排队中',cancel_pending:'取消中',reconciling:'核验运行状态',
  waiting_restart:'等待恢复',waiting_connection:'等待连接',blocked_storage:'存储空间不足',
  paused_external:'运行已暂停',prefetching:'准备驱动资料',uploading:'准备计算环境',rendering:'生成可视化',
};
const stages = {
  prepare:'任务调度',data:'准备驱动资料',workspace:'准备计算目录',wps:'WPS 前处理',
  queued:'等待调度',selecting_cycle:'选择资料周期',waiting_for_forcing_cache:'等待驱动资料缓存',
  checking_hpc_forcing:'核验驱动资料',waiting_for_hpc_forcing:'等待驱动资料',
  remote_forcing_ready:'驱动资料已就绪',preparing_hpc:'准备计算环境',running:'WPS / WRF 运行中',
  geogrid:'处理地理资料',ungrib:'解析驱动资料',metgrid:'插值驱动资料',real:'生成初始与边界条件',wrf:'WRF 模拟运行',
  checking_remote_outputs:'核验计算输出',downloading_outputs:'传输计算结果',rendering:'生成可视化',
  retrying_outputs:'重新获取计算结果',retrying_partial_render:'重新生成部分可视化',
  done:'已完成',failed:'已失败',cancelled:'已取消',cancel_pending:'等待取消完成',
  reconciling:'核验运行状态',paused_external:'运行已暂停',waiting_restart:'等待恢复',
};
export function runStatusLabel(value){return statuses[value]||(value?`未知状态（${value}）`:'等待开始');}
export function runStageLabel(value){return stages[value]||(value?`未知阶段（${value}）`:'等待开始');}
export function runProgress(task={}){
  const runtime=task.runtime||{};
  const modeling=['running','prepare','data','workspace','wps','real','wrf'].includes(task.stage)&&!['failed','cancelled','waiting_restart','succeeded','partial_success'].includes(task.status);
  const stage=modeling?(runtime.current_stage||task.stage):task.stage;
  const observed=typeof runtime.current_model_time==='string'?runtime.current_model_time:'';
  const parsed=/Z$|[+-]\d\d:\d\d$/.test(observed)?new Date(observed):null;
  const modelTime=parsed&&Number.isFinite(+parsed)?parsed.toISOString().replace('T',' ').replace('.000Z',' UTC'):'';
  const measured=modeling?runtime.model_progress:task.progress;
  const percent=typeof measured==='number'&&Number.isFinite(measured)?Math.max(0,Math.min(100,measured)):null;
  return {stage,modelTime,percent,label:percent===null?'':`${modeling?'模拟进度':['failed','waiting_restart','cancelled'].includes(task.status)?'最后观测流程进度':'流程进度'} ${Number(percent.toFixed(1))}%`,hint:percent!==null?'':(runtime.current_stage_status==='completed'?'当前阶段已完成，等待后续阶段':(['prepare','data','workspace','wps','real'].includes(stage)?'前处理运行中，暂无可测模拟进度':'等待模拟时间推进'))};
}
