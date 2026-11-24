import { spawnSync } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { build } from 'vite';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown']);
run('wasm-bindgen', ['--target', 'web', '--out-dir', 'src/wasm',
  '--no-typescript', 'target/wasm32-unknown-unknown/release/alifbo.wasm']);
await build();

for (const directory of ['cmaps', 'standard_fonts', 'iccs']) {
  await cp(`node_modules/pdfjs-dist/${directory}`, `dist/pdf-assets/${directory}`, { recursive: true });
}
await cp('node_modules/pdfjs-dist/LICENSE', 'dist/pdf-assets/LICENSE');
