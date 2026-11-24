import { Util } from 'pdfjs-dist';

// Keep a gap between columns or table cells separate from ordinary word spacing.
// PDF.js may emit the same single-space item for either kind of gap.
export function* textLines(items, viewport, userUnit) {
  let runs = [];
  let previous;
  let space = false;

  for (const item of items) {
    if (!('str' in item)) continue;
    if (!item.str.trim()) {
      if (item.hasEOL) {
        if (runs.length) yield runs;
        runs = [];
        previous = undefined;
        space = false;
      } else if (item.str) {
        space = true;
      }
      continue;
    }

    const [a, b, c, d, x, y] = Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    const advance = Math.hypot(a, b);
    if (!size || !advance) continue;
    const alongX = a / advance;
    const alongY = b / advance;
    const width = Math.abs(item.width * userUnit);
    const run = { text: item.str, fontName: item.fontName, size, alongX, alongY, x, y, width };
    let gap = 0;
    if (previous) {
      const dx = x - previous.x;
      const dy = y - previous.y;
      const offset = dx * previous.alongX + dy * previous.alongY;
      const baselineDifference = dy * previous.alongX - dx * previous.alongY;
      const angleDifference = Math.hypot(alongX - previous.alongX, alongY - previous.alongY);
      gap = offset - previous.width;
      if (Math.abs(baselineDifference) > Math.max(0.8, size * 0.1) || angleDifference > 0.02
        || offset < -1 || gap > Math.max(size, previous.size) * 0.95) {
        yield runs;
        runs = [];
        previous = undefined;
      }
    }

    if (previous) {
      const current = runs.at(-1);
      const separator = (space || gap > size * 0.2) && !/\s$/u.test(current.text) && !/^\s/u.test(run.text)
        ? ' ' : '';
      if (current.fontName === run.fontName && Math.abs(current.size - size) < 0.1) {
        current.text += separator + run.text;
        current.width = Math.max(current.width, (x - current.x) * current.alongX
          + (y - current.y) * current.alongY + width);
      } else {
        current.text += separator;
        runs.push({ ...run });
      }
    } else {
      runs.push({ ...run });
    }
    previous = run;
    space = false;

    if (item.hasEOL) {
      yield runs;
      runs = [];
      previous = undefined;
    }
  }

  if (runs.length) yield runs;
}
