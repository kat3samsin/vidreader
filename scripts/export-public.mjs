import { copyFile, lstat, mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
// Explicit files prevent caches, credentials, logs and local tools entering a release.
const files = [
  '.gitignore', '.nvmrc', 'README.md', 'SECURITY.md',
  'package.json', 'requirements.in', 'requirements.txt',
  'server.mjs', 'request-security.mjs', 'static-files.mjs',
  'focus-cleanup.mjs', 'vtt.mjs', 'app.js', 'preferences-init.js',
  'index.html', 'reader.css', 'tokens.css',
  'test/focus-cleanup.test.mjs',
  'test/server-static.test.mjs', 'test/youtube-transcript.test.mjs', 'test/vtt.test.mjs',
  'test/frontend-security.test.mjs', 'test/server-security.test.mjs',
  'scripts/export-public.mjs',
];
const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
const output = await mkdtemp(join(dist, 'vidreader-public-'));
for (const file of files) {
  if (!(await lstat(join(root, file))).isFile()) throw new Error(`Expected a regular source file: ${file}`);
  await mkdir(dirname(join(output, file)), { recursive: true });
  await copyFile(join(root, file), join(output, file));
}
const archive = `${output}.tar.gz`;
execFileSync('tar', ['-czf', archive, '-C', output, ...files], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
console.log(JSON.stringify({ directory: output, archive, files: files.length }, null, 2));
