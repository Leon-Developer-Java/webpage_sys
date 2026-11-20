// Prefer the browser's normal GPU choice so the WebGPU canvas can share
// textures with its compositor on dual-GPU laptops. No rendering fallback.
export async function requestWindDevice(gpu){
  if(!gpu)throw new Error('当前浏览器未提供 WebGPU');
  let lastError;
  for(const options of [undefined,{powerPreference:'high-performance'},{powerPreference:'low-power'}]){
    try{
      const adapter=options?await gpu.requestAdapter(options):await gpu.requestAdapter();
      if(adapter)return {adapter,device:await adapter.requestDevice()};
    }catch(error){lastError=error;}
  }
  throw new Error(lastError?.message||'WebGPU 未能创建适配器，已尝试浏览器默认、高性能及低功耗显卡');
}
