import fontkit from '@pdf-lib/fontkit';
import {
  PDFDocument, TextRenderingMode, beginText, endText, popGraphicsState, pushGraphicsState,
  setFontAndSize, setLineWidth, setTextMatrix, setTextRenderingMode, showText,
} from 'pdf-lib';
import { AnnotationMode, getDocument, OPS, PasswordResponses, PDFWorker } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { convertRuns } from './wasm/alifbo.js';
import { ConversionError } from './formats.js';
import { textLines } from './pdf-layout.js';

const textOperators = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
const artworkOperators = new Set(Object.entries(OPS)
  .filter(([name]) => name.startsWith('paint') || /stroke|fill/i.test(name) && !name.startsWith('set'))
  .map(([, op]) => op));
const maxBackgroundPixels = 4_000_000;

class WorkerCanvasFactory {
  create(width, height) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  getNoAlphaContext(canvas) {
    return canvas.getContext('2d', { alpha: false });
  }
  reset(target, width, height) {
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target) {
    this.reset(target, 0, 0);
    target.canvas = null;
    target.context = null;
  }
}

function subsetFontName() {
  const tag = Array.from(crypto.getRandomValues(new Uint8Array(6)),
    byte => String.fromCharCode(65 + byte % 26)).join('');
  return `${tag}+NotoSans-Regular`;
}

function sourceFontStyles(source, styles) {
  return new Map(Object.keys(styles).map(key => {
    const name = source.commonObjs.has(key) ? source.commonObjs.get(key)?.name ?? '' : '';
    return [key, { bold: /bold|demi|heavy|black/i.test(name), italic: /italic|oblique/i.test(name) }];
  }));
}

function hasArtwork({ fnArray, argsArray }) {
  return fnArray.some((op, i) => artworkOperators.has(op)
    || op === OPS.constructPath && artworkOperators.has(argsArray[i][0]));
}

function hasInvisibleText({ fnArray, argsArray }) {
  let mode = 0;
  const states = [];
  for (const [i, op] of fnArray.entries()) {
    if (op === OPS.save) states.push(mode);
    if (op === OPS.restore) mode = states.pop() ?? 0;
    if (op === OPS.setTextRenderingMode) mode = argsArray[i][0];
    // An invisible text layer can already be printed in the background image.
    if ((mode & 3) === 3 && textOperators.has(op)) return true;
  }
  return false;
}

async function drawArtwork(source, viewport, output, page, operators) {
  if (!hasArtwork(operators)) return true;
  if (typeof OffscreenCanvas === 'undefined' || hasInvisibleText(operators)) return false;

  const scale = Math.min(2, Math.sqrt(maxBackgroundPixels / (viewport.width * viewport.height)));
  const renderViewport = source.getViewport({ scale });
  let canvas;
  try {
    canvas = new OffscreenCanvas(Math.ceil(renderViewport.width), Math.ceil(renderViewport.height));
    await source.render({
      canvas, viewport: renderViewport, intent: 'print', annotationMode: AnnotationMode.DISABLE,
      operationsFilter: (index, list) => !textOperators.has(list.fnArray[index]),
    }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const background = await output.embedPng(await blob.arrayBuffer());
    page.drawImage(background, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    return true;
  } catch {
    return false;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
  }
}

function drawText(page, font, fontKey, run, text, style) {
  if (!text) return;
  const { alongX, alongY, size, x, y, width } = run;
  const measured = font.widthOfTextAtSize(text, size);
  const scale = width && measured > 0 ? width / measured : 1;
  const slant = style?.italic ? 0.19 : 0;

  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFontAndSize(fontKey, size),
    setTextRenderingMode(style?.bold ? TextRenderingMode.FillAndOutline : TextRenderingMode.Fill),
    setLineWidth(size * 0.022),
    setTextMatrix(alongX * scale, alongY * scale,
      -alongY + slant * alongX, alongX + slant * alongY, x, y),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState(),
  );
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
    fontExtraProperties: true,
    useWasm: false,
    CanvasFactory: WorkerCanvasFactory,
  });
  const workerFailure = new Promise((_, reject) =>
    port.addEventListener('error', () => reject(new ConversionError('worker')), { once: true }));
  const pages = [];
  const missingArtwork = [];
  let missingGlyphs = false;

  async function rebuild() {
    const input = await loading.promise;
    const output = await PDFDocument.create();
    output.registerFontkit(fontkit);
    let font;
    let supported;

    function supportedText(text) {
      return Array.from(text.trim(), ch => {
        if (supported.has(ch.codePointAt(0))) return ch;
        missingGlyphs = true;
        return '�';
      }).join('');
    }

    for (let number = 1; number <= input.numPages; number++) {
      const source = await input.getPage(number);
      try {
        const { items, styles } = await source.getTextContent();
        const viewport = source.getViewport({ scale: 1, dontFlip: true });
        const lines = [...textLines(items, viewport, source.userUnit)];
        if (!lines.length) {
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

        const page = output.addPage([viewport.width, viewport.height]);
        let styleByFont;
        try {
          const ops = await source.getOperatorList({ intent: 'print', annotationMode: AnnotationMode.DISABLE });
          styleByFont = sourceFontStyles(source, styles);
          if (!await drawArtwork(source, viewport, output, page, ops)) missingArtwork.push(number);
        } catch {
          missingArtwork.push(number);
        }

        const fontKey = page.node.newFontDictionary(font.name, font.ref);
        for (const runs of lines) {
          const converted = convertRuns(runs.map(run => run.text), mode);
          for (const [i, run] of runs.entries()) {
            drawText(page, font, fontKey, run, supportedText(converted[i]), styleByFont?.get(run.fontName));
          }
        }
      } finally {
        source.cleanup();
      }
    }

    if (!font) throw new ConversionError('noPdfText', pages);
    return { bytes: await output.save(), pages, missingGlyphs, missingArtwork };
  }

  try {
    return await Promise.race([rebuild(), workerFailure]);
  } catch (error) {
    if (error.code === PasswordResponses.NEED_PASSWORD || error.code === PasswordResponses.INCORRECT_PASSWORD) {
      throw new ConversionError('protectedFile');
    }
    throw error;
  } finally {
    worker.destroy();
    port.terminate();
  }
}
