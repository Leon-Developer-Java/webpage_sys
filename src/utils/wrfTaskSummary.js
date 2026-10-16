import {runStatusLabel} from '@zhihuiqixiang/wrf-ui/status';
export function wrfTaskSummary(task={}) {
  const status=task.status==='waiting_restart'?(task.stage==='failed'?'失败·待处理':'状态待核验'):runStatusLabel(task.status),progress=task.runtime?.model_progress;
  return task.status==='running'&&task.runtime?.current_stage==='wrf'&&typeof progress==='number'&&Number.isFinite(progress)&&progress>=0&&progress<=100
    ? `${status} · 模拟进度 ${Number(progress.toFixed(1))}%` : status;
}
