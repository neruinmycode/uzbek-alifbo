import { DOMParser, XMLSerializer, onErrorStopParsing } from '@xmldom/xmldom';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { convertRuns } from './wasm/alifbo.js';
import { ConversionError } from './formats.js';

const xmlNamespace = 'http://www.w3.org/XML/1998/namespace';
const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const contentTypePrefix = 'application/vnd.openxmlformats-officedocument.';
const formats = {
  docx: { main: 'wordprocessingml.document.main+xml', text: ['wordprocessingml.header+xml', 'wordprocessingml.footer+xml'] },
  xlsx: { main: 'spreadsheetml.sheet.main+xml', text: ['spreadsheetml.worksheet+xml', 'spreadsheetml.sharedStrings+xml'] },
  pptx: { main: 'presentationml.presentation.main+xml', text: ['presentationml.slide+xml'] },
};
const namespaces = Object.fromEntries(['wordprocessingml', 'spreadsheetml', 'drawingml'].map(name => [
  name, [
    `http://schemas.openxmlformats.org/${name}/2006/main`,
    `http://purl.oclc.org/ooxml/${name}/main`,
  ],
]));
const wordSeparators = new Set([
  'tab', 'ptab', 'br', 'cr', 'sym', 'noBreakHyphen', 'softHyphen', 'drawing',
  'object', 'pict', 'fldChar', 'instrText', 'footnoteReference', 'endnoteReference',
]);
const zipOptions = { useWebWorkers: false };
const maxXmlBytes = 32 * 1024 * 1024;

const children = node => Array.from(node.childNodes).filter(child => child.nodeType === 1);
const elements = (node, namespaces, name) => namespaces.flatMap(ns =>
  Array.from(node.getElementsByTagNameNS(ns, name)));
const isElement = (node, ns, name) => node?.namespaceURI === ns && node.localName === name;
const child = (node, ns, name) => children(node).find(element => isElement(element, ns, name));

function parseXml(xml) {
  const doc = new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, 'application/xml');
  if (doc.doctype) throw new ConversionError('invalidFile');
  return doc;
}

async function readXml(entry) {
  if (entry.uncompressedSize > maxXmlBytes) throw new ConversionError('largeFile');
  const bytes = await entry.getData(new Uint8ArrayWriter(), { checkCrc32: true });
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0) {
    encoding = 'utf-16le';
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c) {
    encoding = 'utf-16be';
  }
  return parseXml(new TextDecoder(encoding, { fatal: true }).decode(bytes));
}

function writeXml(doc) {
  const xml = new XMLSerializer().serializeToString(doc);
  return new TextEncoder().encode(xml.replace(/^(<\?xml\s[^?]*?\bencoding\s*=\s*)(["'])[^"']+\2/,
    '$1"UTF-8"'));
}

// Spreadsheet strings use OOXML's _xHHHH_ notation for escaped UTF-16 code units.
const excelEscapes = /_x([0-9a-fA-F]{4})_/g;
function decodeExcel(text) {
  return text.replace(excelEscapes, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}
function encodeExcel(text) {
  return text.replace(excelEscapes, match => '_x005F_' + match.slice(1))
    .replace(/[\x00-\x08\x0b\x0c\x0d\x0e-\x1f\ufffe\uffff]/g,
      ch => `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);
}

function convertTextNodes(nodes, mode, spreadsheet = false) {
  if (!nodes.length) return false;
  const runs = nodes.map(node => spreadsheet ? decodeExcel(node.textContent) : node.textContent);
  const converted = convertRuns(runs, mode);
  let changed = false;
  for (const [index, node] of nodes.entries()) {
    const value = converted[index];
    if (value === runs[index]) continue;
    node.textContent = spreadsheet ? encodeExcel(value) : value;
    if (/^[\t\n\r ]|[\t\n\r ]$/.test(value)) {
      node.setAttributeNS(xmlNamespace, 'xml:space', 'preserve');
    }
    changed = true;
  }
  return changed;
}

function convertParagraphs(doc, mode, kind) {
  let changed = false;
  for (const paragraph of elements(doc, namespaces[kind], 'p')) {
    const ns = paragraph.namespaceURI;
    let nodes = [];
    function flush() {
      if (convertTextNodes(nodes, mode)) changed = true;
      nodes = [];
    }

    if (kind === 'wordprocessingml') {
      function visit(element) {
        if (element.namespaceURI === ns) {
          if (element.localName === 't') {
            nodes.push(element);
            return;
          }
          if (element.localName === 'del' || element.localName === 'moveFrom') return;
          if (element.localName === 'p' || wordSeparators.has(element.localName)) {
            flush();
            return;
          }
        }
        for (const nested of children(element)) visit(nested);
      }
      for (const element of children(paragraph)) visit(element);
    } else {
      for (const run of children(paragraph)) {
        if (isElement(run, ns, 'r')) {
          const text = child(run, ns, 't');
          if (text) nodes.push(text);
        } else if (isElement(run, ns, 'br') || isElement(run, ns, 'fld')) {
          flush();
        }
      }
    }
    flush();
  }
  return changed;
}

function convertExcelString(container, mode) {
  const ns = container.namespaceURI;
  const nodes = children(container).map(element =>
    isElement(element, ns, 'r') ? child(element, ns, 't') : element)
    .filter(element => isElement(element, ns, 't'));
  return convertTextNodes(nodes, mode, true);
}

function sharedIndex(cell) {
  const value = child(cell, cell.namespaceURI, 'v');
  return value && /^\s*\d+\s*$/.test(value.textContent) ? Number(value.textContent) : undefined;
}

async function convertSpreadsheet(parts, mode, changes) {
  const sharedPart = parts.find(part => part.type === 'spreadsheetml.sharedStrings+xml');
  const sheets = parts.filter(part => part.type === 'spreadsheetml.worksheet+xml');
  const protectedIndices = new Set();
  const literalIndices = new Set();

  for (const part of sheets) {
    const doc = await readXml(part.entry);
    let changed = false;
    for (const cell of elements(doc, namespaces.spreadsheetml, 'c')) {
      const ns = cell.namespaceURI;
      const type = cell.getAttribute('t');
      if (type !== 's' && type !== 'inlineStr' && type !== 'str') continue;
      const formula = child(cell, ns, 'f');
      if (type === 's') {
        const index = sharedIndex(cell);
        if (index !== undefined) (formula ? protectedIndices : literalIndices).add(index);
      } else if (!formula) {
        const value = child(cell, ns, type === 'inlineStr' ? 'is' : 'v');
        if (!value) continue;
        if (type === 'inlineStr' ? convertExcelString(value, mode) : convertTextNodes([value], mode, true)) {
          changed = true;
        }
      }
    }
    if (changed) changes.set(part.entry.filename, writeXml(doc));
  }
  if (!sharedPart) return;

  const doc = await readXml(sharedPart.entry);
  const table = doc.documentElement;
  const ns = table.namespaceURI;
  const items = children(table).filter(item => isElement(item, ns, 'si'));
  const remap = new Map();
  let changed = false;
  let count = items.length;

  for (const [index, item] of items.entries()) {
    if (!literalIndices.has(index)) continue;
    const preserve = protectedIndices.has(index);
    const target = preserve ? item.cloneNode(true) : item;
    if (!convertExcelString(target, mode)) continue;
    changed = true;
    if (preserve) {
      table.insertBefore(target, child(table, ns, 'extLst') ?? null);
      remap.set(index, count++);
    }
  }
  if (!changed) return;
  if (remap.size && table.hasAttribute('uniqueCount')) table.setAttribute('uniqueCount', String(count));
  changes.set(sharedPart.entry.filename, writeXml(doc));

  if (remap.size) {
    for (const part of sheets) {
      const previous = changes.get(part.entry.filename);
      const doc = previous
        ? parseXml(new TextDecoder().decode(previous))
        : await readXml(part.entry);
      let changed = false;
      for (const cell of elements(doc, namespaces.spreadsheetml, 'c')) {
        if (cell.getAttribute('t') !== 's' || child(cell, cell.namespaceURI, 'f')) continue;
        const index = remap.get(sharedIndex(cell));
        if (index === undefined) continue;
        child(cell, cell.namespaceURI, 'v').textContent = String(index);
        changed = true;
      }
      if (changed) changes.set(part.entry.filename, writeXml(doc));
    }
  }
}

export async function convertOffice(bytes, format, mode) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), zipOptions);
  try {
    const entries = await reader.getEntries();
    if (entries.some(entry => entry.encrypted)) throw new ConversionError('protectedFile');
    const files = new Map(entries.filter(entry => !entry.directory).map(entry => [entry.filename, entry]));
    if (files.size !== entries.filter(entry => !entry.directory).length || !files.has('[Content_Types].xml')) {
      throw new ConversionError('invalidFile');
    }

    const manifest = await readXml(files.get('[Content_Types].xml'));
    const parts = elements(manifest, [contentTypesNamespace], 'Override').map(part => ({
      type: part.getAttribute('ContentType').replace(contentTypePrefix, ''),
      entry: files.get(part.getAttribute('PartName').slice(1)),
    })).filter(part => part.entry);
    const { main, text } = formats[format];
    if (!parts.some(part => part.type === main)) throw new ConversionError('invalidFile');

    const changes = new Map();
    if (format === 'xlsx') {
      await convertSpreadsheet(parts.filter(part => text.includes(part.type)), mode, changes);
    } else {
      const kind = format === 'docx' ? 'wordprocessingml' : 'drawingml';
      for (const { type, entry } of parts) {
        if (!text.includes(type) && !(format === 'docx' && type === main)) continue;
        const doc = await readXml(entry);
        if (convertParagraphs(doc, mode, kind)) changes.set(entry.filename, writeXml(doc));
      }
    }

    if (!changes.size) return bytes;
    const writer = new ZipWriter(new Uint8ArrayWriter(), zipOptions);
    await writer.appendZip(new Uint8ArrayReader(bytes), {
      filter: entry => !changes.has(entry.filename),
    });
    for (const [filename, content] of changes) {
      await writer.add(filename, new Uint8ArrayReader(content), { lastModDate: files.get(filename).lastModDate });
    }
    return await writer.close(reader.comment);
  } finally {
    await reader.close();
  }
}
