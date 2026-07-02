create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_name text,
  event_date date,
  venue text,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'registration_open', 'registration_closed', 'live', 'completed', 'archived')),
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  group_label text not null default 'Batch',
  group_type text not null default 'alumni',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_settings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  registration_enabled boolean not null default true,
  raffle_enabled boolean not null default true,
  gallery_enabled boolean not null default true,
  helpdesk_enabled boolean not null default true,
  display_enabled boolean not null default true,
  show_sponsors boolean not null default true,
  show_countdown boolean not null default true,
  allow_walkin boolean not null default true,
  allow_manual_registration boolean not null default true,
  require_phone boolean not null default true,
  allow_duplicate_winner boolean not null default false,
  rolling_seconds integer not null default 40,
  claim_seconds integer not null default 20,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_pages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  hero_title text,
  hero_subtitle text,
  banner_image_url text,
  logo_url text,
  theme_color text,
  registration_message text,
  success_message text,
  venue_map_url text,
  facebook_url text,
  drive_album_url text,
  contact_person text,
  contact_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_attendee_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  type_key text not null,
  type_label text not null,
  raffle_eligible boolean not null default false,
  requires_primary boolean not null default false,
  default_has_own_qr boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(event_id, type_key)
);

create table if not exists public.event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  attendee_type_id uuid not null references public.event_attendee_types(id),
  full_name text not null,
  mobile_number text,
  phone_declined boolean not null default false,
  group_value text not null,
  nickname text,
  registration_status text not null default 'registered'
    check (registration_status in ('registered')),
  attendance_status text not null default 'not_checked_in'
    check (attendance_status in ('not_checked_in', 'checked_in')),
  registration_source text not null default 'online'
    check (registration_source in ('online', 'jride_login', 'assisted', 'walk_in')),
  qr_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  jride_user_id uuid,
  registered_at timestamptz not null default now(),
  checked_in_at timestamptz,
  is_disqualified boolean not null default false,
  disqualification_reason text,
  merged_into uuid references public.event_attendees(id),
  created_by uuid,
  updated_at timestamptz not null default now(),
  constraint event_attendees_phone_required_or_declined
    check (mobile_number is not null or phone_declined = true)
);

create table if not exists public.event_guest_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  primary_attendee_id uuid not null references public.event_attendees(id) on delete cascade,
  guest_attendee_id uuid not null references public.event_attendees(id) on delete cascade,
  relationship text not null,
  has_own_qr boolean not null default true,
  created_at timestamptz not null default now(),
  unique(event_id, primary_attendee_id, guest_attendee_id)
);

create table if not exists public.event_checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  attendee_id uuid not null references public.event_attendees(id) on delete cascade,
  scanned_by uuid,
  station_name text,
  checkin_method text not null default 'qr'
    check (checkin_method in ('qr', 'manual', 'assisted')),
  checked_in_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.event_raffle_draws (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  draw_name text not null,
  draw_type text not null default 'hourly'
    check (draw_type in ('hourly', 'minor', 'major', 'grand')),
  status text not null default 'draft'
    check (status in ('draft', 'rolling', 'winner_selected', 'claimed', 'unclaimed', 'cancelled')),
  started_at timestamptz,
  winner_selected_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_raffle_winners (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  draw_id uuid not null references public.event_raffle_draws(id) on delete cascade,
  attendee_id uuid not null references public.event_attendees(id),
  status text not null default 'selected'
    check (status in ('selected', 'claimed', 'unclaimed', 'voided')),
  claim_deadline_at timestamptz,
  claimed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_sponsors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  logo_url text,
  website_url text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.event_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  body text,
  priority text not null default 'normal'
    check (priority in ('normal','important','emergency')),
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.event_gallery (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text,
  image_url text not null,
  caption text,
  display_order integer not null default 0,
  is_featured boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.event_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  attendee_id uuid references public.event_attendees(id),
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_settings_event on public.event_settings(event_id);
create index if not exists idx_event_pages_event on public.event_pages(event_id);
create index if not exists idx_event_attendees_event on public.event_attendees(event_id);
create index if not exists idx_event_attendees_mobile on public.event_attendees(event_id, mobile_number);
create index if not exists idx_event_attendees_group on public.event_attendees(event_id, group_value);
create index if not exists idx_event_attendees_name on public.event_attendees(event_id, full_name);
create index if not exists idx_event_attendees_qr on public.event_attendees(qr_token);
create index if not exists idx_event_checkins on public.event_checkins(event_id, attendee_id);
create index if not exists idx_event_raffle_pool on public.event_attendees(event_id, attendance_status, is_disqualified, merged_into);
create index if not exists idx_event_audit on public.event_audit_logs(event_id, created_at desc);

insert into public.events (
  slug,
  name,
  short_name,
  event_date,
  description,
  status,
  group_label,
  group_type
)
values (
  'dbhs-2026',
  'DBHS Alumni Homecoming 2026',
  'DBHS 2026',
  '2026-12-01',
  'Digital registration, QR check-in, live attendance, and raffle powered by JRide Events.',
  'published',
  'Batch',
  'alumni'
)
on conflict (slug) do nothing;

insert into public.event_settings (event_id)
select id from public.events where slug = 'dbhs-2026'
on conflict (event_id) do nothing;

insert into public.event_pages (
  event_id,
  hero_title,
  hero_subtitle,
  registration_message,
  success_message,
  theme_color
)
select
  id,
  'DBHS Alumni Homecoming 2026',
  'Digital registration, QR check-in, live attendance, and raffle powered by JRide Events.',
  'Register early and present your Event Pass QR at the entrance for faster check-in.',
  'You are registered. Your Event Pass is ready.',
  '#7f1d1d'
from public.events
where slug = 'dbhs-2026'
on conflict (event_id) do nothing;

insert into public.event_attendee_types (
  event_id,
  type_key,
  type_label,
  raffle_eligible,
  requires_primary,
  default_has_own_qr,
  sort_order
)
select id, 'alumni', 'Alumni', true, false, true, 1
from public.events
where slug = 'dbhs-2026'
on conflict (event_id, type_key) do nothing;

insert into public.event_attendee_types (
  event_id,
  type_key,
  type_label,
  raffle_eligible,
  requires_primary,
  default_has_own_qr,
  sort_order
)
select id, 'guest', 'Guests & Family', false, true, true, 2
from public.events
where slug = 'dbhs-2026'
on conflict (event_id, type_key) do nothing;
