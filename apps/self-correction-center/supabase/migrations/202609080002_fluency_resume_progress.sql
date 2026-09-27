-- Return the student's already-recorded rounds with the frozen public task so
-- the browser can resume safely and the assessment gateway can reject a
-- duplicate before calling a paid speech provider.

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
declare
  task_value jsonb;
begin
  if not exists (
    select 1
    from public.enrollments
    where id = p_enrollment_id
      and student_id = p_student_id
      and school_year = p_school_year
      and class_code = p_class_code
      and active = true
  ) then
    return null;
  end if;

  select jsonb_build_object(
    'assignmentId', assignment.id,
    'runId', run.id,
    'unitId', run.unit_id,
    'title', case when assignment.assignment_snapshot ? 'title'
      then assignment.assignment_snapshot ->> 'title' else unit.title end,
    'promptText', case when assignment.assignment_snapshot ? 'promptText'
      then assignment.assignment_snapshot ->> 'promptText' else unit.prompt_text end,
    'configVersion', assignment.assignment_snapshot ->> 'configVersion',
    'rounds', assignment.assignment_snapshot -> 'rounds',
    'completedRounds', coalesce((
      select jsonb_agg(attempt.round_number order by attempt.round_number)
      from public.fluency_attempts attempt
      where attempt.assignment_id = assignment.id
    ), '[]'::jsonb)
  ) into task_value
  from public.fluency_assignments assignment
  join public.fluency_runs run on run.id = assignment.run_id
  join public.fluency_units unit on unit.id = run.unit_id
  where assignment.student_id = p_student_id
    and assignment.enrollment_id = p_enrollment_id
    and run.school_year = p_school_year
    and run.class_code = p_class_code
    and run.unit_id = p_unit_id
    and run.status = 'open'
  order by run.opened_at desc
  limit 1;

  return task_value;
end;
$$;

revoke all on function public.get_fluency_student_task(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.get_fluency_student_task(uuid, uuid, text, text, text) to service_role;

comment on function public.get_fluency_student_task(uuid, uuid, text, text, text)
is 'Returns the frozen student task plus completed round numbers for safe resume and provider-call deduplication.';
