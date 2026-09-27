import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = await mkdtemp(path.join(tmpdir(), 'fluency-vercel-'));

const copies = [
  ['apps/fluency-challenge/index.html', 'index.html'],
  ['apps/fluency-challenge/app.mjs', 'app.mjs'],
  ['apps/fluency-challenge/styles.css', 'styles.css'],
  ['apps/fluency-challenge/lib', 'lib'],
  ['apps/fluency-challenge/lib', 'apps/fluency-challenge/lib'],
  ['apps/self-correction-center/lib/server', 'apps/self-correction-center/lib/server'],
  ['gateway', 'gateway'],
  ['vercel/fluency-api/api', 'api'],
  ['vercel/fluency-api/vercel.json', 'vercel.json'],
  ['package.json', 'package.json'],
  ['package-lock.json', 'package-lock.json'],
];

for (const [source, destination] of copies) {
  const destinationPath = path.join(stageRoot, destination);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copySource(path.join(root, source), destinationPath);
}

// The handler lives three directories below the repository root in source, but
// one directory below the Vercel staging root after packaging.
const handlerPath = path.join(stageRoot, 'api', '[...path].ts');
const handlerSource = await readFile(handlerPath, 'utf8');
await writeFile(handlerPath, handlerSource.replaceAll("'../../../gateway/", "'../gateway/"));

// Vercel transpiles TypeScript but leaves ESM specifiers untouched. The source
// service is bundled by Netlify, where extensionless imports are valid; make
// its staged Node ESM imports explicit for Vercel.
const serviceDirectory = path.join(stageRoot, 'apps', 'self-correction-center', 'lib', 'server');
for (const filename of await readdir(serviceDirectory)) {
  if (!filename.endsWith('.ts')) continue;
  const filePath = path.join(serviceDirectory, filename);
  const source = await readFile(filePath, 'utf8');
  const normalized = source
    .replace(/(from\s+['\"](?:\.{1,2}\/[^'\"]+?))\.ts(['\"])/g, '$1.js$2')
    .replace(/(from\s+['\"](?:\.{1,2}\/[^.'\"]+?))(['\"])/g, '$1.js$2');
  await writeFile(filePath, normalized);
}

process.stdout.write(`${stageRoot}\n`);

async function copySource(source, destination) {
  if (process.platform === 'darwin') {
    execFileSync('cp', ['-cR', source, destination], { stdio: 'inherit' });
  } else {
    await cp(source, destination, { recursive: true });
  }
}
