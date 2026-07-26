-- probe signup-related functions
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.proname in (
    'handle_new_user',
    'create_office_admin_profile',
    'create_office_member_profile',
    'create_invited_profile',
    'create_lawyer_profile'
  )
order by 1, 2;

select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.employees'::regclass
  and contype = 'c';

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'employees'
order by ordinal_position;
