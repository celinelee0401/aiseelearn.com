import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Deliberately excludes the already-present shared identity and self-correction
// migrations. Review the live schema before using this candidate in SQL Editor.
const reviewedMigrations = [
  ['202609030003_fluency_challenge_core.sql', '44b1c917baae230b3f2ef4de8331487e7e5ef2882a3c1af59613e404b2139088'],
  ['202609030004_fluency_teacher_controls.sql', 'd3a7df450881a40c8e02822e13467d6ea5d74d950f9c52b9ff65650d0a75ad00'],
  ['202609050001_fluency_teacher_create_unit.sql', '3d326bb71339c14c006b0835abe72a607e08036e065987225877c344eb6a2ba0'],
  ['202609080001_fluency_finish_sentence_grace.sql', '4aca728901853be4c87b5b3da22ac4af1d111c97b387769ad28363617d5dc460'],
  ['202609080002_fluency_resume_progress.sql', '460542463812dc277b67d9130b18521f3ae5fc4d97cd7a1a4eaafc5f091bb949'],
  ['202609080003_fluency_resume_evidence.sql', 'afcfb64f1d07ee5c60b0a7a23b742c0ca686e4a9476e8f9c0c2cd04dd898a0e0'],
];

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check') || args.length > 1) {
  throw new Error('Usage: node scripts/build-fluency-production-sql.mjs [--check]');
}

const migrationsDirectory = new URL(
  '../apps/self-correction-center/supabase/migrations/',
  import.meta.url,
);

const migrations = await Promise.all(reviewedMigrations.map(async ([name, expectedSha256]) => {
  const source = await readFile(new URL(name, migrationsDirectory), 'utf8');
  const sha256 = createHash('sha256').update(source).digest('hex');
  if (sha256 !== expectedSha256) {
    throw new Error(`${name} changed since review; stop and inspect before regenerating the bundle`);
  }
  if (/\b(?:create|alter|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?public\.(?:students|enrollments)\b/i.test(source)) {
    throw new Error(`${name} modifies a shared identity table; stop and inspect`);
  }
  return { name, source: source.trim(), sha256 };
}));

if (args.includes('--check')) {
  process.stdout.write(`${JSON.stringify({
    status: 'reviewed-candidate',
    migrationCount: migrations.length,
    migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })),
  }, null, 2)}\n`);
} else {
  const sections = migrations.map(({ name, source, sha256 }) => [
    `-- BEGIN ${name}`,
    `-- SHA256 ${sha256}`,
    source,
    `-- END ${name}`,
  ].join('\n'));
  process.stdout.write([
    '-- REVIEW CANDIDATE ONLY: Fluency migrations for the shared production database.',
    '-- Requires a separate live-schema preflight, backup/rollback plan, and explicit deployment approval.',
    '-- Do not run the self-correction or shared-identity core migrations again.',
    'begin;',
    ...sections,
    'commit;',
    '',
  ].join('\n\n'));
}
