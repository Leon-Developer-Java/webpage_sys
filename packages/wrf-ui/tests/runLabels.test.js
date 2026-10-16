import test from 'node:test';
import assert from 'node:assert/strict';
import {runProgress,runStageLabel,runStatusLabel} from '../src/runLabels.js';
test('run labels explain recovery, failure and computation stages in Chinese',()=>{
  assert.equal(runStatusLabel('waiting_restart'),'等待恢复');
  assert.equal(runStatusLabel('failed'),'已失败');
  assert.equal(runStageLabel('wrf'),'WRF 模拟运行');
  assert.equal(runStageLabel('wps'),'WPS 前处理');
  assert.equal(runStageLabel('waiting_for_hpc_forcing'),'等待驱动资料');
});
test('unknown run labels retain the actual code and identify the missing mapping',()=>{
  assert.equal(runStatusLabel('new_status'),'未知状态（new_status）');
  assert.equal(runStageLabel('new_stage'),'未知阶段（new_stage）');
});
test('WPS has no invented model percentage and WRF uses measured model time',()=>{
  const wps=runProgress({status:'running',stage:'running',progress:68,runtime:{current_stage:'wps'}});
  assert.equal(wps.stage,'wps');assert.equal(wps.percent,null);assert.match(wps.hint,/暂无可测/);
  const wrf=runProgress({status:'running',stage:'running',progress:68,runtime:{current_stage:'wrf',current_model_time:'2026-10-06T00:30:00Z',model_progress:50}});
  assert.equal(wrf.modelTime,'2026-10-06 00:30:00 UTC');assert.equal(wrf.label,'模拟进度 50%');
});
test('terminal and result workflow stages override stale simulation stage',()=>{
  const failed=runProgress({status:'waiting_restart',stage:'failed',progress:68,runtime:{current_stage:'wrf',model_progress:50}});
  assert.equal(failed.stage,'failed');assert.equal(failed.label,'最后观测流程进度 68%');
  assert.equal(runProgress({status:'rendering',stage:'rendering',progress:94,runtime:{current_stage:'wrf'}}).stage,'rendering');
});
