# Alifbo

Alifbo converts Uzbek text from old Latin to new Latin, from Cyrillic to new Latin, and from new Latin to old Latin. The text editor and file converter use the same Rust/WebAssembly rules, ported from the original `index.html`.

Choose a direction and then select **Faylni tanlash**. When conversion finishes, choose **Faylni yuklash** to save a new copy such as `hisobot-alifbo.docx`.

- **DOCX** covers paragraphs, tables, headers, and footers.
- **XLSX** covers literal shared and inline strings, including rich text. Numeric and date cells, formulas and their cached results, and sheet names are preserved.
- **PPTX** covers titles, text boxes, and table cells on slides.
- **PDF** conversion rebuilds each text page at its original size and positions searchable text in its original columns and table cells. It embeds Noto Sans and preserves page artwork as a raster background where possible. The app lists and skips pages without extractable text. If no page has selectable text, the app explains the requirement in Uzbek.

Office conversions edit the original Office Open XML package. When a spelling spans differently formatted runs, the replacement takes the formatting of the first source character. For example, **S**hahar becomes **Ş**ahar. Media and relationship parts are copied from the source archive.

The build is static. A browser Web Worker reads and converts local files, and the browser downloads its result from memory. Requests serve static assets such as WebAssembly, the PDF reader and its font resources. There is no conversion service, upload, account, or server processing cost.

## Build and preview

Install Node.js 22.13+ (Node.js 24 recommended), stable Rust via rustup, and the matching wasm-bindgen CLI.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm ci
npm run build
npm run preview -- --base /uzbek-alifbo/
```

Open `http://localhost:4173/uzbek-alifbo/`. Use `npm run preview` to serve the same `dist/` at the root. Build again after changing the source.

## Test

The native test suite covers all directions, capitalization, apostrophe variants, Cyrillic context, and formatting-run boundaries.

```sh
npm test
```

The browser suite uses Chromium, Python 3.12+, and the Poppler tools `pdftotext`, `pdftoppm`, `pdffonts`, and `pdfinfo` on the path. It generates its own fixtures, tests the picker and downloads, checks the network requests, and reopens each output with an independent reader.

```sh
python3 -m venv /tmp/alifbo-test-env
/tmp/alifbo-test-env/bin/pip install -r tests/requirements.txt
npx playwright install chromium
npm run build
PYTHON=/tmp/alifbo-test-env/bin/python npm run test:browser
BASE_PATH=/ PYTHON=/tmp/alifbo-test-env/bin/python npm run test:browser
```

`CHROMIUM_PATH` can point to an installed Chromium executable. On a fresh Linux CI image, use `npx playwright install --with-deps chromium` to install browser system dependencies too.

## Deploy

All output paths are relative. Deploy the same `dist/` folder on GitHub Pages at `/uzbek-alifbo/` or on Cloudflare Pages at the root.

**GitHub Pages.** In the repository's **Settings → Pages**, choose **GitHub Actions** as the source. The workflow builds and tests the site on pushes to `main` and deploys the static artifact. After the workflow has landed on `main`, this command also runs it manually.

```sh
gh workflow run pages.yml --ref main
```

[GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

**Cloudflare Pages Free.** Build locally and upload the static directory to a Direct Upload project. Create the project once, or use your existing project name.

```sh
npm ci
npm run build
npx wrangler login
npx wrangler pages project create uzbek-alifbo --production-branch main
npx wrangler pages deploy dist --project-name uzbek-alifbo --branch main
```

[Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## First-release limits

- OCR, legacy `.doc`/`.xls`/`.ppt`, and password-protected files are outside the first release. Individual Office XML parts that the app reads are limited to 32 MiB. Large files also depend on available browser memory.
- Converted Office text can reflow when a spelling changes width. Comments, notes, chart labels, and other Office parts outside the supported sections are left as supplied. Editing a digitally signed document can invalidate its signature.
- Rebuilt PDFs use substitute typography. Search and copy order depend on the source text layer. Links, forms, and accessibility tags are outside the PDF conversion scope. The app reports artwork it could not preserve and replaces characters outside the bundled font’s coverage with `�`.
- The app requires a recent browser with WebAssembly and module Web Workers.
