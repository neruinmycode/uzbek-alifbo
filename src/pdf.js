import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PageSizes } from 'pdf-lib';
import { getDocument, PasswordResponses, PDFWorker } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { convert } from './wasm/alifbo.js';
import { ConversionError } from './formats.js';

const margin = 48;
const fontSize = 12;
const lineHeight = 18;
const [pageWidth, pageHeight] = PageSizes.A4;

function subsetFontName() {
  // PDF font subsets use a six-letter tag followed by the PostScript name.
  const tag = Array.from(crypto.getRandomValues(new Uint8Array(6)),
    byte => String.fromCharCode(65 + byte % 26)).join('');
  return `${tag}+NotoSans-Regular`;
}

function extractText(items) {
  const fragments = [];
  for (const item of items) {
    if ('str' in item) fragments.push(item.str, item.hasEOL ? '\n' : '');
  }
  return fragments.join('');
}

function* wrap(text, font) {
  const maxWidth = pageWidth - 2 * margin;
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) yield line;
      line = '';
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, fontSize) > maxWidth) {
          yield line;
          line = '';
        }
        line += character;
      }
    }
    yield line;
  }
}

export async function convertPdf(data, mode) {
  // Vite places both document workers under assets/. The remaining resources
  // are shipped beside index.html and fetched only from this build's origin.
  const root = new URL('../', self.location.href);
  const asset = path => new URL(path, root).href;
  const port = new Worker(pdfWorkerUrl, { type: 'module' });
  const worker = new PDFWorker({ port });
  const loading = getDocument({
    data,
    worker,
    cMapUrl: asset('pdf-assets/cmaps/'),
    standardFontDataUrl: asset('pdf-assets/standard_fonts/'),
    iccUrl: asset('pdf-assets/iccs/'),
    useWorkerFetch: true,
    disableWorkerRendering: true,
    disableFontFace: true,
    useWasm: false,
  });
  const workerFailure = new Promise((_, reject) =>
    port.addEventListener('error', () => reject(new ConversionError('worker')), { once: true }));
  const pages = [];
  let missingGlyphs = false;

  async function rebuild() {
    const input = await loading.promise;
    const output = await PDFDocument.create();
    output.registerFontkit(fontkit);
    let font;
    let supported;

    for (let number = 1; number <= input.numPages; number++) {
      const source = await input.getPage(number);
      const content = await source.getTextContent();
      source.cleanup();
      const text = extractText(content.items).trim();
      if (!text) {
        pages.push(number);
        continue;
      }
      if (!font) {
        const response = await fetch(asset('fonts/NotoSans-Regular.ttf'));
        if (!response.ok) throw new ConversionError('worker');
        font = await output.embedFont(await response.arrayBuffer(), {
          subset: true,
          customName: subsetFontName(),
          features: { liga: false, clig: false },
        });
        supported = new Set(font.getCharacterSet());
      }
      const converted = Array.from(convert(text, mode), ch => {
        if (ch === '\n' || ch === '\t' || supported.has(ch.codePointAt(0))) return ch;
        missingGlyphs = true;
        return '�';
      }).join('');

      let page = output.addPage(PageSizes.A4);
      let y = pageHeight - margin - fontSize;
      for (const line of wrap(converted, font)) {
        if (y < margin) {
          page = output.addPage(PageSizes.A4);
          y = pageHeight - margin - fontSize;
        }
        if (line) page.drawText(line, { x: margin, y, size: fontSize, font });
        y -= lineHeight;
      }
    }
    if (!font) throw new ConversionError('noPdfText', pages);
    return { bytes: await output.save(), pages, missingGlyphs };
  }

  try {
    return await Promise.race([rebuild(), workerFailure]);
  } catch (error) {
    if (error.code === PasswordResponses.NEED_PASSWORD || error.code === PasswordResponses.INCORRECT_PASSWORD) {
      throw new ConversionError('protectedFile');
    }
    throw error;
  } finally {
    // The worker is dedicated to this conversion, including its PDF.js state.
    worker.destroy();
    port.terminate();
  }
}
