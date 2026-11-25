import { execFileSync } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { expect, test } from '@playwright/test';

const python = process.env.PYTHON || 'python3';
const marker = 'ALIFBO_LOCAL_ONLY_4923';

test('the static app converts pasted text and local documents and downloads them', async ({ page, context, baseURL }, testInfo) => {
  const fixtures = testInfo.outputPath('inputs');
  const output = testInfo.outputPath('downloads');
  await mkdir(output, { recursive: true });
  execFileSync(python, ['tests/documents.py', 'generate', fixtures], { stdio: 'inherit' });

  const violations = [];
  const requests = [];
  const origin = new URL(baseURL);
  const staticAssets = new Set((await readdir('dist', { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => relative('dist', join(entry.parentPath, entry.name)).split(sep).join('/')));
  staticAssets.add('');
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol === 'blob:') return; // Download from browser memory.
    requests.push(url.pathname);
    const local = url.origin === origin.origin && url.pathname.startsWith(origin.pathname);
    const relative = local ? url.pathname.slice(origin.pathname.length) : '';
    if (!local || !staticAssets.has(relative) || url.search || request.method() !== 'GET' || request.postData()
      || request.url().includes(marker)) {
      violations.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto('./');
  const source = page.locator('#source');
  const result = page.locator('#result');


  await source.fill("SH Sh sH CH Ch cH O' G’ o‘ gʻ Oʼ G` o´ ma’no 😀");
  await expect(result).toHaveValue("Ş Ş ş Ç Ç ç Ö Ğ ö ğ Ö Ğ ö ma’no 😀");
  await page.locator('#direction').selectOption('cyrillic');
  await source.fill('ЎЗБЕКИСТОН. Шаҳар Чироқ Ғузор. Ел ЕЛ кел поезда съезд');
  await expect(result).toHaveValue('ÖZBEKISTON. Şahar Çiroq Ğuzor. Yel YEL kel poyezda sʼyezd');
  await page.locator('#direction').selectOption('reverse');
  await source.fill('ÖZBEKISTON, Ğuzor, Şahar, ŞARQ, ÇIROQ, uç');
  await expect(result).toHaveValue('OʻZBEKISTON, Gʻuzor, Shahar, SHARQ, CHIROQ, uch');

  await page.locator('#fileTab').click();
  const button = page.locator('#choose');
  const link = page.getByRole('link', { name: 'Faylni yuklab oling' });
  async function pick(file) {
    const chooser = page.waitForEvent('filechooser');
    await button.click();
    await (await chooser).setFiles(file);
  }
  async function download(file, expected, target = expected) {
    await pick(join(fixtures, file));
    await expect(page.locator('#status')).toContainText(`${expected} tayyor.`, { timeout: 30_000 });
    const pending = page.waitForEvent('download');
    await link.click();
    const saved = await pending;
    expect(saved.suggestedFilename()).toBe(expected);
    await saved.saveAs(join(output, target));
  }

  await page.locator('#direction').selectOption('latin');
  await download('hisobot.docx', 'hisobot-alifbo.docx');
  await download('jadval.xlsx', 'jadval-alifbo.xlsx');

  await page.locator('#direction').selectOption('cyrillic');
  await download('taqdimot.pptx', 'taqdimot-alifbo.pptx');

  await page.locator('#direction').selectOption('reverse');
  await pick(join(fixtures, 'matn.pdf'));
  await expect(link).toBeHidden();
  await pick({ name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from(marker) });
  await expect(page.locator('#status')).toHaveText('DOCX, XLSX yoki PPTX faylini tanlang.');
  await expect(link).toBeHidden();

  expect(requests.some(path => path.endsWith('.wasm'))).toBe(true);
  expect(requests.some(path => path.includes('file-worker'))).toBe(true);
  expect(violations).toEqual([]);

  execFileSync(python, ['tests/documents.py', 'verify-office', fixtures, output], { stdio: 'inherit' });
});
