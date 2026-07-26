select left(pg_get_functiondef(p.oid), 2500) as def_head
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_office_admin_profile';

select left(pg_get_functiondef(p.oid), 1500) as handle_head
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

select private.profiles_role_column_type() as role_col_type;
