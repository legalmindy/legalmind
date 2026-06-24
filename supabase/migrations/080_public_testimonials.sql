-- Public testimonials for landing page (submit + approved listing)

create table if not exists public.public_testimonials (
  id uuid primary key default gen_random_uuid(),
  author_name text not null,
  author_role text not null,
  body text not null,
  stars smallint not null default 5,
  status text not null default 'approved',
  user_id uuid references auth.users(id) on delete set null,
  firm_id uuid references public.firms(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint public_testimonials_body_len check (char_length(trim(body)) between 10 and 600),
  constraint public_testimonials_name_len check (char_length(trim(author_name)) between 2 and 120),
  constraint public_testimonials_role_len check (char_length(trim(author_role)) between 2 and 120),
  constraint public_testimonials_stars_range check (stars between 1 and 5),
  constraint public_testimonials_status_check check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists idx_public_testimonials_approved_created
  on public.public_testimonials (created_at desc)
  where status = 'approved';

alter table public.public_testimonials enable row level security;

create policy public_testimonials_select_approved
  on public.public_testimonials
  for select
  to anon, authenticated
  using (status = 'approved');

create policy public_testimonials_super_admin_all
  on public.public_testimonials
  for all
  to authenticated
  using ((select private.is_subscription_super_admin()))
  with check ((select private.is_subscription_super_admin()));

-- ─── List approved testimonials (public) ─────────────────────────────────────

create or replace function public.list_approved_testimonials(p_limit int default 24)
returns table (
  id uuid,
  author_name text,
  author_role text,
  body text,
  stars int,
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
    t.stars::int,
    t.created_at
  from public.public_testimonials t
  where t.status = 'approved'
  order by t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 24), 50));
$$;

revoke all on function public.list_approved_testimonials(int) from public;
grant execute on function public.list_approved_testimonials(int) to anon, authenticated;

-- ─── Submit testimonial (public) ───────────────────────────────────────────

create or replace function public.submit_public_testimonial(
  p_author_name text,
  p_author_role text,
  p_body text,
  p_stars int default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := trim(p_author_name);
  v_role text := trim(p_author_role);
  v_body text := trim(p_body);
  v_stars int := coalesce(p_stars, 5);
  v_firm_id uuid;
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

  if auth.uid() is not null then
    select p.firm_id into v_firm_id
    from public.profiles p
    where p.id = auth.uid();
  end if;

  insert into public.public_testimonials (
    author_name,
    author_role,
    body,
    stars,
    status,
    user_id,
    firm_id
  )
  values (
    v_name,
    v_role,
    v_body,
    v_stars,
    'approved',
    auth.uid(),
    v_firm_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_public_testimonial(text, text, text, int) from public;
grant execute on function public.submit_public_testimonial(text, text, text, int) to anon, authenticated;

-- Seed examples (idempotent)
insert into public.public_testimonials (author_name, author_role, body, stars, status)
select v.author_name, v.author_role, v.body, v.stars, 'approved'
from (
  values
    (
      'أ. محمد الحميري',
      'مدير مكتب — صنعاء',
      'وفّر علينا ساعات يومية في متابعة الجلسات والتحصيلات. النظام عملي جداً لمكتبنا.',
      5
    ),
    (
      'أ. سارة العولقي',
      'محامية — عدن',
      'أخيراً نظام يفهم طبيعة المحاكم اليمنية. التصدير PDF والأمان أعطانا ثقة كاملة.',
      5
    ),
    (
      'مكتب الشر partners',
      'مكتب ناشئ — تعز',
      'من أفضل قراراتنا التشغيلية. الفريق يرى فقط ما يخصه — والمالك يرى كل شيء.',
      5
    )
) as v(author_name, author_role, body, stars)
where not exists (
  select 1 from public.public_testimonials t
  where t.author_name = v.author_name and t.body = v.body
);
