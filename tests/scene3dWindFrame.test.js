import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WrfWindWebGpu} from '../src/components/scene3d/windRenderer.js';

function fixture() {
  const requests=[],writes=[],statuses=[];
  const renderer=new WrfWindWebGpu({}, {}, {
    frames:[{},{},{}],dimensions:{x:1,y:1},
  }, {
    status:value=>statuses.push(value),
    fetch:path=>new Promise(resolve=>requests.push({
      path,
      finish:value=>resolve({
        ok:true,
        arrayBuffer:async()=>new Float32Array([value,0,0,0]).buffer,
      }),
    })),
  });
  renderer.device={queue:{writeTexture:(_target,values)=>writes.push(values[0])}};
  renderer.windTexture={};
  renderer.frameIndex=0;
  return {renderer,requests,writes,statuses};
}

test('returning to the displayed frame rejects a pending different frame',async()=>{
  const {renderer,requests,writes,statuses}=fixture();
  const pending=renderer.setFrame(1);
  await renderer.setFrame(0);
  requests[0].finish(1);
  await pending;
  assert.equal(requests.length,1);
  assert.equal(renderer.requestedFrame,0);
  assert.equal(renderer.frameIndex,0);
  assert.deepEqual(writes,[]);
  assert.deepEqual(statuses,[]);
});

test('out-of-order responses display only the most recent selected frame',async()=>{
  const {renderer,requests,writes}=fixture();
  const first=renderer.setFrame(1),latest=renderer.setFrame(2);
  requests[1].finish(2);await latest;
  requests[0].finish(1);await first;
  assert.deepEqual(writes,[2]);
  assert.equal(renderer.frameIndex,2);
});

test('repeated frame indices cannot make an older request current again',async()=>{
  const {renderer,requests,writes}=fixture();
  const first=renderer.setFrame(1),middle=renderer.setFrame(2),latest=renderer.setFrame(1);
  requests[2].finish(101);await latest;
  requests[0].finish(1);await first;
  requests[1].finish(2);await middle;
  assert.deepEqual(writes,[101]);
  assert.equal(renderer.frameIndex,1);
});

test('a response for a replaced GPU device never writes its texture',async()=>{
  const {renderer,requests,writes}=fixture();
  const pending=renderer.setFrame(1);
  renderer.device={queue:{writeTexture:()=>assert.fail('stale device write')}};
  requests[0].finish(1);await pending;
  assert.deepEqual(writes,[]);
  assert.equal(renderer.frameIndex,0);
});

test('a response arriving after disposal never writes or reports a frame',async()=>{
  const {renderer,requests,writes,statuses}=fixture();
  const pending=renderer.setFrame(1);
  renderer.disposed=true;
  requests[0].finish(1);await pending;
  assert.deepEqual(writes,[]);
  assert.deepEqual(statuses,[]);
});

test('the selected frame still uploads and reports its original status',async()=>{
  const {renderer,requests,writes,statuses}=fixture();
  const pending=renderer.setFrame(1);
  requests[0].finish(1);await pending;
  assert.deepEqual(writes,[1]);
  assert.equal(renderer.frameIndex,1);
  assert.deepEqual(statuses,['风场 2/3']);
});
