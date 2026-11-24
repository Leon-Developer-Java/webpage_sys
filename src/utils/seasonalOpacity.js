import {onBeforeUnmount,onMounted,ref,watch} from 'vue';

const KEY='weather-seasonal-opacity';
const DEFAULT=65;
function percentage(value) {
  if(value===null || value===undefined || value==='')return DEFAULT;
  const number=Number(value);
  return Number.isFinite(number) ? Math.max(0,Math.min(100,number)) : DEFAULT;
}
export function useSeasonalOpacity() {
  let saved;
  try {saved=localStorage.getItem(KEY);} catch { /* Storage may be unavailable. */ }
  const opacity=ref(percentage(saved));
  watch(opacity,value=>{try {localStorage.setItem(KEY,String(percentage(value)));} catch { /* Keep the current display usable. */ }});
  function sync(event) {if(event.key===KEY)opacity.value=percentage(event.newValue);}
  onMounted(()=>window.addEventListener('storage',sync));
  onBeforeUnmount(()=>window.removeEventListener('storage',sync));
  return opacity;
}
