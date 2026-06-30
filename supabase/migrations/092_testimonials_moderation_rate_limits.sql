-- Testimonials moderation (pending) + anon rate limits for testimonials and security events

-- ─── 1) Rate limit helper (anon + authenticated) ─────────────────────────────
create table if not exists private.rate_limit_buckets (
  bucket_key text not null,
  window_start timestamptz not null,
  hit_count integer not null default 0,
  primary key (bucket_key, window_start)
);

revoke all on table private.rate_limit_buckets from public, anon, authenticated;
grant all on table private.rate_limit_buckets to service_role;

create or replace function private.check_rate_limit(
  p_bucket text,
  p_max_hits integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_bucket is null or trim(p_bucket) = '' then
    return false;
  end if;

  v_window := date_trunc('minute', now())
    - make_interval(secs => extract(epoch from now())::int % greatest(p_window_seconds, 1));

  insert into private.rate_limit_buckets (bucket_key, window_start, hit_count)
  values (p_bucket, v_window, 1)
  on conflict (bucket_key, window_start)
  do update set hit_count = private.rate_limit_buckets.hit_count + 1
  returning hit_count into v_count;

  return v_count <= p_max_hits;
end;
$$;

revoke all on function private.check_rate_limit(text, integer, integer) from public;
grant execute on function private.check_rate_limit(text, integer, integer) to authenticated, service_role;

-- ─── 2) Testimonials: pending moderation ───────────────────────────────────
drop policy if exists public_testimonials_insert_anon on public.public_testimonials;
drop policy if exists public_testimonials_insert_authenticated on public.public_testimonials;

create policy public_testimonials_insert_anon on public.public_testimonials
  for insert
  to anon
  with check (
    status = 'pending'
    and char_length(trim(author_name)) >= 2
    and char_length(trim(author_role)) >= 2
    and char_length(trim(body)) between 10 and 600
    and stars between 1 and 5
  );

create policy public_testimonials_insert_authenticated on public.public_testimonials
  for insert
  to authenticated
  with check (
    (select private.is_subscription_super_admin())
    or (
      status = 'pending'
      and char_length(trim(author_name)) >= 2
      and char_length(trim(author_role)) >= 2
      and char_length(trim(body)) between 10 and 600
      and stars between 1 and 5
    )
  );

create or replace function public.submit_public_testimonial(
  p_author_name text,
  p_author_role text,
  p_body text,
  p_stars integer default 5
)
returns uuid
language plpgsql
security invoker
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

revoke all on function public.submit_public_testimonial(text, text, text, integer) from public;
grant execute on function public.submit_public_testimonial(text, text, text, integer) to anon, authenticated;

-- ─── 3) Security events: anon rate limit ───────────────────────────────────
create or replace function public.log_security_event(
  p_event_type text,
  p_severity text default 'info',
  p_metadata jsonb default '{}'::jsonb,
  p_user_agent text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_firm_id uuid;
  v_employee_id uuid;
  v_id uuid;
  v_recent integer;
  v_severity text := lower(trim(coalesce(p_severity, 'info')));
  v_bucket text;
begin
  if p_event_type is null or trim(p_event_type) = '' then
    raise exception 'invalid_event_type';
  end if;

  if v_severity not in ('info', 'warning', 'high', 'critical') then
    v_severity := 'info';
  end if;

  if v_uid is not null then
    select count(*) into v_recent
    from public.security_events se
    where se.actor_auth_uid = v_uid
      and se.created_at > now() - interval '5 minutes';

    if v_recent >= 60 then
      return null;
    end if;

    v_firm_id := private.get_current_firm_id();
    v_employee_id := private.get_current_employee_id();
  else
    v_bucket := 'anon:' || coalesce(
      nullif(trim(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'), ''),
      'unknown'
    );
    if not private.check_rate_limit('security_event:' || v_bucket, 30, 300) then
      return null;
    end if;
  end if;

  insert into public.security_events (
    firm_id, actor_auth_uid, employee_id, event_type, severity, user_agent, metadata
  )
  values (
    v_firm_id,
    v_uid,
    v_employee_id,
    lower(trim(p_event_type)),
    v_severity,
    nullif(trim(coalesce(p_user_agent, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_security_event(text, text, jsonb, text) from public;
grant execute on function public.log_security_event(text, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
