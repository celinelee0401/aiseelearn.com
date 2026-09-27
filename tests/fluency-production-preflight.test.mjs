import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sqlUrl = new URL('../operations/fluency-production-readonly-preflight.sql', import.meta.url);

test('production preflight inspects metadata without reading student rows or changing data', async () => {
  const source = await readFile(sqlUrl, 'utf8');
  const withoutComments = source.replace(/^--.*$/gm, '').trim();
  const statements = withoutComments.split(';').map((item) => item.trim()).filter(Boolean);
  assert.equal(statements.length, 8);
  assert.equal(statements.every((statement) => /^select\b/i.test(statement)), true);
  assert.doesNotMatch(withoutComments, /\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke|execute|call)\b/i);
  assert.doesNotMatch(withoutComments, /\bfrom\s+public\.(?:students|enrollments)\b/i);
});
