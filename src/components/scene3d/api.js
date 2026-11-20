import { authedFetch } from '../../api';

export const SCENE3D_BASE = (import.meta.env.VITE_SCENE3D_BASE || 'http://127.0.0.1:8013').replace(/\/$/, '');
export async function sceneFetch(path,options={}) {
  const response=await authedFetch(SCENE3D_BASE+path,options);
  if(!response.ok){
    const body=await response.json().catch(()=>({}));
    throw new Error(typeof body.detail==='string'?body.detail:`三维服务请求失败 (${response.status})`);
  }
  return response;
}
export async function sceneRequest(path,body,options={}) {
  const response=await sceneFetch('/api/scene3d'+path,{
    ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),...options,
  });
  return response.json();
}
