import { fileTypes } from './formats.js';

const errors = {
  invalidFile: 'Faylni o‘qib bo‘lmadi. Fayl formati va sozligini tekshiring.',
  protectedFile: 'Parol bilan himoyalangan faylni o‘girib bo‘lmaydi.',
  largeFile: 'Fayl yoki uning ichidagi hujjat qismi juda katta.',
  noPdfText: 'Bu PDFda tanlanadigan matn topilmadi. O‘girish uchun tanlanadigan matn kerak.',
  worker: 'Fayl konverteri yuklanmadi. Sahifani yangilab, qayta urinib ko‘ring.',
};

function missingPages(pages) {
  return pages.length ? `Matn topilmagan PDF sahifalari: ${pages.join(', ')}.` : '';
}

export function setupFilePicker(getMode) {
  const input = document.querySelector('#file-input');
  const download = document.querySelector('#file-download');
  const status = document.querySelector('#file-status');
  let url;

  function clearDownload() {
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    download.hidden = true;
    download.removeAttribute('href');
  }

  function showStatus(message, error = false) {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  }

  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    clearDownload();
    const extension = /\.(\w+)$/.exec(file.name);
    const format = extension?.[1].toLowerCase();
    if (!Object.hasOwn(fileTypes, format)) {
      showStatus('DOCX, XLSX, PPTX yoki PDF faylini tanlang.', true);
      return;
    }
    const mode = getMode();
    input.disabled = true;
    showStatus(`${file.name} o‘girilmoqda…`);
    let worker;

    function finish() {
      worker?.terminate();
      input.disabled = false;
    }

    function fail() {
      finish();
      showStatus(errors.worker, true);
    }

    try {
      worker = new Worker(new URL('./file-worker.js', import.meta.url), { type: 'module' });
      worker.addEventListener('error', fail);
      worker.addEventListener('messageerror', fail);
      worker.addEventListener('message', ({ data }) => {
        finish();
        const pages = missingPages(data.pages ?? []);
        if (data.error) {
          showStatus([errors[data.error], pages].filter(Boolean).join('\n'), true);
          return;
        }
        const name = `${file.name.slice(0, extension.index) || 'fayl'}-alifbo${extension[0]}`;
        url = URL.createObjectURL(new Blob([data.bytes], { type: fileTypes[format] }));
        download.href = url;
        download.download = name;
        download.hidden = false;
        const artwork = data.missingArtwork?.length
          ? `Ayrim rasmlar yoki chizmalar saqlanmadi (${data.missingArtwork.join(', ')}-sahifalar).` : '';
        showStatus([`${name} tayyor.`, pages, artwork, data.missingGlyphs
          ? 'Tanlangan shriftda yo‘q belgilar � bilan almashtirildi.' : ''].filter(Boolean).join('\n'));
      });
      worker.postMessage({ file, format, mode });
    } catch {
      fail();
    }
  });

  window.addEventListener('pagehide', event => {
    if (!event.persisted) clearDownload();
  });
}
