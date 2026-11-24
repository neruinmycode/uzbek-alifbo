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
  await expect(page.locator('#status')).toHaveText('Tayyor');

  await source.fill("SH Sh sH CH Ch cH O' G’ o‘ gʻ Oʼ G` o´ ma’no 😀");
  await expect(result).toHaveValue("Ş Ş ş Ç Ç ç Ö Ğ ö ğ Ö Ğ ö ma’no 😀");
  await page.getByRole('tab', { name: 'Kirill → Yangi' }).click();
  await source.fill('ЎЗБЕКИСТОН. Шаҳар Чироқ Ғузор. Ел ЕЛ кел поезда съезд');
  await expect(result).toHaveValue('ÖZBEKISTON. Şahar Çiroq Ğuzor. Yel YEL kel poyezda sʼyezd');
  await page.getByRole('tab', { name: 'Yangi → Eski lotin' }).click();
  await source.fill('ÖZBEKISTON, Ğuzor, Şahar, ŞARQ, ÇIROQ, uç');
  await expect(result).toHaveValue('OʻZBEKISTON, Gʻuzor, Shahar, SHARQ, CHIROQ, uch');

  const button = page.getByText('Faylni tanlash', { exact: true });
  const link = page.getByRole('link', { name: 'Faylni yuklash' });
  async function pick(file) {
    const chooser = page.waitForEvent('filechooser');
    await button.click();
    await (await chooser).setFiles(file);
  }
  async function download(file, expected, target = expected) {
    await pick(join(fixtures, file));
    await expect(page.locator('#file-status')).toContainText(`${expected} tayyor.`, { timeout: 30_000 });
    const pending = page.waitForEvent('download');
    await link.click();
    const saved = await pending;
    expect(saved.suggestedFilename()).toBe(expected);
    await saved.saveAs(join(output, target));
  }

  await page.getByRole('tab', { name: 'Eski lotin → Yangi' }).click();
  await download('hisobot.docx', 'hisobot-alifbo.docx');
  await download('jadval.xlsx', 'jadval-alifbo.xlsx');

  await page.getByRole('tab', { name: 'Kirill → Yangi' }).click();
  await download('taqdimot.pptx', 'taqdimot-alifbo.pptx');

  await page.getByRole('tab', { name: 'Yangi → Eski lotin' }).click();
  await download('matn.pdf', 'matn-alifbo.pdf');
  await expect(page.locator('#file-status')).toContainText('Matn topilmagan PDF sahifalari: 2.');

  await page.getByRole('tab', { name: 'Eski lotin → Yangi' }).click();
  await download('matn.pdf', 'matn-alifbo.pdf', 'matn-forward.pdf');
  await download('jadval.pdf', 'jadval-alifbo.pdf');

  await pick(join(fixtures, 'scan.pdf'));
  await expect(page.locator('#file-status')).toContainText('O‘girish uchun tanlanadigan matn kerak.');
  await expect(page.locator('#file-status')).toContainText('Matn topilmagan PDF sahifalari: 1.');
  await expect(link).toBeHidden();

  await pick({ name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from(marker) });
  await expect(page.locator('#file-status')).toHaveText('DOCX, XLSX, PPTX yoki PDF faylini tanlang.');
  await expect(link).toBeHidden();

  expect(requests.some(path => path.endsWith('.wasm'))).toBe(true);
  expect(requests.some(path => path.includes('file-worker'))).toBe(true);
  expect(requests.some(path => path.includes('pdf.worker'))).toBe(true);
  expect(requests.some(path => path.endsWith('NotoSans-Regular.ttf'))).toBe(true);
  expect(violations).toEqual([]);

  execFileSync(python, ['tests/documents.py', 'verify', fixtures, output,
    join(output, 'matn-forward.pdf')], { stdio: 'inherit' });
});
