create table if not exists public.operations_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  meeting_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  required boolean not null default true,
  participant_ids text[] not null default '{}',
  agenda text not null default '',
  call_url text not null default '',
  notes text not null default '',
  status text not null default 'planned' check (status in ('planned','live','ended','cancelled')),
  current_slide integer not null default 0 check (current_slide >= 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  version integer not null default 1 check (version > 0),
  check (end_time > start_time)
);

create index if not exists operations_meetings_date_idx
  on public.operations_meetings (meeting_date, start_time);

create index if not exists operations_meetings_status_idx
  on public.operations_meetings (status, meeting_date, start_time);

create table if not exists public.operations_meeting_assets (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.operations_meetings(id) on delete cascade,
  kind text not null check (kind in ('image','pdf')),
  storage_path text not null unique,
  mime_type text not null,
  original_name text not null,
  caption text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index if not exists operations_meeting_assets_order_idx
  on public.operations_meeting_assets (meeting_id, sort_order, created_at);

create table if not exists public.operations_meeting_attendance (
  meeting_id uuid not null references public.operations_meetings(id) on delete cascade,
  employee_id text,
  staff_email text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  primary key (meeting_id, staff_email)
);

create index if not exists operations_meeting_attendance_employee_idx
  on public.operations_meeting_attendance (employee_id, joined_at desc);

alter table public.operations_meetings enable row level security;
alter table public.operations_meeting_assets enable row level security;
alter table public.operations_meeting_attendance enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operations-meeting-assets',
  'operations-meeting-assets',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
