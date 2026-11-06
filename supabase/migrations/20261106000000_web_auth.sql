-- 网页登录账号独立于抓取到的投放账号。
create table public.web_accounts (
  id uuid primary key default gen_random_uuid(),
  feishu_app_id text not null,
  feishu_open_id text not null,
  feishu_tenant_key text,
  display_name text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  unique (feishu_app_id, feishu_open_id)
);

create table public.web_sessions (
  token_hash text primary key,
  account_id uuid not null references public.web_accounts (id) on delete cascade,
  expires_at timestamptz not null
);

create index web_sessions_account_expiry on public.web_sessions (account_id, expires_at);

alter table public.web_accounts enable row level security;
alter table public.web_sessions enable row level security;
revoke all on public.web_accounts, public.web_sessions from anon, authenticated;
grant select, insert, update, delete on public.web_accounts, public.web_sessions to service_role;
