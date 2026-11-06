-- 在 HOE 中独立维护竞品平台的访问权限，复用 auth.users 的 UUID。
create table public.pool_head_web_access (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.pool_head_web_access enable row level security;
revoke all on public.pool_head_web_access from anon, authenticated;
grant select on public.pool_head_web_access to authenticated;

create policy "users can read their own pool-head access"
  on public.pool_head_web_access
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
