<template>
  <slot />
  <p v-if="error" class="regional-raster-error" role="alert">{{ error }}</p>
</template>

<script setup>
import {inject,onBeforeUnmount,provide,ref,watch} from 'vue';
import {preloadFrame} from '../utils/frameImageCache';
import {regionalViewExtent,seasonalRasterWindow} from '../utils/seasonalGridView';

const props=defineProps({region:{type:Object,default:null}});
const surface=inject('mapSurface');
const controls=inject('mapControls',null);
const flyTo=inject('flyToExtent',null);
const error=ref('');
let generation=0, last=null, textureUrl='', ready=null;

function releaseTexture() {if(textureUrl)URL.revokeObjectURL(textureUrl);textureUrl='';ready=null;}
function clear() {generation++;last=null;error.value='';surface?.clear?.();releaseTexture();}
async function setData(src,extent,alpha=1,options={}) {
  const request=++generation;
  last=src && extent ? {src,extent,alpha,options} : null;
  error.value='';
  if (!last || !props.region) {releaseTexture();surface?.setData?.(src,extent,alpha,options);return;}
  const textureKey=JSON.stringify([src,extent,props.region.bbox,Boolean(options.mercator)]);
  if(ready?.key===textureKey) {
    surface?.setData?.(textureUrl,ready.extent,alpha,{...options,image:ready.image});
    return;
  }
  // Clear before awaiting: never flash a global or previous-frame texture.
  surface?.clear?.();
  releaseTexture();
  let pendingUrl='';
  try {
    if (options.mercator) throw new Error('当前区域图像投影不受支持。');
    const image=options.image || await preloadFrame(src);
    if (request!==generation)return;
    if (!image) throw new Error('指定区域的降水图像读取失败，请重试。');
    const crop=seasonalRasterWindow(extent,props.region.bbox,image.naturalWidth || image.width,image.naturalHeight || image.height);
    const cropped=document.createElement('canvas');cropped.width=crop.width;cropped.height=crop.height;
    const context=cropped.getContext('2d');
    if (!context)throw new Error('浏览器无法绘制指定区域。');
    context.drawImage(image,crop.sx,crop.sy,crop.sw,crop.sh,0,0,crop.width,crop.height);
    const blob=await new Promise(resolve=>cropped.toBlob(resolve,'image/png'));
    if(request!==generation)return;
    if(!blob)throw new Error('指定区域的图像生成失败。');
    pendingUrl=URL.createObjectURL(blob);
    const texture=new Image();texture.src=pendingUrl;await texture.decode();
    if(request!==generation)return;
    textureUrl=pendingUrl;pendingUrl='';
    ready={key:textureKey,extent:crop.extent,image:texture};
    // Only this texture and its exact region extent reach the map renderer.
    surface?.setData?.(textureUrl,crop.extent,alpha,{...options,image:texture});
  } catch(cause) {
    if(request===generation) {surface?.clear?.();error.value=cause.message || '区域图像读取失败。';}
  } finally {
    if(pendingUrl)URL.revokeObjectURL(pendingUrl);
  }
}
provide('mapSurface',{setData,clear});
if (controls)provide('mapControls',{...controls,home:()=>props.region ? flyTo?.(regionalViewExtent(props.region)) : controls.home()});
watch(()=>props.region,()=>{if(last)setData(last.src,last.extent,last.alpha,last.options);},{deep:true});
onBeforeUnmount(clear);
</script>

<style scoped>
.regional-raster-error {position:absolute;inset:0;display:grid;place-content:center;margin:0;padding:16px;background:var(--bg);color:var(--text);font-size:12px;z-index:6;}
</style>
