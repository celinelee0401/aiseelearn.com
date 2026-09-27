import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/verify-fluency-staging-e2e.mjs', import.meta.url);

test('staging E2E verifier covers four synthetic tracks and rejects invented scores', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  assert.match(script, /fluency-challenge-staging\.netlify\.app/);
  assert.doesNotMatch(script, /https:\/\/fluency-challenge\.netlify\.app/);
  assert.match(script, /schoolYear = process\.env\.FLUENCY_TEST_SCHOOL_YEAR \|\| '9999'/);
  assert.match(script, /classCode = \(process\.env\.FLUENCY_TEST_CLASS_CODE \|\| 'DEMO'\)/);
  for (const track of ['S1', 'S2', 'S3', 'S4']) assert.match(script, new RegExp(`track: '${track}'`));
  assert.match(script, /provider\?\.name !== 'staging-flow-check'/);
  assert.match(script, /metrics\?\.pace\?\.wpm !== null/);
  assert.match(script, /round\.pronunciationAccuracy, null/);
  assert.match(script, /round\.prosody, null/);
  assert.match(script, /FLUENCY_RUN_HMAC_SECRET_CURRENT/);
  assert.doesNotMatch(script, /FLUENCY_RUN_HMAC_SECRET_CURRENT\s*=\s*['"][^'"]+['"]/);
});
