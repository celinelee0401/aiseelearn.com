import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../apps/self-correction-center/supabase/migrations/202609030003_fluency_challenge_core.sql", import.meta.url);
const graceMigrationUrl = new URL("../apps/self-correction-center/supabase/migrations/202609080001_fluency_finish_sentence_grace.sql", import.meta.url);

test("attempt persistence is idempotent, assignment-bound, and service-role only", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /request_id text not null unique/i);
  assert.match(sql, /create or replace function public\.record_fluency_attempt/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /assignment\.student_id = p_student_id/i);
  assert.match(sql, /assignment\.enrollment_id = p_enrollment_id/i);
  assert.match(sql, /and run\.status = 'open'/i);
  assert.match(sql, /time_limit_value \* 1000 \+ 2500/i);
  assert.match(sql, /where request_id = p_request_id/i);
  assert.match(sql, /where assignment_id = p_assignment_id and round_number = p_round_number/i);
  assert.match(sql, /revoke all on function public\.record_fluency_attempt[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.record_fluency_attempt[\s\S]*to service_role/i);
});

test("the versioned migration accepts the bounded finish-sentence capture tolerance", async () => {
  const sql = await readFile(graceMigrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.record_fluency_attempt/i);
  assert.match(sql, /time_limit_value \* 1000 \+ 4000/i);
  assert.match(sql, /and run\.status = 'open'/i);
  assert.match(sql, /where assignment_id = p_assignment_id and round_number = p_round_number/i);
  assert.match(sql, /revoke all on function public\.record_fluency_attempt[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.record_fluency_attempt[\s\S]*to service_role/i);
});
