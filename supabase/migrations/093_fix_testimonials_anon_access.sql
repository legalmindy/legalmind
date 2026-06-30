-- Restore anon-safe testimonials RPCs (security definer) after invoker + RLS regression

create or replace function public.list_approved_testimonials(p_limit integer default 24)
returns table (
  id uuid,
  author_name text,
  author_role text,
  body text,
  stars integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.author_name,
    t.author_role,
    t.body,
    t.stars::integer,
    t.created_at
  from public.public_testimonials t
  where t.status = 'approved'
  order by t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 24), 50));
$$;

create or replace function public.submit_public_testimonial(
  p_author_name text,
  p_author_role text,
  p_body text,
  p_stars integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_name text := trim(p_author_name);
  v_role text := trim(p_author_role);
  v_body text := trim(p_body);
  v_stars integer := coalesce(p_stars, 5);
  v_firm_id uuid;
  v_bucket text;
begin
  if char_length(v_name) < 2 then
    raise exception 'أدخل اسماً صحيحاً (حرفان على الأقل).';
  end if;
  if char_length(v_role) < 2 then
    raise exception 'أدخل المسمى أو المكتب (حرفان على الأقل).';
  end if;
  if char_length(v_body) < 10 then
    raise exception 'التعليق قصير جداً (10 أحرف على الأقل).';
  end if;
  if char_length(v_body) > 600 then
    raise exception 'التعليق طويل جداً (600 حرف كحد أقصى).';
  end if;
  if v_stars < 1 or v_stars > 5 then
    raise exception 'التقييم يجب أن يكون بين 1 و 5.';
  end if;

  v_bucket := coalesce(auth.uid()::text, 'anon:' || coalesce(
    nullif(trim(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'), ''),
    'unknown'
  ));

  if not private.check_rate_limit('testimonial:' || v_bucket, 3, 3600) then
    raise exception 'rate_limited';
  end if;

  if auth.uid() is not null then
    select p.firm_id into v_firm_id
    from public.profiles p
    where p.id = auth.uid();
  end if;

  insert into public.public_testimonials (
    author_name, author_role, body, stars, status, user_id, firm_id
  )
  values (v_name, v_role, v_body, v_stars, 'pending', auth.uid(), v_firm_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.list_approved_testimonials(integer) from public;
grant execute on function public.list_approved_testimonials(integer) to anon, authenticated;

revoke all on function public.submit_public_testimonial(text, text, text, integer) from public;
grant execute on function public.submit_public_testimonial(text, text, text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
