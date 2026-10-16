import test from 'node:test';
import assert from 'node:assert/strict';
import {runFailure} from '../src/runFailure.js';

test('output validator traceback is summarized while raw evidence remains available',()=>{
  const task=Object.freeze({error:'Traceback (most recent call last):\n  File "/private/remote/scripts/validate_outputs.py", line 67\nValueError: empty_output_schedule:d01',failure:{failure_class:'output'},runtime:{remote_wrf_succeeded:true}});
  const result=runFailure(task);
  assert.equal(result.summary,'远端 WRF 计算已完成；输出校验失败，结果尚未通过完整性检查。');
  assert.equal(result.details,task.error);
  assert.doesNotMatch(result.summary,/Traceback|\/private|empty_output_schedule/);
});
test('completion requires a strict runtime success flag and is never inferred from status or percentage',()=>{
  for(const runtime of [{},{remote_wrf_succeeded:false},{remote_wrf_succeeded:'true'},{model_progress:100,current_stage:'done'}]){
    assert.doesNotMatch(runFailure({error:'empty_output_schedule:d01',status:'failed',progress:100,runtime}).summary,/计算已完成/);
  }
  assert.match(runFailure({failure:{failure_class:'output'},runtime:{output_validation:{complete:false}}}).summary,/输出校验失败/);
  assert.match(runFailure({failure:{failure_class:'output'},error:'render service exception'}).summary,/结果处理失败/);
});
test('unknown errors remain unknown without leaking raw paths or diagnosing a model failure',()=>{
  const result=runFailure({error:'Traceback\n/private/remote/unknown.py: unexpected failure',failure:{failure_class:'model'}});
  assert.equal(result.summary,'任务出现错误，具体原因尚未确认。');
  assert.match(result.details,/\/private\/remote/);
  assert.equal(runFailure({}),null);
});
test('known generated namelist read failures use evidence without rewriting the historical failure class',()=>{
  const failure=Object.freeze({failure_class:'model',message:'remote exit 1',evidence:"FIO-F-228 namelist read: end of file reached without finding group '/private/namelist.wps'"});
  assert.match(runFailure({failure}).summary,/运行配置文件读取失败/);
  assert.equal(failure.failure_class,'model');
  assert.match(runFailure({failure:{failure_class:'configuration_generation'}}).summary,/配置文件读取失败/);
  assert.equal(runFailure({error:'namelist.input physics mismatch'}).summary,'任务出现错误，具体原因尚未确认。');
});
test('technical details redact credential forms and remain bounded',()=>{
  const error='Authorization: Bearer fixture-bearer\npassword="fixture secret"\n{"access_token":"fixture-access"}\n--token fixture-cli\nhttps://user:fixture-pass@host/path?token=fixture-query\n'+ 'x'.repeat(13000);
  const result=runFailure({error});
  assert.doesNotMatch(result.details,/fixture-bearer|fixture secret|fixture-access|fixture-cli|fixture-pass|fixture-query/);
  assert.match(result.details,/已脱敏/);
  assert.match(result.details,/技术详情已截断/);
  assert.ok(result.details.length<12100);
});
