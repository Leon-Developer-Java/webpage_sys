// Isolated UI regression fixture: no request reaches a running backend.
import { createApp, ref, h } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import '../../src/styles/global.css';
import DownscaleTaskConfig from '../../src/components/DownscaleTaskConfig.vue';
import WrfTaskConfig from '../../src/components/WrfTaskConfig.vue';
const submitted = ref(null);
const terrainAvailable = ref(false);
const asset = { id:'fixture-terrain', label:'测试地形', version:'v1', status:'approved', suitability:'ready', horizontal_crs:'EPSG:32650', hchar_m:10 };
window.fetch = async (url, options = {}) => {
  const path = new URL(url, location.href).pathname;
  let data = {};
  if (path.endsWith('/templates')) data = { parameterization:{default_profile_id:'standard-rans-thermal/v1',profiles:[]} };
  if (path.endsWith('/terrain-assets')) data = { items:[asset] };
  if (path.endsWith('/resolve')) data = { items:terrainAvailable.value ? [asset] : [], recommended_asset_id:terrainAvailable.value ? asset.id : null };
  if (path.endsWith('/validate')) {
    const value = JSON.parse(options.body);
    data = { confirmation_token:'fixture-confirmation-token-only-123456789', product:{width_m:500,height_m:500}, surface:{mode:value.surface_mode}, cfd_domain:{width_m:1100,height_m:1100,buffer_m:300,estimated_cells:10500000,estimated_memory_gib:16,estimated_disk_gib:100}, sampling:{solver_family:'rans',selected_valid_times:[value.start_time]}, certification:{status:'research'} };
  }
  return new Response(JSON.stringify({code:0,data}),{status:200,headers:{'Content-Type':'application/json'}});
};
createApp({
  setup() {
    const mode = ref(new URLSearchParams(location.search).get('mode') === 'ordinary' ? 'ordinary' : 'highres');
    const generation = ref(0);
    return () => h('main', { class:'app', style:'max-width:1400px;margin:auto;padding:16px' }, [
      h('p', '隔离测试页面 · 所有接口均为模拟数据'),
      h('button', { onClick:() => {mode.value='ordinary'; generation.value++;} }, '新建模拟任务'),
      h('button', { onClick:() => {mode.value='highres'; generation.value++;} }, '新建高分任务'),
      h('button', { onClick:() => {terrainAvailable.value=!terrainAvailable.value;generation.value++;} }, '切换地形覆盖'),
      h(mode.value==='highres' ? DownscaleTaskConfig : WrfTaskConfig, {key:generation.value,onSubmit:value=>submitted.value=value}),
      h('pre', {id:'submitted'}, submitted.value ? JSON.stringify(submitted.value,null,2) : '尚未提交')
    ]);
  }
}).use(ElementPlus).mount('#app');
