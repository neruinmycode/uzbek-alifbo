import init, {convert} from './wasm/alifbo.js';
let ready=false;
const el=id=>document.getElementById(id);
function view(file){el('filePanel').hidden=!file;el('textPanel').hidden=file;el('textTab').setAttribute('aria-pressed',String(!file));el('fileTab').setAttribute('aria-pressed',String(file))}
function update(){if(!ready)return;const mode=el('direction').value;const value=el('source').value;el('result').value=convert(value,mode);el('suggest').hidden=mode==='cyrillic'||!/[А-Яа-яЎўҚқҒғҲҳ]/.test(value);}
let selected, worker, output;
function start(){
  if(worker) worker.terminate();
  if(output) URL.revokeObjectURL(output);
  const link=el('download');
  el('status').removeAttribute('data-ready');
  link.hidden=true;
  link.removeAttribute('href');
  if(!selected) return;
  const format=selected.name.split('.').pop().toLowerCase();
  el('choose').textContent='Boshqa fayl tanlang';
  if(!['docx','xlsx','pptx'].includes(format)){
    el('status').textContent='DOCX, XLSX yoki PPTX faylini tanlang.';
    return;
  }
  el('status').textContent=selected.name+' o‘girilmoqda…';
  worker=new Worker(new URL('./file-worker.js', import.meta.url),{type:'module'});
  worker.onerror=()=>{el('status').textContent='Konverter yuklanmadi. Qayta urinib ko‘ring.'};
  worker.onmessage=({data})=>{
    worker.terminate();
    if(data.error){el('status').textContent='Faylni o‘girib bo‘lmadi.';return}
    output=URL.createObjectURL(new Blob([data.bytes],{type:selected.type||'application/octet-stream'}));
    link.href=output;
    link.download=selected.name.replace(/\.[^.]+$/,'-alifbo.'+format);
    link.hidden=false;
    el('status').setAttribute('data-ready','');
    el('status').textContent=link.download+' tayyor.'+(data.pages?.length?' Matnsiz sahifalar: '+data.pages.join(', '):'');
  };
  worker.postMessage({file:selected,format,mode:el('direction').value});
}
el('choose').onclick=()=>el('pick').click();
el('pick').onchange=()=>{if(el('pick').files.length){selected=el('pick').files[0];el('pick').value='';start()}};
el('textTab').onclick=()=>view(false);el('fileTab').onclick=()=>view(true);
el('source').oninput=update;
el('direction').onchange=()=>{update();start()};
el('suggest').onclick=()=>{el('direction').value='cyrillic';update();start()};
init().then(()=>{ready=true;update()}).catch(()=>{el('result').placeholder='Konverter yuklanmadi. Sahifani yangilang.'});

if (location.hostname === 'neruinmycode.github.io') {
  const beacon = document.createElement('script');
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.dataset.cfBeacon = JSON.stringify({ token: '8fb8704a75e34fa4a5924bab9a20e2f3' });
  document.head.append(beacon);
}
