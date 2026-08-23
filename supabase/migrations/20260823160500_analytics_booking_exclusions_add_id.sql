alter table public.analytics_booking_exclusions
  add column if not exists id uuid default gen_random_uuid();

update public.analytics_booking_exclusions
set id = gen_random_uuid()
where id is null;

alter table public.analytics_booking_exclusions
  alter column id set default gen_random_uuid();

alter table public.analytics_booking_exclusions
  alter column id set not null;

create unique index if not exists analytics_booking_exclusions_id_uidx
  on public.analytics_booking_exclusions(id);
