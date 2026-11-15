-- BanaoPage cloud backend — Supabase (Postgres) schema.
-- Run this once in the Supabase SQL editor (project: banaopage).
-- The Vercel serverless API (api/cloud.js) talks to these tables with the
-- SERVICE ROLE key, so RLS stays locked down; the one anon policy below only
-- lets anyone read pages that are already public (status = 'live'), which is
-- exactly what a published landing page is.
--
-- Pages keep the same ids the browser already generates (id_...), so local
-- and cloud rows are the same row — no id mapping anywhere.

create table if not exists public.pages (
  id text primary key,
  slug text not null unique,
  owner text not null,
  title text not null default '',
  mode text not null default 'blocks',
  status text not null default 'draft',
  blocks jsonb not null default '[]'::jsonb,
  html_code text not null default '',
  seo_title text not null default '',
  seo_desc text not null default '',
  tracking jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pages_owner_idx on public.pages (owner);
create index if not exists pages_slug_idx on public.pages (slug);

create table if not exists public.events (
  id text primary key,
  page_id text not null,
  type text not null,
  label text,
  url text,
  visitor text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  ts bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists events_page_idx on public.events (page_id, ts desc);

create table if not exists public.leads (
  id text primary key,
  page_id text not null,
  kind text not null default 'form',
  name text,
  contact text,
  question text,
  data jsonb not null default '{}'::jsonb,
  ts bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists leads_page_idx on public.leads (page_id, ts desc);

alter table public.pages enable row level security;
alter table public.events enable row level security;
alter table public.leads enable row level security;

-- Public read of LIVE pages only (anon key). Drafts stay invisible.
-- Service-role calls from api/cloud.js bypass RLS entirely.
drop policy if exists "public read live pages" on public.pages;
create policy "public read live pages" on public.pages
  for select using (status = 'live');
