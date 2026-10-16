// Retained compatibility URL; ordinary regressions live in the shared UI suite.
import {createApp,h} from 'vue';
createApp({render:()=>h('main',{style:'max-width:720px;margin:64px auto;font-family:system-ui;line-height:1.8'},[
 h('h1','高分配置测试入口已退役'),
 h('p','普通 WRF 配置、地图、运行与结果回归已迁至共享组件测试。此页面不访问后端、不提供高分配置。'),
 h('p',[h('code','npm run test:wrf-browser')]),
 h('a',{href:'/tests/browser/wrf-shared.html'},'查看普通共享 UI 测试入口（需隔离测试夹具）')
])}).mount('#app');
