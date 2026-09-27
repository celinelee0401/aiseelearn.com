-- Allow the three-second student finish-the-sentence window plus one second
-- of recorder/clock tolerance. The UI still hard-stops after three seconds.

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
    if existing_attempt.assignment_id = p_assignment_id
      and existing_attempt.round_number = p_round_number then
      return jsonb_build_object(
        'outcome', 'existing',
        'attemptId', existing_attempt.id,
        'round', existing_attempt.round_number
      );
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
  if not found then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  round_config := assignment_row.assignment_snapshot -> 'rounds' -> (p_round_number - 1);
  if round_config is null
    or jsonb_typeof(round_config) <> 'object'
    or (round_config ->> 'round')::integer <> p_round_number then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  time_limit_value := (round_config ->> 'timeLimitSeconds')::integer;
  if p_duration_ms > time_limit_value * 1000 + 4000 then
    return jsonb_build_object('outcome', 'time-limit');
  end if;

  if exists (
    select 1 from public.fluency_attempts
    where assignment_id = p_assignment_id and round_number = p_round_number
  ) then
    return jsonb_build_object('outcome', 'already-recorded');
  end if;

  insert into public.fluency_attempts (
    request_id,
    assignment_id,
    round_number,
    time_limit_seconds,
    duration_ms,
    recognized_text,
    assessment_provider,
    assessment_version,
    metrics
  ) values (
    p_request_id,
    p_assignment_id,
    p_round_number,
    time_limit_value,
    p_duration_ms,
    nullif(p_recognized_text, ''),
    p_assessment_provider,
    p_assessment_version,
    p_metrics
  )
  returning id into inserted_id;

  return jsonb_build_object('outcome', 'recorded', 'attemptId', inserted_id, 'round', p_round_number);
end;
$$;

revoke all on function public.record_fluency_attempt(text, uuid, uuid, uuid, integer, integer, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_fluency_attempt(text, uuid, uuid, uuid, integer, integer, text, text, text, jsonb) to service_role;
