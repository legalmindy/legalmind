-- Restore anon/authenticated EXECUTE on registration lookup RPCs (401 during member signup)

grant execute on function public.get_office_by_firm_code(text) to anon, authenticated;
grant execute on function public.get_office_by_code(text) to anon, authenticated;
grant execute on function public.office_code_exists(text) to anon, authenticated;
grant execute on function public.is_email_available_for_registration(text) to anon, authenticated;

do $$
begin
  if to_regprocedure('public.get_firm_roles_for_registration(text)') is not null then
    execute 'grant execute on function public.get_firm_roles_for_registration(text) to anon, authenticated';
  end if;
end $$;
