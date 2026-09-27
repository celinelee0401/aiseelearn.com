-- READ-ONLY preflight for the shared production Supabase project.
-- Inspect metadata only; this file does not read student rows or modify data.
-- Review the selected project and SQL text again before any manual execution.

-- Required shared identity tables, RLS state, and unexpected Fluency tables.
select
  c.relname as table_name,
  c.relkind as relation_kind,
  c.relrowsecurity as rls_enabled
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (c.relname in ('students', 'enrollments') or c.relname like 'fluency\_%' escape '\')
  and c.relkind in ('r', 'p')
order by c.relname;

-- Identity column names and types; no contents or PIN hashes are selected.
select
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('students', 'enrollments')
order by c.table_name, c.ordinal_position;

-- Confirm primary key, student foreign key, and class/seat uniqueness.
select
  c.conrelid::regclass::text as table_name,
  c.conname as constraint_name,
  c.contype as constraint_type,
  pg_catalog.pg_get_constraintdef(c.oid) as definition
from pg_catalog.pg_constraint c
join pg_catalog.pg_namespace n on n.oid = c.connamespace
where n.nspname = 'public'
  and c.conrelid in ('public.students'::regclass, 'public.enrollments'::regclass)
order by table_name, constraint_name;

-- Confirm the relevant identity indexes without reading their rows.
select tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and tablename in ('students', 'enrollments')
order by tablename, indexname;

-- Existing policies on the shared identity tables.
select schemaname, tablename, policyname, roles, cmd
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('students', 'enrollments')
order by tablename, policyname;

-- Grant inspection. A true RLS flag alone does not prove safe access.
select
  c.relname as table_name,
  pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select,
  pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') as service_role_can_select
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('students', 'enrollments')
  and c.relkind in ('r', 'p')
order by c.relname;

-- A collision check for Fluency RPC names before the new migration is applied.
select
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname like '%\_fluency\_%' escape '\'
    or p.proname like 'fluency\_%' escape '\'
  )
order by p.proname, arguments;

-- Core migration uses gen_random_uuid().
select to_regprocedure('gen_random_uuid()') is not null as gen_random_uuid_available;
