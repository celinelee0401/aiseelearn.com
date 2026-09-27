-- Run only against an isolated local database after importing the production
-- schema and the reviewed Fluency candidate. This transaction uses fake data.
begin;

do $$
declare
  student_value uuid;
  enrollment_value uuid;
  unassigned_student uuid;
  unassigned_enrollment uuid;
  unit_result jsonb;
  run_result jsonb;
  task_result jsonb;
  attempt_result jsonb;
  progress_result jsonb;
  close_result jsonb;
  seat_value integer;
  expected_rounds integer[];
  stored_rounds jsonb;
begin
  insert into public.students default values returning id into student_value;
  insert into public.enrollments (
    student_id, school_year, class_code, seat_number, grade_level, active
  ) values (
    student_value, '9999', 'DEMO', 1, 8, true
  ) returning id into enrollment_value;
  for seat_value in 2..4 loop
    insert into public.students default values returning id into student_value;
    insert into public.enrollments (
      student_id, school_year, class_code, seat_number, grade_level, active
    ) values (
      student_value, '9999', 'DEMO', seat_value, 8, true
    );
  end loop;
  -- An active enrollment can exist for an empty class seat without receiving
  -- a Fluency assignment. The teacher's roster snapshot remains authoritative.
  insert into public.students default values returning id into unassigned_student;
  insert into public.enrollments (
    student_id, school_year, class_code, seat_number, grade_level, active
  ) values (
    unassigned_student, '9999', 'DEMO', 5, 8, true
  ) returning id into unassigned_enrollment;
  select enrollment.student_id, enrollment.id
  into student_value, enrollment_value
  from public.enrollments enrollment
  where enrollment.school_year = '9999'
    and enrollment.class_code = 'DEMO'
    and enrollment.seat_number = 1;

  if public.get_fluency_unit_settings('TEST.U1') ->> 'isNew' <> 'true' then
    raise exception 'New unit draft was not available';
  end if;

  unit_result := public.save_fluency_unit_settings(
    'local-review-invalid-1', 'TEST.U1', 'Invalid draft', 'Draft prompt',
    '[{"track":"S1","useDefault":false,"rounds":[null,35,30]},
      {"track":"S2","useDefault":true,"rounds":[35,30,25]},
      {"track":"S3","useDefault":true,"rounds":[30,25,20]},
      {"track":"S4","useDefault":true,"rounds":[30,25,20]}]'::jsonb
  );
  if unit_result ->> 'outcome' <> 'invalid' then
    raise exception 'Null round time was accepted';
  end if;

  unit_result := public.save_fluency_unit_settings(
    'local-review-save-1', 'TEST.U1', 'Original title', 'Original speaking prompt',
    '[{"track":"S1","useDefault":false,"rounds":[40,35,30]},
      {"track":"S2","useDefault":true,"rounds":[35,30,25]},
      {"track":"S3","useDefault":true,"rounds":[30,25,20]},
      {"track":"S4","useDefault":true,"rounds":[30,25,20]}]'::jsonb
  );
  if unit_result ->> 'outcome' <> 'saved' then
    raise exception 'Unit save failed: %', unit_result ->> 'outcome';
  end if;

  run_result := public.create_fluency_run_snapshot(
    'local-review-run-1', '9999', 'DEMO', 'TEST.U1',
    '[{"seatNumber":1,"track":"S1"},
      {"seatNumber":2,"track":"S2"},
      {"seatNumber":3,"track":"S3"},
      {"seatNumber":4,"track":"S4"}]'::jsonb
  );
  if run_result ->> 'status' <> 'open'
    or (run_result ->> 'assignmentCount')::integer <> 4 then
    raise exception 'Run snapshot failed';
  end if;

  task_result := public.get_fluency_student_task(
    unassigned_student, unassigned_enrollment, '9999', 'DEMO', 'TEST.U1'
  );
  if task_result is not null then
    raise exception 'Unassigned active enrollment received a Fluency task';
  end if;

  for seat_value in 1..4 loop
    select assignment.assignment_snapshot -> 'rounds' into stored_rounds
    from public.fluency_assignments assignment
    join public.enrollments enrollment on enrollment.id = assignment.enrollment_id
    where assignment.run_id = (run_result ->> 'runId')::uuid
      and enrollment.seat_number = seat_value;
    expected_rounds := case seat_value
      when 1 then array[40, 35, 30]
      when 2 then array[35, 30, 25]
      else array[30, 25, 20]
    end;
    if jsonb_array_length(stored_rounds) <> 3
      or (stored_rounds #>> '{0,timeLimitSeconds}')::integer <> expected_rounds[1]
      or (stored_rounds #>> '{1,timeLimitSeconds}')::integer <> expected_rounds[2]
      or (stored_rounds #>> '{2,timeLimitSeconds}')::integer <> expected_rounds[3] then
      raise exception 'Frozen schedule was wrong for seat %', seat_value;
    end if;
  end loop;

  unit_result := public.save_fluency_unit_settings(
    'local-review-save-2', 'TEST.U1', 'Changed title', 'Changed speaking prompt',
    '[{"track":"S1","useDefault":false,"rounds":[45,40,35]},
      {"track":"S2","useDefault":true,"rounds":[35,30,25]},
      {"track":"S3","useDefault":true,"rounds":[30,25,20]},
      {"track":"S4","useDefault":true,"rounds":[30,25,20]}]'::jsonb
  );
  if unit_result ->> 'outcome' <> 'saved' then
    raise exception 'Unit revision failed';
  end if;

  task_result := public.get_fluency_student_task(
    student_value, enrollment_value, '9999', 'DEMO', 'TEST.U1'
  );
  if task_result ->> 'title' <> 'Original title'
    or task_result ->> 'promptText' <> 'Original speaking prompt'
    or (task_result #>> '{rounds,0,timeLimitSeconds}')::integer <> 40 then
    raise exception 'Open task changed after teacher edited the unit';
  end if;

  attempt_result := public.record_fluency_attempt(
    'local-review-attempt-1', student_value, enrollment_value,
    (task_result ->> 'assignmentId')::uuid, 1, 12000, 'A short synthetic transcript',
    'mock', 'local-1', '{"schemaVersion":"1.0","metrics":{}}'::jsonb
  );
  if attempt_result ->> 'outcome' <> 'recorded' then
    raise exception 'Attempt was not recorded: %', attempt_result ->> 'outcome';
  end if;

  task_result := public.get_fluency_student_task(
    student_value, enrollment_value, '9999', 'DEMO', 'TEST.U1'
  );
  if task_result #>> '{completedRounds,0}' <> '1'
    or task_result #>> '{completedAttempts,0,assessment,transcript}' <> 'A short synthetic transcript' then
    raise exception 'Recorded evidence did not resume';
  end if;

  progress_result := public.get_fluency_run_progress('9999', 'DEMO', 'TEST.U1');
  if jsonb_array_length(progress_result -> 'students') <> 4
    or progress_result #>> '{students,0,rounds,0,completed}' <> 'true' then
    raise exception 'Teacher progress was not updated';
  end if;

  close_result := public.close_fluency_run('local-review-close-1', '9999', 'DEMO', 'TEST.U1');
  if close_result ->> 'outcome' <> 'closed' then
    raise exception 'Run close failed';
  end if;
end;
$$;

rollback;
