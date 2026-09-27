import { createHmac } from 'node:crypto';

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const supabaseSecretKey = required('SUPABASE_SECRET_KEY');
const sessionSecret = required('SESSION_SECRET');
const schoolYear = process.env.FLUENCY_TEST_SCHOOL_YEAR || '9999';
const classCode = (process.env.FLUENCY_TEST_CLASS_CODE || 'DEMO').toUpperCase();

const accounts = [
  { seatNumber: 1, track: 'S1', activationCode: 'FLUENCY-S1-01' },
  { seatNumber: 2, track: 'S2', activationCode: 'FLUENCY-S2-02' },
  { seatNumber: 3, track: 'S3', activationCode: 'FLUENCY-S3-03' },
  { seatNumber: 4, track: 'S4', activationCode: 'FLUENCY-S4-04' },
];

const students = accounts.map((account) => ({
  id: `00000000-0000-4000-8000-${String(100 + account.seatNumber).padStart(12, '0')}`,
}));

const enrollments = accounts.map((account, index) => ({
  id: `00000000-0000-4000-8000-${String(200 + account.seatNumber).padStart(12, '0')}`,
  student_id: students[index].id,
  school_year: schoolYear,
  class_code: classCode,
  seat_number: account.seatNumber,
  grade_level: 8,
  activation_code_hash: hmac(normalizeActivationCode(account.activationCode)),
  active: true,
}));

await insertIfMissing('students', students);
await insertIfMissing('enrollments', enrollments);

process.stdout.write(`${JSON.stringify({
  schoolYear,
  classCode,
  accounts: accounts.map(({ seatNumber, track, activationCode }) => ({ seatNumber, track, activationCode })),
}, null, 2)}\n`);

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function normalizeActivationCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hmac(value) {
  return createHmac('sha256', sessionSecret).update(value, 'utf8').digest('base64url');
}

async function insertIfMissing(table, rows) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: supabaseSecretKey,
      authorization: `Bearer ${supabaseSecretKey}`,
      'content-type': 'application/json',
      prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    throw new Error(`Could not seed ${table}: HTTP ${response.status}`);
  }
}
