import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../apps/self-correction-center/supabase/migrations/202609030004_fluency_teacher_controls.sql", import.meta.url);
const createUnitMigrationUrl = new URL("../apps/self-correction-center/supabase/migrations/202609050001_fluency_teacher_create_unit.sql", import.meta.url);
const coreMigrationUrl = new URL("../apps/self-correction-center/supabase/migrations/202609030003_fluency_challenge_core.sql", import.meta.url);
const serverUrl = new URL("../apps/self-correction-center/lib/server/fluency-teacher.ts", import.meta.url);
const routeUrl = new URL("../apps/self-correction-center/app/api/internal/fluency-teacher/route.ts", import.meta.url);
const panelUrl = new URL("../gas/seat-planner-api/SeatPlannerFluencyPanel.html", import.meta.url);

test("teacher timing settings preserve global defaults and validate four decreasing tracks", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.get_fluency_unit_settings/i);
  assert.match(sql, /create or replace function public\.save_fluency_unit_settings/i);
  assert.match(sql, /jsonb_array_length\(p_rules\) <> 4/i);
  assert.match(sql, /track_value not in \('S1', 'S2', 'S3', 'S4'\)/i);
  assert.match(sql, /round_1_value <= round_2_value/i);
  assert.match(sql, /round_2_value <= round_3_value/i);
  assert.match(sql, /Validate the complete four-track payload before changing any rule\.[\s\S]*if use_default_value then\s+delete from public\.fluency_unit_track_rules/i);
  assert.match(sql, /config_version = gen_random_uuid\(\)::text/i);
});

test("a new valid unit loads as a draft and is created only on explicit save", async () => {
  const [sql, server, panel] = await Promise.all([
    readFile(createUnitMigrationUrl, "utf8"),
    readFile(serverUrl, "utf8"),
    readFile(panelUrl, "utf8")
  ]);
  assert.match(sql, /'isNew', is_new_value/i);
  assert.match(sql, /case when is_new_value then 'draft'/i);
  assert.match(sql, /insert into public\.fluency_units[\s\S]*on conflict \(id\) do nothing/i);
  assert.doesNotMatch(sql, /'outcome', 'not-found'/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(server, /isNew: boolean/);
  assert.match(server, /typeof candidate\.isNew !== 'boolean'/);
  assert.match(panel, /尚未建立，已帶入預設四軌時間/);
  assert.match(panel, /value\.isNew \|\| value\.configVersion === "draft"/);
  assert.match(panel, /建立並儲存單元/);
  assert.match(panel, /dirty \|\| settings\.isNew/);
});

test("a class and unit can have only one open snapshot at a time", async () => {
  const sql = await readFile(coreMigrationUrl, "utf8");
  assert.match(sql, /create unique index uq_fluency_runs_one_open_per_class_unit[\s\S]*where status = 'open'/i);
  assert.match(sql, /where school_year = p_school_year[\s\S]*class_code = p_class_code[\s\S]*unit_id = p_unit_id[\s\S]*status = 'open'/i);
  assert.match(sql, /'created', false/i);
  assert.match(sql, /'created', true/i);
});

test("teacher mutations are idempotent and RPC access remains service-role only", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table public\.fluency_teacher_requests/i);
  assert.match(sql, /request_id text primary key/i);
  assert.match(sql, /where request_id = p_request_id/i);
  assert.match(sql, /return saved_request\.response_json/i);
  assert.match(sql, /security definer/g);
  assert.match(sql, /revoke all on function public\.save_fluency_unit_settings[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.save_fluency_unit_settings[\s\S]*to service_role/i);
  assert.match(sql, /revoke all on function public\.get_fluency_run_progress[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /create or replace function public\.close_fluency_run/i);
  assert.match(sql, /set status = 'closed', closed_at = closed_at_value/i);
  assert.match(sql, /revoke all on function public\.close_fluency_run[\s\S]*from public, anon, authenticated/i);
});

test("seat progress emits only round evidence and never student identity, track, transcript, or audio", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const progressFunction = sql.slice(sql.indexOf("create or replace function public.get_fluency_run_progress"));
  assert.match(progressFunction, /'seatNumber', enrollment\.seat_number/i);
  assert.match(progressFunction, /'wpm'/i);
  assert.match(progressFunction, /'pauseFlow'/i);
  assert.match(progressFunction, /'pronunciationAccuracy'/i);
  assert.match(progressFunction, /'prosody'/i);
  assert.doesNotMatch(progressFunction, /'studentId'/i);
  assert.doesNotMatch(progressFunction, /'enrollmentId'/i);
  assert.doesNotMatch(progressFunction, /'track'/i);
  assert.doesNotMatch(progressFunction, /'recognizedText'/i);
  assert.doesNotMatch(progressFunction, /'audio/i);
});

test("the internal teacher endpoint accepts only signed teacher actions", async () => {
  const [server, route] = await Promise.all([
    readFile(serverUrl, "utf8"),
    readFile(routeUrl, "utf8")
  ]);
  assert.match(server, /verifySignedServiceRequest/);
  assert.match(server, /'getFluencyUnitSettings'[\s\S]*'saveFluencyUnitSettings'[\s\S]*'getFluencyRunProgress'[\s\S]*'closeFluencyRun'/);
  assert.match(server, /fluencyRunHmacSecretCurrent/);
  assert.match(route, /MAX_BODY_BYTES = 32 \* 1024/);
  assert.match(route, /getFluencyRunServiceConfig/);
  assert.doesNotMatch(route, /SUPABASE_SECRET_KEY/);
});

test("the staged planner panel reuses the existing teacher session and blocks stale unsaved settings", async () => {
  const panel = await readFile(panelUrl, "utf8");
  assert.match(panel, /function FluencyPanel\(\{ className, token, onAuthFailure \}\)/);
  assert.match(panel, /getFluencyUnitSettings/);
  assert.match(panel, /saveFluencyUnitSettings/);
  assert.match(panel, /startFluencyRunSnapshot/);
  assert.match(panel, /getFluencyRunProgress/);
  assert.match(panel, /closeFluencyRun/);
  assert.match(panel, /disabled=\{Boolean\(busy\) \|\| dirty \|\| settings\.isNew\}/);
  assert.doesNotMatch(panel, /HMAC_SECRET|SUPABASE|service_role/i);
});
