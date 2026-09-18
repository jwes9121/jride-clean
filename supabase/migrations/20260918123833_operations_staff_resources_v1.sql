create table if not exists public.operations_staff_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text null check (description is null or char_length(description) <= 500),
  url text not null check (url ~* '^https?://'),
  category text not null default 'link'
    check (category in ('apk','link','guide','form','other')),
  audience text not null default 'all'
    check (audience in ('all','drivers','vendors','passengers','staff')),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operations_staff_resources enable row level security;

revoke all on table public.operations_staff_resources from anon, authenticated;

create index if not exists operations_staff_resources_active_sort_idx
  on public.operations_staff_resources (is_active desc, sort_order asc, created_at asc);

comment on table public.operations_staff_resources is
  'Admin-managed tools and links shown to approved Operations Schedule staff through server-side staff APIs only.';
