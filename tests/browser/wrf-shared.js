import {createApp,h} from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import WrfTaskConfig from '../../src/components/WrfTaskConfig.vue';
const options=await fetch('/__fixture__/options').then(r=>r.json());
createApp({render:()=>h(WrfTaskConfig,{options,initialRequest:window.__wrfInitialRequest,onSubmit:value=>{window.__wrfSubmission=value;}})}).use(ElementPlus).mount('#fixture');
