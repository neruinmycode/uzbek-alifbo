import init from './wasm/alifbo.js';
import { ConversionError } from './formats.js';

self.addEventListener('message', async ({ data: { file, format, mode } }) => {
  try {
    await init();
    const input = new Uint8Array(await file.arrayBuffer());
    const result = format === 'pdf'
      ? await (await import('./pdf.js')).convertPdf(input, mode)
      : { bytes: await (await import('./office.js')).convertOffice(input, format, mode) };
    self.postMessage(result, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage(error instanceof ConversionError
      ? { error: error.code, pages: error.pages }
      : { error: 'invalidFile', pages: [] });
  }
});
