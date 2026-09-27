import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../scripts/build-fluency-production-sql.mjs', import.meta.url));
const fluencyMigrations = [
  '202609030003_fluency_challenge_core.sql',
  '202609030004_fluency_teacher_controls.sql',
  '202609050001_fluency_teacher_create_unit.sql',
  '202609080001_fluency_finish_sentence_grace.sql',
  '202609080002_fluency_resume_progress.sql',
  '202609080003_fluency_resume_evidence.sql',
];

test('production SQL candidate contains only six reviewed Fluency migrations in order', async () => {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath]);
  const sectionNames = [...stdout.matchAll(/^-- BEGIN (\S+\.sql)$/gm)].map((match) => match[1]);
  assert.deepEqual(sectionNames, fluencyMigrations);
  assert.equal((stdout.match(/^begin;$/gmi) || []).length, 1);
  assert.equal((stdout.match(/^commit;$/gmi) || []).length, 1);
  assert.doesNotMatch(stdout, /^-- BEGIN .*self_correction|^-- BEGIN .*shared_student_identity/gm);
  assert.doesNotMatch(stdout, /^create table public\.(students|enrollments)\b/gim);
  assert.match(stdout, /create table public\.fluency_units/i);
  assert.match(stdout, /create or replace function public\.get_fluency_student_task/i);
});

test('production SQL check mode reports pinned digests without SQL', async () => {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, '--check']);
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'reviewed-candidate');
  assert.equal(report.migrationCount, 6);
  assert.deepEqual(report.migrations.map((item) => item.name), fluencyMigrations);
  assert.equal(report.migrations.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)), true);
  assert.doesNotMatch(stdout, /create table/i);
});

test('production SQL freezes task content and uses an unambiguous progress round', async () => {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath]);
  assert.match(stdout, /'title', unit_row\.title/i);
  assert.match(stdout, /'promptText', unit_row\.prompt_text/i);
  assert.match(stdout, /assignment\.assignment_snapshot \? 'promptText'/i);
  assert.match(stdout, /attempt\.round_number = rounds\.round_number/i);
});
