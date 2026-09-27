-- Fluency Challenge core data model. This migration intentionally stores the
-- teacher-assigned track, public prompt, and exact timings inside an immutable
-- assignment snapshot; students receive only the public task and round limits.

create table public.fluency_default_track_rules (
  track text primary key check (track in ('S1', 'S2', 'S3', 'S4')),
  round_1_seconds integer not null check (round_1_seconds between 5 and 180),
  round_2_seconds integer not null check (round_2_seconds between 5 and 180),
  round_3_seconds integer not null check (round_3_seconds between 5 and 180),
  check (round_1_seconds > round_2_seconds and round_2_seconds > round_3_seconds)
);

insert into public.fluency_default_track_rules (
  track, round_1_seconds, round_2_seconds, round_3_seconds
) values
  ('S1', 35, 30, 25),
  ('S2', 35, 30, 25),
  ('S3', 30, 25, 20),
  ('S4', 30, 25, 20);

create table public.fluency_units (
  id text primary key check (id ~ '^[A-Z0-9][A-Z0-9._-]{1,63}$'),
  title text not null check (length(trim(title)) between 1 and 200),
  prompt_text text check (length(prompt_text) <= 5000),
  config_version text not null check (length(config_version) between 1 and 128),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fluency_unit_track_rules (
  unit_id text not null references public.fluency_units(id) on delete cascade,
  track text not null references public.fluency_default_track_rules(track),
  round_1_seconds integer not null check (round_1_seconds between 5 and 180),
  round_2_seconds integer not null check (round_2_seconds between 5 and 180),
  round_3_seconds integer not null check (round_3_seconds between 5 and 180),
  updated_at timestamptz not null default now(),
  primary key (unit_id, track),
  check (round_1_seconds > round_2_seconds and round_2_seconds > round_3_seconds)
);

create table public.fluency_runs (
  id uuid primary key default gen_random_uuid(),
  school_year text not null check (school_year ~ '^[0-9]{2,4}$'),
  class_code text not null check (class_code ~ '^[A-Z0-9-]{2,12}$'),
  unit_id text not null references public.fluency_units(id),
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'open' and closed_at is null) or (status <> 'open'))
);

create unique index uq_fluency_runs_one_open_per_class_unit
  on public.fluency_runs (school_year, class_code, unit_id)
  where status = 'open';

create index idx_fluency_runs_class_unit
  on public.fluency_runs (school_year, class_code, unit_id, opened_at desc);

create table public.fluency_assignments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.fluency_runs(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  assignment_snapshot jsonb not null check (jsonb_typeof(assignment_snapshot) = 'object'),
  assigned_at timestamptz not null default now(),
  unique (run_id, enrollment_id),
  unique (run_id, student_id)
);

create index idx_fluency_assignments_student_lookup
  on public.fluency_assignments (student_id, enrollment_id, run_id);

create table public.fluency_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  assignment_id uuid not null references public.fluency_assignments(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 3),
  time_limit_seconds integer not null check (time_limit_seconds between 5 and 180),
  duration_ms integer not null check (duration_ms between 1 and 180000),
  recognized_text text,
  assessment_provider text not null check (assessment_provider ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  assessment_version text not null check (assessment_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  unique (assignment_id, round_number)
);

create index idx_fluency_attempts_assignment_round
  on public.fluency_attempts (assignment_id, round_number);

alter table public.fluency_default_track_rules enable row level security;
alter table public.fluency_units enable row level security;
alter table public.fluency_unit_track_rules enable row level security;
alter table public.fluency_runs enable row level security;
alter table public.fluency_assignments enable row level security;
alter table public.fluency_attempts enable row level security;

grant select, insert, update, delete on public.fluency_default_track_rules to service_role;
grant select, insert, update, delete on public.fluency_units to service_role;
grant select, insert, update, delete on public.fluency_unit_track_rules to service_role;
grant select, insert, update, delete on public.fluency_runs to service_role;
grant select, insert, update, delete on public.fluency_assignments to service_role;
grant select, insert, update, delete on public.fluency_attempts to service_role;

create or replace function public.create_fluency_run_snapshot(
  p_request_id text,
  p_school_year text,
  p_class_code text,
  p_unit_id text,
  p_assignments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  unit_row public.fluency_units%rowtype;
  existing_run public.fluency_runs%rowtype;
  new_run_id uuid;
  assignment_item jsonb;
  seat_value integer;
  track_value text;
  seen_seats integer[] := array[]::integer[];
  assignment_count integer;
begin
  if p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_school_year !~ '^[0-9]{2,4}$'
    or p_class_code !~ '^[A-Z0-9-]{2,12}$'
    or p_unit_id !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$'
    or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) not between 1 and 60 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  for assignment_item in select value from jsonb_array_elements(p_assignments)
  loop
    if jsonb_typeof(assignment_item) <> 'object' then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    begin
      seat_value := (assignment_item ->> 'seatNumber')::integer;
    exception when others then
      return jsonb_build_object('outcome', 'invalid');
    end;
    track_value := upper(coalesce(assignment_item ->> 'track', ''));
    if seat_value not between 1 and 60
      or track_value not in ('S1', 'S2', 'S3', 'S4')
      or seat_value = any(seen_seats) then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    seen_seats := array_append(seen_seats, seat_value);
  end loop;

  perform pg_advisory_xact_lock(hashtext(
    'fluency-run:' || p_school_year || ':' || p_class_code || ':' || p_unit_id
  ));

  select * into existing_run
  from public.fluency_runs
  where school_year = p_school_year
    and class_code = p_class_code
    and unit_id = p_unit_id
    and status = 'open'
  order by opened_at desc
  limit 1;
  if found then
    select count(*) into assignment_count
    from public.fluency_assignments
    where run_id = existing_run.id;
    return jsonb_build_object(
      'runId', existing_run.id,
      'assignmentCount', assignment_count,
      'status', existing_run.status,
      'created', false
    );
  end if;

  select * into unit_row
  from public.fluency_units
  where id = p_unit_id and active = true;
  if not found then return jsonb_build_object('outcome', 'not-found'); end if;

  select count(*) into assignment_count
  from jsonb_to_recordset(p_assignments) as requested("seatNumber" integer, track text)
  join public.enrollments enrollment
    on enrollment.school_year = p_school_year
    and enrollment.class_code = p_class_code
    and enrollment.seat_number = requested."seatNumber"
    and enrollment.active = true;
  if assignment_count <> jsonb_array_length(p_assignments) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  insert into public.fluency_runs (school_year, class_code, unit_id, status, opened_at)
  values (p_school_year, p_class_code, p_unit_id, 'open', now())
  returning id into new_run_id;

  insert into public.fluency_assignments (
    run_id, student_id, enrollment_id, assignment_snapshot, assigned_at
  )
  select
    new_run_id,
    enrollment.student_id,
    enrollment.id,
    jsonb_build_object(
      'schemaVersion', '1.0',
      'runId', new_run_id,
      'unitId', p_unit_id,
      'track', upper(requested.track),
      'scheduleSource', case when unit_rule.unit_id is null then 'globalDefault' else 'unitOverride' end,
      'configVersion', unit_row.config_version,
      'title', unit_row.title,
      'promptText', unit_row.prompt_text,
      'assignedAt', now(),
      'rounds', jsonb_build_array(
        jsonb_build_object('round', 1, 'timeLimitSeconds', coalesce(unit_rule.round_1_seconds, default_rule.round_1_seconds)),
        jsonb_build_object('round', 2, 'timeLimitSeconds', coalesce(unit_rule.round_2_seconds, default_rule.round_2_seconds)),
        jsonb_build_object('round', 3, 'timeLimitSeconds', coalesce(unit_rule.round_3_seconds, default_rule.round_3_seconds))
      )
    ),
    now()
  from jsonb_to_recordset(p_assignments) as requested("seatNumber" integer, track text)
  join public.enrollments enrollment
    on enrollment.school_year = p_school_year
    and enrollment.class_code = p_class_code
    and enrollment.seat_number = requested."seatNumber"
    and enrollment.active = true
  join public.fluency_default_track_rules default_rule
    on default_rule.track = upper(requested.track)
  left join public.fluency_unit_track_rules unit_rule
    on unit_rule.unit_id = p_unit_id and unit_rule.track = upper(requested.track);

  return jsonb_build_object(
    'runId', new_run_id,
    'assignmentCount', jsonb_array_length(p_assignments),
    'status', 'open',
    'created', true
  );
exception when unique_violation then
  select * into existing_run
  from public.fluency_runs
  where school_year = p_school_year
    and class_code = p_class_code
    and unit_id = p_unit_id
    and status = 'open'
  order by opened_at desc
  limit 1;
  if found then
    select count(*) into assignment_count from public.fluency_assignments where run_id = existing_run.id;
    return jsonb_build_object(
      'runId', existing_run.id,
      'assignmentCount', assignment_count,
      'status', existing_run.status,
      'created', false
    );
  end if;
  return jsonb_build_object('outcome', 'conflict');
end;
$$;

revoke all on function public.create_fluency_run_snapshot(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_fluency_run_snapshot(text, text, text, text, jsonb) to service_role;

create or replace function public.get_fluency_student_task(
  p_student_id uuid,
  p_enrollment_id uuid,
  p_school_year text,
  p_class_code text,
  p_unit_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return (
    select jsonb_build_object(
      'assignmentId', assignment.id,
      'runId', run.id,
      'unitId', run.unit_id,
      'title', case when assignment.assignment_snapshot ? 'title'
        then assignment.assignment_snapshot ->> 'title' else unit.title end,
      'promptText', case when assignment.assignment_snapshot ? 'promptText'
        then assignment.assignment_snapshot ->> 'promptText' else unit.prompt_text end,
      'configVersion', assignment.assignment_snapshot ->> 'configVersion',
      'rounds', assignment.assignment_snapshot -> 'rounds'
    )
    from public.fluency_assignments assignment
    join public.fluency_runs run on run.id = assignment.run_id
    join public.fluency_units unit on unit.id = run.unit_id
    join public.enrollments enrollment on enrollment.id = assignment.enrollment_id
    where assignment.student_id = p_student_id
      and assignment.enrollment_id = p_enrollment_id
      and enrollment.school_year = p_school_year
      and enrollment.class_code = p_class_code
      and enrollment.active = true
      and run.unit_id = p_unit_id
      and run.status = 'open'
    order by run.opened_at desc
    limit 1
  );
end;
$$;

revoke all on function public.get_fluency_student_task(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.get_fluency_student_task(uuid, uuid, text, text, text) to service_role;

create or replace function public.record_fluency_attempt(
  p_request_id text,
  p_student_id uuid,
  p_enrollment_id uuid,
  p_assignment_id uuid,
  p_round_number integer,
  p_duration_ms integer,
  p_recognized_text text,
  p_assessment_provider text,
  p_assessment_version text,
  p_metrics jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_attempt public.fluency_attempts%rowtype;
  assignment_row public.fluency_assignments%rowtype;
  round_config jsonb;
  time_limit_value integer;
  inserted_id uuid;
begin
  if p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_round_number not between 1 and 3
    or p_duration_ms not between 1 and 180000
    or length(coalesce(p_recognized_text, '')) > 10000
    or p_assessment_provider !~ '^[a-z0-9][a-z0-9._-]{1,63}$'
    or p_assessment_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or jsonb_typeof(p_metrics) <> 'object'
    or p_metrics ->> 'schemaVersion' <> '1.0' then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select * into existing_attempt from public.fluency_attempts where request_id = p_request_id;
  if found then
    if existing_attempt.assignment_id = p_assignment_id and existing_attempt.round_number = p_round_number then
      return jsonb_build_object('outcome', 'existing', 'attemptId', existing_attempt.id, 'round', existing_attempt.round_number);
    end if;
    return jsonb_build_object('outcome', 'conflict');
  end if;

  select assignment.* into assignment_row
  from public.fluency_assignments assignment
  join public.fluency_runs run on run.id = assignment.run_id
  where assignment.id = p_assignment_id
    and assignment.student_id = p_student_id
    and assignment.enrollment_id = p_enrollment_id
    and run.status = 'open';
  if not found then return jsonb_build_object('outcome', 'unauthorized'); end if;

  round_config := assignment_row.assignment_snapshot -> 'rounds' -> (p_round_number - 1);
  if round_config is null
    or jsonb_typeof(round_config) <> 'object'
    or (round_config ->> 'round')::integer <> p_round_number then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  time_limit_value := (round_config ->> 'timeLimitSeconds')::integer;
  if p_duration_ms > time_limit_value * 1000 + 2500 then return jsonb_build_object('outcome', 'time-limit'); end if;

  if exists (select 1 from public.fluency_attempts where assignment_id = p_assignment_id and round_number = p_round_number) then
    return jsonb_build_object('outcome', 'already-recorded');
  end if;

  insert into public.fluency_attempts (
    request_id, assignment_id, round_number, time_limit_seconds, duration_ms,
    recognized_text, assessment_provider, assessment_version, metrics
  ) values (
    p_request_id, p_assignment_id, p_round_number, time_limit_value, p_duration_ms,
    nullif(p_recognized_text, ''), p_assessment_provider, p_assessment_version, p_metrics
  ) returning id into inserted_id;
  return jsonb_build_object('outcome', 'recorded', 'attemptId', inserted_id, 'round', p_round_number);
end;
$$;

revoke all on function public.record_fluency_attempt(text, uuid, uuid, uuid, integer, integer, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_fluency_attempt(text, uuid, uuid, uuid, integer, integer, text, text, text, jsonb) to service_role;

comment on table public.fluency_assignments is
  'Immutable student-by-run task snapshots. The stored track is never returned to the browser.';
comment on table public.fluency_attempts is
  'One server-validated speech evidence record per assignment round; never stores audio bytes.';
