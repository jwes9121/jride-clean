-- JRIDE_DRIVER_PAX_CONFIRM_P2.sql
-- Create an immutable audit table for driver passenger-count confirmations.
-- Run this in Supabase SQL editor (or psql).

create extension if not exists pgcrypto;

create table if not exists public.ride_pax_confirmations (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null,
  driver_id uuid not null,
  matches boolean not null default true,
  booked_pax text null,
  actual_pax text null,
  reason text null,
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists ride_pax_confirmations_ride_id_idx
  on public.ride_pax_confirmations (ride_id);

alter table public.ride_pax_confirmations enable row level security;

-- Secure by default: no client-side policies here.
-- Inserts will be done via server route using SERVICE ROLE (bypasses RLS).