import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const expectedRoutes = new Map([
  ['fluency-auth-login.ts', '/api/fluency/auth/login'],
  ['fluency-auth-logout.ts', '/api/fluency/auth/logout'],
  ['fluency-session.ts', '/api/fluency/session'],
  ['fluency-task.ts', '/api/fluency/task'],
  ['fluency-assess-background.ts', '/api/internal/fluency-assess-job'],
  ['fluency-assess.ts', '/api/fluency/assess'],
  ['fluency-internal-student-identity.ts', '/api/internal/student-identity'],
  ['fluency-internal-task.ts', '/api/internal/fluency-task'],
  ['fluency-internal-attempt.ts', '/api/internal/fluency-attempt'],
  ['fluency-internal-runs.ts', '/api/internal/fluency-runs'],
  ['fluency-internal-teacher.ts', '/api/internal/fluency-teacher'],
]);

test('every Fluency function exposes a literal Netlify route', async () => {
  for (const [filename, route] of expectedRoutes) {
    const source = await readFile(new URL(`../netlify/functions/${filename}`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`path:\\s*["']${route.replaceAll('/', '\\/')}["']`), filename);
  }
});

test('the isolated staging bundle has an explicit function allowlist', async () => {
  const source = await readFile(new URL('../scripts/stage-fluency-netlify.mjs', import.meta.url), 'utf8');
  for (const filename of expectedRoutes.keys()) assert.match(source, new RegExp(filename.replace('.', '\\.')));
  assert.doesNotMatch(source, /platform-[*]/);
});

test('the Fluency deploy bundle publishes only student runtime assets', async () => {
  const source = await readFile(new URL('../scripts/stage-fluency-netlify.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\['apps\/fluency-challenge',\s*'apps\/fluency-challenge'\]/);
  for (const runtimeFile of ['index.html', 'app.mjs', 'styles.css', 'lib']) {
    assert.ok(source.includes(`['apps/fluency-challenge/${runtimeFile}', 'apps/fluency-challenge/${runtimeFile}']`));
  }
  assert.doesNotMatch(source, /\['apps\/fluency-challenge\/README\.md'/);
});
