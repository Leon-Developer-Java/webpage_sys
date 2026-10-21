import base from './playwright.wrf.config.js';
export default {...base,testMatch:'wrf-attempt-history.spec.mjs',outputDir:'/private/tmp/wrf-attempt-history-browser',use:{...base.use,baseURL:'http://127.0.0.1:5209'},webServer:{command:'npm run dev -- --port 5209 --strictPort',url:'http://127.0.0.1:5209/tests/browser/wrf-shared.html',reuseExistingServer:false}};
