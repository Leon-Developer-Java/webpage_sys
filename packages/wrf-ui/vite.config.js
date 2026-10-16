import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { copyFileSync,existsSync } from 'node:fs';
import {resolve} from 'node:path';
const outDir=process.env.WRF_UI_BUILD_OUT||'dist';
export default defineConfig({define:{__WRF_UI_SOURCE_SHA__:JSON.stringify(process.env.WRF_UI_SOURCE_SHA||"source-development")},plugins:[vue(),{name:'types',closeBundle(){if(existsSync(outDir)){copyFileSync('src/index.d.ts',resolve(outDir,'index.d.ts'));copyFileSync('src/runLabels.js',resolve(outDir,'status.js'));copyFileSync('src/status.d.ts',resolve(outDir,'status.d.ts'));}}}],build:{outDir,lib:{entry:'src/index.js',formats:['es'],fileName:()=> 'wrf-ui.js'},emptyOutDir:true}});
