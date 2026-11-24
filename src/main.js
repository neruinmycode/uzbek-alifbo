import init, { convert } from './wasm/alifbo.js';
import { setupFilePicker } from './file-picker.js';

let wasmReady = false;

const source = document.querySelector('#source');
const result = document.querySelector('#result');
const tabs = [...document.querySelectorAll('[data-mode]')];
const countSource = document.querySelector('#source-count');
const countResult = document.querySelector('#result-count');
const status = document.querySelector('#status');
let mode = 'latin';
let toastTimer;
const samples = {
  latin: [
    'O‘zbekiston — bizning Vatanimiz. Yangi alifboda o‘qish va yozish qulay bo‘ladi.',
    'SHARQ, CHIROQ, G‘ALABA, O‘ZBEKISTON. Shahar, Chortoq, G‘uzor.',
    'Shahar chetidagi bog‘da o‘quvchilar yangi o‘zbek alifbosini o‘rganishdi. O‘qituvchi ularga sh, ch, o‘ va g‘ harflari qanday o‘zgarishini tushuntirdi.'
  ],
  cyrillic: [
    'Ўзбекистон — бизнинг Ватанимиз. Янги алифбода ўқиш ва ёзиш қулай бўлади.',
    'ШАРҚ, ЧИРОҚ, ҒАЛАБА, ЎЗБЕКИСТОН. Шаҳар, Чортоқ, Ғузор.',
    'Шаҳар четидаги боғда ўқувчилар янги ўзбек алифбосини ўрганишди. Ўқитувчи уларга ҳарфлар қандай ўзгаришини тушунтирди.'
  ],
  reverse: [
    'Özbekiston — bizning Vatanimiz. Yangi alifboda öqiş va yoziş qulay böladi.',
    'ŞARQ, ÇIROQ, ĞALABA, ÖZBEKISTON. Şahar, Çortoq, Ğuzor.',
    'Şahar çetidagi bağda öquvçilar yangi özbek alifbosini örganişdi. Öqituvçi ularga ş, ç, ö va ğ harflari qanday özgarişini tuşuntirdi.'
  ]
};
function stats(text) {
  const chars = [...text].length;
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return `${chars.toLocaleString('uz-UZ')} ta belgi · ${words.toLocaleString('uz-UZ')} ta so‘z`;
}
function render() {
  if (!wasmReady) return;
  result.value = convert(source.value, mode);
  countSource.textContent = stats(source.value);
  countResult.textContent = stats(result.value);
  status.textContent = source.value.trim() ? 'O‘girildi ✓' : 'Tayyor';
  status.classList.toggle('success', !!source.value.trim());
}
function showToast(message) {
  const toast = document.querySelector('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
tabs.forEach(tab => tab.addEventListener('click', () => {
  mode = tab.dataset.mode;
  tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
  document.querySelector('#input-label').textContent = mode === 'latin' ? 'Eski lotin yozuvi' : mode === 'cyrillic' ? 'Kirill yozuvi' : 'Yangi lotin yozuvi';
  document.querySelector('#result-label').textContent = mode === 'reverse' ? 'Eski lotin yozuvi' : 'Yangi lotin yozuvi';
  source.placeholder = mode === 'cyrillic' ? 'Матнни шу ерга ёзинг ёки жойланг...' : 'Matnni shu yerga yozing yoki joylang...';
  render();
}));
source.addEventListener('input', render);
document.querySelector('#clear-btn').addEventListener('click', () => { source.value = ''; render(); source.focus(); });
document.querySelector('#paste-btn').addEventListener('click', async () => {
  try {
    if (!navigator.clipboard?.readText) throw Error('Clipboard not available');
    const text = await navigator.clipboard.readText();
    source.value = text;
    render();
    source.focus();
    showToast('Matn joylandi');
  } catch { source.focus(); showToast('Buferga ruxsat berilmadi. Ctrl+V tugmalaridan foydalaning.'); }
});
async function copyResult() {
  if (!result.value) { showToast('Avval matn kiriting'); return; }
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(result.value); }
    else throw Error('clipboard unavailable');
  } catch {
    result.focus(); result.select();
    try {
      if (!document.execCommand('copy')) throw Error('copy failed');
    } catch { showToast('Natijani belgilab, Ctrl+C bilan nusxalang'); return; }
  }
  showToast('Natija nusxalandi ✓');
}
document.querySelector('#copy-btn').addEventListener('click', copyResult);
document.querySelector('#inline-copy-btn').addEventListener('click', copyResult);
document.querySelector('#download-btn').addEventListener('click', () => {
  if (!result.value) { showToast('Avval matn kiriting'); return; }
  const file = new Blob(['\uFEFF', result.value], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url; link.download = 'yangi-alifbo.txt';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Matn fayli tayyor');
});
document.querySelectorAll('[data-example]').forEach(btn => btn.addEventListener('click', () => {
  source.value = samples[mode][Number(btn.dataset.example)-1];
  render(); source.focus();
}));
setupFilePicker(() => mode);
status.textContent = 'Yuklanmoqda…';
init().then(() => {
  wasmReady = true;
  render();
}).catch(() => {
  status.textContent = 'Konverter yuklanmadi. Sahifani yangilang.';
});
