// Test-only component host. All requests are intercepted by Playwright.
import { createApp, h, ref } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import WrfTaskConfig from '../../src/components/WrfTaskConfig.vue';

const source = ref('gfs');
const options = await fetch('/__fixture__/options').then(r => r.json());
createApp({setup(){return()=>h('main',{style:'max-width:1200px;margin:auto;--border:#d0d0d0;--field:#f5f5f5;--muted:#666;--text:#222;--bg:white;--accent:#409eff;--glass:#fff;--glass-2:#fff'},[
  h('h1','WRF common contract browser fixture'),
  h(WrfTaskConfig,{options,initialRequest:options.fixture_initial_request,dataSource:source.value,onSubmit:value=>{window.__wrfSubmission=value;}}),
]);}}).use(ElementPlus).mount('#fixture');
