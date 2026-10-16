import {defineComponent,defineCustomElement,h,useHost,ref,provide,onMounted,onBeforeUnmount,watch} from 'vue';
import leafletCss from 'leaflet/dist/leaflet.css?inline';
import css from './ui.css?inline';
import ConfigEditor from './ConfigEditor.vue';
import DomainMap from './DomainMap.vue';
import RunViewer from './RunViewer.vue';
import ResultViewer from './ResultViewer.vue';
export * from './model.js';
export {runStatusLabel,runStageLabel,runProgress} from './runLabels.js';
export const version='2.2.5';
export const sourceFingerprint=typeof __WRF_UI_SOURCE_SHA__==='string'?__WRF_UI_SOURCE_SHA__:'source-development';
export const interfaceVersion='wrf-ui-2';
const props=['presentation','submitLabel','logAttemptNo','error','config','options','preview','previewPending','previewError','disabled','submitDisabled','submitReason','readOnly','hideSubmit','hostMode','showHeader','editorKey','theme','task','logs','product','assetResponses','allowedActions'];
function element(component){return defineCustomElement(defineComponent({props,setup(p){
  const host=useHost(),theme=ref('light');host.setAttribute('data-wrf-version',version);host.setAttribute('data-wrf-source',sourceFingerprint);provide('wrf-theme',theme);
  const syncTheme=()=>{const root=host.ownerDocument.documentElement;theme.value=['dark','light'].includes(p.theme)?p.theme:root.classList.contains('dark')||root.dataset.theme==='dark'?'dark':'light';host.setAttribute('data-theme',theme.value);};
  let observer;onMounted(()=>{syncTheme();observer=new MutationObserver(syncTheme);observer.observe(host.ownerDocument.documentElement,{attributes:true,attributeFilter:['class','data-theme']});});onBeforeUnmount(()=>observer?.disconnect());watch(()=>p.theme,syncTheme);
  // Cached assets may resolve synchronously. Dispatch after CE mounting to
  // avoid a reentrant property patch; validation events must remain synchronous.
  const event=name=>detail=>{const dispatch=()=>{if(host?.isConnected)host.dispatchEvent(new CustomEvent(name,{detail,bubbles:true,composed:true}));};if(name==='asset-request')queueMicrotask(dispatch);else dispatch();};return()=>h(component,{...p,onConfigChange:event('config-change'),onPreviewRequest:event('preview-request'),onAction:event('action'),onAssetRequest:event('asset-request'),onValidationChange:event('validation-change')});
}}),{styles:[leafletCss,css]});}

export function registerWrfElements(){for(const [name,component] of Object.entries({'wrf-config-editor':ConfigEditor,'wrf-domain-map':DomainMap,'wrf-run-viewer':RunViewer,'wrf-result-viewer':ResultViewer})){const previous=customElements.get(name);if(previous&&(previous.wrfVersion!==version||previous.wrfSource!==sourceFingerprint))return false;if(!previous){const constructor=element(component);constructor.wrfVersion=version;constructor.wrfSource=sourceFingerprint;customElements.define(name,constructor);}}return true;}
