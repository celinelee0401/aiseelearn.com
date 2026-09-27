import { cp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = await mkdtemp(path.join(tmpdir(), 'fluency-netlify-'));

const copies = [
  // Only publish runtime assets. The source folder also contains a DEMO PIN
  // reference image and internal notes that must not become public site files.
  ['apps/fluency-challenge/index.html', 'apps/fluency-challenge/index.html'],
  ['apps/fluency-challenge/app.mjs', 'apps/fluency-challenge/app.mjs'],
  ['apps/fluency-challenge/styles.css', 'apps/fluency-challenge/styles.css'],
  ['apps/fluency-challenge/lib', 'apps/fluency-challenge/lib'],
  ['apps/self-correction-center/lib/server', 'apps/self-correction-center/lib/server'],
  ['gateway/student-identity-netlify-adapter.mjs', 'gateway/student-identity-netlify-adapter.mjs'],
  ['gateway/fluency-task-adapter.mjs', 'gateway/fluency-task-adapter.mjs'],
  ['gateway/fluency-assessment-adapter.mjs', 'gateway/fluency-assessment-adapter.mjs'],
  ['gateway/azure-pronunciation-assessor.mjs', 'gateway/azure-pronunciation-assessor.mjs'],
  ['gateway/azure-continuous-pronunciation-assessor.mjs', 'gateway/azure-continuous-pronunciation-assessor.mjs'],
  ['gateway/azure-fast-transcriber.mjs', 'gateway/azure-fast-transcriber.mjs'],
  ['gateway/signed-request.mjs', 'gateway/signed-request.mjs'],
  ['gateway/fluency-internal-netlify-adapter.ts', 'gateway/fluency-internal-netlify-adapter.ts'],
];

const functions = [
  'fluency-auth-login.ts',
  'fluency-auth-logout.ts',
  'fluency-session.ts',
  'fluency-task.ts',
  'fluency-assess.ts',
  'fluency-internal-student-identity.ts',
  'fluency-internal-task.ts',
  'fluency-internal-attempt.ts',
  'fluency-internal-runs.ts',
  'fluency-internal-teacher.ts',
];

await mkdir(path.join(stageRoot, 'netlify/functions'), { recursive: true });

for (const [source, destination] of copies) {
  const destinationPath = path.join(stageRoot, destination);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copySource(path.join(root, source), destinationPath);
}

for (const filename of functions) {
  await copySource(
    path.join(root, 'netlify/functions', filename),
    path.join(stageRoot, 'netlify/functions', filename),
  );
}

await copySource(path.join(root, 'package.json'), path.join(stageRoot, 'package.json'));
await copySource(path.join(root, 'package-lock.json'), path.join(stageRoot, 'package-lock.json'));
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: stageRoot,
  stdio: ['ignore', 'ignore', 'inherit']
});

process.stdout.write(`${stageRoot}\n`);

async function copySource(source, destination) {
  // APFS cloning keeps OneDrive-hosted sources from stalling on byte-for-byte copies.
  if (process.platform === 'darwin') {
    execFileSync('cp', ['-cR', source, destination], { stdio: 'inherit' });
  } else {
    await cp(source, destination, { recursive: true });
  }
}
