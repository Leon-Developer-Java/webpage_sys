<template><section><p v-if="error" role="alert" class="error">{{error}}</p><wrf-result-viewer v-if="product" :product.prop="product" :assetResponses.prop="responses" @asset-request="loadAsset($event.detail)"/><p v-else>正在读取结果…</p></section></template>
<script setup>
import {onBeforeUnmount,ref,watch} from 'vue';
import {registerWrfElements} from '@zhihuiqixiang/wrf-ui';
import {fetchWrfAsset,getWrfDisplay} from '../api.js';
registerWrfElements();
const props=defineProps({taskId:String});const product=ref(null),responses=ref({}),error=ref('');
let generation=0,assetSequence=0;const controllers=new Map(),urls=new Set();
function release(){assetSequence++;controllers.forEach(c=>c.abort());controllers.clear();urls.forEach(u=>URL.revokeObjectURL(u));urls.clear();responses.value={};}
async function loadAsset({path,requestId}){const call=generation,asset=++assetSequence;controllers.forEach(c=>c.abort());controllers.clear();const controller=new AbortController();controllers.set(requestId,controller);try{const blob=await fetchWrfAsset(path,controller.signal);if(call!==generation||asset!==assetSequence)return;const bitmap=await createImageBitmap(blob);bitmap.close();if(call!==generation||asset!==assetSequence)return;const url=URL.createObjectURL(blob);urls.add(url);responses.value={[requestId]:{url}};for(const old of urls)if(old!==url){URL.revokeObjectURL(old);urls.delete(old);}}catch(e){if(call===generation&&asset===assetSequence&&e.name!=='AbortError')responses.value={[requestId]:{error:e.message}};}finally{controllers.delete(requestId);}}
watch(()=>props.taskId,async id=>{const call=++generation;release();product.value=null;error.value='';try{const value=await getWrfDisplay(id);if(call!==generation)return;if(!value?.meta_json)throw new Error('该任务暂无可视化产品');product.value=value;}catch(e){if(call===generation)error.value=e.message;}},{immediate:true});
onBeforeUnmount(()=>{generation++;release();});
</script>
<style scoped>.error{padding:16px;color:#b33}</style>
