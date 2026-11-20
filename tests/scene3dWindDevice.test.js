import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestWindDevice} from '../src/components/scene3d/windDevice.js';

test('uses the normal compositor-compatible adapter without forcing the discrete GPU',async()=>{
  const calls=[],device={};
  const result=await requestWindDevice({requestAdapter:async(options)=>{calls.push(options);return {requestDevice:async()=>device};}});
  assert.deepEqual(calls,[undefined]);assert.equal(result.device,device);
});

test('tries another hardware preference if the first device cannot be created',async()=>{
  const device={},calls=[];
  const result=await requestWindDevice({requestAdapter:async(options)=>{
    calls.push(options?.powerPreference);
    return {requestDevice:async()=>{if(!options)throw new Error('device lost');return device;}};
  }});
  assert.deepEqual(calls,[undefined,'high-performance']);assert.equal(result.device,device);
});

test('tries low power after unavailable default and high-performance adapters',async()=>{
  const device={};
  const result=await requestWindDevice({requestAdapter:async(options)=>options?.powerPreference==='low-power'?{requestDevice:async()=>device}:null});
  assert.equal(result.device,device);
});

test('reports unavailable adapters and never selects a different renderer',async()=>{
  await assert.rejects(requestWindDevice({requestAdapter:async()=>null}),/WebGPU/);
  await assert.rejects(requestWindDevice(undefined),/WebGPU/);
});
