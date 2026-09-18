create table if not exists public.operations_orientation_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 140),
  audience text not null default 'general'
    check (audience in ('general','drivers','vendors','agri_vendors')),
  content text not null check (char_length(trim(content)) between 1 and 12000),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operations_orientation_notes enable row level security;

revoke all on table public.operations_orientation_notes from anon, authenticated;

create index if not exists operations_orientation_notes_active_sort_idx
  on public.operations_orientation_notes (is_active desc, audience asc, sort_order asc, created_at asc);

comment on table public.operations_orientation_notes is
  'Admin-managed orientation cheat sheets shown read-only to approved Operations Schedule staff through server-side staff APIs only.';
