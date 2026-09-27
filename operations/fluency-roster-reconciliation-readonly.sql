-- Fluency Challenge 115-1 roster reconciliation, read-only.
-- Run only in the verified production Supabase project after confirming its ref.
-- These queries return no student names, IDs, PIN hashes, or activation codes.

select
  school_year,
  class_code,
  count(*) filter (where active) as active_enrollments,
  count(*) filter (where active and pin_hash is not null) as active_with_pin,
  count(*) filter (where active and activation_code_hash is not null) as active_with_activation_code
from public.enrollments
where school_year = '115'
  and class_code in ('801', '816')
group by school_year, class_code
order by class_code;

-- The 801 planner Sheet currently has no rows for seats 1, 17, and 30.
-- Inspect only status flags; do not alter or reassign these records from this query.
select
  school_year,
  class_code,
  seat_number,
  active,
  pin_hash is not null as has_pin,
  activation_code_hash is not null as has_activation_code,
  activated_at is not null as was_activated
from public.enrollments
where school_year = '115'
  and class_code = '801'
  and seat_number in (1, 17, 30)
order by seat_number;

-- Resolve the discrepancy between a prior SQL Editor observation and the
-- 2026-09-19 schema export without assuming either is current.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'students'
order by ordinal_position;
