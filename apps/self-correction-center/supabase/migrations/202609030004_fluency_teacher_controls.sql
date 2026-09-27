create table public.fluency_teacher_requests (
  request_id text primary key,
  action text not null,
  unit_id text not null,
  scope_key text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  check (action in ('saveFluencyUnitSettings', 'closeFluencyRun')),
  check (length(scope_key) between 2 and 128),
  check (jsonb_typeof(response_json) = 'object')
);

alter table public.fluency_teacher_requests enable row level security;
grant select, insert on public.fluency_teacher_requests to service_role;

comment on table public.fluency_teacher_requests is
  'Idempotency ledger for teacher mutations. Responses contain unit settings only and never student identity data.';

create or replace function public.get_fluency_unit_settings(
  p_unit_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  unit_row public.fluency_units%rowtype;
  tracks_value jsonb;
begin
  if p_unit_id !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$' then
    return null;
  end if;

  select * into unit_row from public.fluency_units where id = p_unit_id;
  if not found then return null; end if;

  select jsonb_agg(
    jsonb_build_object(
      'track', default_rule.track,
      'useDefault', unit_rule.unit_id is null,
      'source', case when unit_rule.unit_id is null then 'globalDefault' else 'unitOverride' end,
      'rounds', jsonb_build_array(
        coalesce(unit_rule.round_1_seconds, default_rule.round_1_seconds),
        coalesce(unit_rule.round_2_seconds, default_rule.round_2_seconds),
        coalesce(unit_rule.round_3_seconds, default_rule.round_3_seconds)
      )
    ) order by default_rule.track
  ) into tracks_value
  from public.fluency_default_track_rules default_rule
  left join public.fluency_unit_track_rules unit_rule
    on unit_rule.unit_id = p_unit_id and unit_rule.track = default_rule.track;

  return jsonb_build_object(
    'unitId', unit_row.id,
    'title', unit_row.title,
    'promptText', unit_row.prompt_text,
    'configVersion', unit_row.config_version,
    'active', unit_row.active,
    'tracks', coalesce(tracks_value, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_fluency_unit_settings(text) from public, anon, authenticated;
grant execute on function public.get_fluency_unit_settings(text) to service_role;

create or replace function public.save_fluency_unit_settings(
  p_request_id text,
  p_unit_id text,
  p_title text,
  p_prompt_text text,
  p_rules jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_request public.fluency_teacher_requests%rowtype;
  item jsonb;
  track_value text;
  use_default_value boolean;
  rounds_value jsonb;
  round_1_value integer;
  round_2_value integer;
  round_3_value integer;
  seen_tracks text[] := array[]::text[];
  settings_value jsonb;
  response_value jsonb;
begin
  if p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_unit_id !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$'
    or length(trim(coalesce(p_title, ''))) not between 1 and 200
    or length(coalesce(p_prompt_text, '')) > 5000
    or jsonb_typeof(p_rules) <> 'array'
    or jsonb_array_length(p_rules) <> 4 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select * into saved_request
  from public.fluency_teacher_requests
  where request_id = p_request_id;
  if found then
    if saved_request.action = 'saveFluencyUnitSettings'
      and saved_request.unit_id = p_unit_id
      and saved_request.scope_key = p_unit_id then
      return saved_request.response_json;
    end if;
    return jsonb_build_object('outcome', 'conflict');
  end if;

  if not exists (select 1 from public.fluency_units where id = p_unit_id) then
    return jsonb_build_object('outcome', 'not-found');
  end if;

  for item in select value from jsonb_array_elements(p_rules)
  loop
    if jsonb_typeof(item) <> 'object' then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    track_value := upper(coalesce(item ->> 'track', ''));
    if track_value not in ('S1', 'S2', 'S3', 'S4') or track_value = any(seen_tracks) then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    seen_tracks := array_append(seen_tracks, track_value);

    if jsonb_typeof(item -> 'useDefault') <> 'boolean' then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    use_default_value := (item ->> 'useDefault')::boolean;
    rounds_value := item -> 'rounds';
    if jsonb_typeof(rounds_value) <> 'array' or jsonb_array_length(rounds_value) <> 3 then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    begin
      round_1_value := (rounds_value ->> 0)::integer;
      round_2_value := (rounds_value ->> 1)::integer;
      round_3_value := (rounds_value ->> 2)::integer;
    exception when others then
      return jsonb_build_object('outcome', 'invalid');
    end;
    if round_1_value is null
      or round_2_value is null
      or round_3_value is null
      or round_1_value not between 5 and 180
      or round_2_value not between 5 and 180
      or round_3_value not between 5 and 180
      or round_1_value <= round_2_value
      or round_2_value <= round_3_value then
      return jsonb_build_object('outcome', 'invalid');
    end if;

  end loop;

  if cardinality(seen_tracks) <> 4 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Validate the complete four-track payload before changing any rule.
  for item in select value from jsonb_array_elements(p_rules)
  loop
    track_value := upper(item ->> 'track');
    use_default_value := (item ->> 'useDefault')::boolean;
    rounds_value := item -> 'rounds';
    round_1_value := (rounds_value ->> 0)::integer;
    round_2_value := (rounds_value ->> 1)::integer;
    round_3_value := (rounds_value ->> 2)::integer;

    if use_default_value then
      delete from public.fluency_unit_track_rules
      where unit_id = p_unit_id and track = track_value;
    else
      insert into public.fluency_unit_track_rules (
        unit_id, track, round_1_seconds, round_2_seconds, round_3_seconds, updated_at
      ) values (
        p_unit_id, track_value, round_1_value, round_2_value, round_3_value, now()
      )
      on conflict (unit_id, track) do update set
        round_1_seconds = excluded.round_1_seconds,
        round_2_seconds = excluded.round_2_seconds,
        round_3_seconds = excluded.round_3_seconds,
        updated_at = now();
    end if;
  end loop;

  update public.fluency_units set
    title = trim(p_title),
    prompt_text = nullif(trim(coalesce(p_prompt_text, '')), ''),
    config_version = gen_random_uuid()::text,
    updated_at = now()
  where id = p_unit_id;

  settings_value := public.get_fluency_unit_settings(p_unit_id);
  response_value := jsonb_build_object('outcome', 'saved', 'settings', settings_value);
  insert into public.fluency_teacher_requests (request_id, action, unit_id, scope_key, response_json)
  values (p_request_id, 'saveFluencyUnitSettings', p_unit_id, p_unit_id, response_value);
  return response_value;
exception when unique_violation then
  select * into saved_request
  from public.fluency_teacher_requests
  where request_id = p_request_id;
  if found
    and saved_request.action = 'saveFluencyUnitSettings'
    and saved_request.unit_id = p_unit_id
    and saved_request.scope_key = p_unit_id then
    return saved_request.response_json;
  end if;
  return jsonb_build_object('outcome', 'conflict');
end;
$$;

revoke all on function public.save_fluency_unit_settings(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_fluency_unit_settings(text, text, text, text, jsonb) to service_role;

create or replace function public.close_fluency_run(
  p_request_id text,
  p_school_year text,
  p_class_code text,
  p_unit_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_request public.fluency_teacher_requests%rowtype;
  run_row public.fluency_runs%rowtype;
  scope_value text;
  response_value jsonb;
  closed_at_value timestamptz := now();
begin
  if p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_school_year !~ '^[0-9]{2,4}$'
    or p_class_code !~ '^[A-Z0-9-]{2,12}$'
    or p_unit_id !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  scope_value := p_school_year || ':' || p_class_code || ':' || p_unit_id;

  select * into saved_request
  from public.fluency_teacher_requests
  where request_id = p_request_id;
  if found then
    if saved_request.action = 'closeFluencyRun'
      and saved_request.unit_id = p_unit_id
      and saved_request.scope_key = scope_value then
      return saved_request.response_json;
    end if;
    return jsonb_build_object('outcome', 'conflict');
  end if;

  select * into run_row
  from public.fluency_runs
  where school_year = p_school_year
    and class_code = p_class_code
    and unit_id = p_unit_id
    and status = 'open'
  order by opened_at desc
  limit 1
  for update;

  if found then
    update public.fluency_runs
    set status = 'closed', closed_at = closed_at_value
    where id = run_row.id and status = 'open';
    response_value := jsonb_build_object(
      'outcome', 'closed',
      'unitId', p_unit_id,
      'status', 'closed',
      'closedAt', closed_at_value
    );
  else
    response_value := jsonb_build_object(
      'outcome', 'no-open-run',
      'unitId', p_unit_id,
      'status', 'no-open-run',
      'closedAt', null
    );
  end if;

  insert into public.fluency_teacher_requests (request_id, action, unit_id, scope_key, response_json)
  values (p_request_id, 'closeFluencyRun', p_unit_id, scope_value, response_value);
  return response_value;
exception when unique_violation then
  select * into saved_request
  from public.fluency_teacher_requests
  where request_id = p_request_id;
  if found
    and saved_request.action = 'closeFluencyRun'
    and saved_request.unit_id = p_unit_id
    and saved_request.scope_key = scope_value then
    return saved_request.response_json;
  end if;
  return jsonb_build_object('outcome', 'conflict');
end;
$$;

revoke all on function public.close_fluency_run(text, text, text, text) from public, anon, authenticated;
grant execute on function public.close_fluency_run(text, text, text, text) to service_role;

create or replace function public.get_fluency_run_progress(
  p_school_year text,
  p_class_code text,
  p_unit_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.fluency_runs%rowtype;
  students_value jsonb;
begin
  if p_school_year !~ '^[0-9]{2,4}$'
    or p_class_code !~ '^[A-Z0-9-]{2,12}$'
    or p_unit_id !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$' then
    return null;
  end if;

  select * into run_row
  from public.fluency_runs
  where school_year = p_school_year
    and class_code = p_class_code
    and unit_id = p_unit_id
    and status = 'open'
  order by opened_at desc
  limit 1;
  if not found then return null; end if;

  select jsonb_agg(
    jsonb_build_object(
      'seatNumber', enrollment.seat_number,
      'rounds', (
        select jsonb_agg(
          jsonb_build_object(
            'round', rounds.round_number,
            'completed', attempt.id is not null,
            'wpm', case
              when (attempt.metrics #>> '{metrics,pace,wpm}') ~ '^[0-9]+([.][0-9]+)?$'
                then (attempt.metrics #>> '{metrics,pace,wpm}')::numeric
              else null
            end,
            'pauseFlow', case
              when (attempt.metrics #>> '{metrics,pauseFlow,score}') ~ '^[0-9]+([.][0-9]+)?$'
                then (attempt.metrics #>> '{metrics,pauseFlow,score}')::numeric
              else null
            end,
            'pronunciationAccuracy', case
              when (attempt.metrics #>> '{metrics,pronunciationAccuracy,score}') ~ '^[0-9]+([.][0-9]+)?$'
                then (attempt.metrics #>> '{metrics,pronunciationAccuracy,score}')::numeric
              else null
            end,
            'prosody', case
              when (attempt.metrics #>> '{metrics,prosody,score}') ~ '^[0-9]+([.][0-9]+)?$'
                then (attempt.metrics #>> '{metrics,prosody,score}')::numeric
              else null
            end
          ) order by rounds.round_number
        )
        from generate_series(1, 3) as rounds(round_number)
        left join public.fluency_attempts attempt
          on attempt.assignment_id = assignment.id and attempt.round_number = rounds.round_number
      )
    ) order by enrollment.seat_number
  ) into students_value
  from public.fluency_assignments assignment
  join public.enrollments enrollment on enrollment.id = assignment.enrollment_id
  where assignment.run_id = run_row.id;

  return jsonb_build_object(
    'unitId', run_row.unit_id,
    'status', run_row.status,
    'openedAt', run_row.opened_at,
    'students', coalesce(students_value, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_fluency_run_progress(text, text, text) from public, anon, authenticated;
grant execute on function public.get_fluency_run_progress(text, text, text) to service_role;

comment on function public.get_fluency_run_progress(text, text, text) is
  'Returns the latest open run as seat-only progress. It deliberately omits names, UUIDs, tracks, transcripts, and audio locations.';
