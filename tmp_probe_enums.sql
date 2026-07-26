select e.enumlabel
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where t.typname = 'employee_role_enum'
order by e.enumsortorder;

select e.enumlabel
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typname = 'profile_role_enum'
order by e.enumsortorder;

select to_regprocedure('public.create_office_admin_profile(uuid,text,text,text,text)') is not null as has_admin_fn;
select to_regprocedure('public.normalize_yemeni_phone_for_storage(text)') is not null as has_phone_fn;
select to_regprocedure('private.profiles_role_column_type()') is not null as has_role_type_fn;
select to_regprocedure('public.seed_firm_role_templates(uuid)') is not null as has_seed_fn;

-- Does firms have required columns?
select column_name from information_schema.columns
where table_schema='public' and table_name='firms'
  and column_name in ('owner_full_name','subscription_status','subscription_plan','subscription_expires_at','is_locked','email','phone','plan')
order by 1;
