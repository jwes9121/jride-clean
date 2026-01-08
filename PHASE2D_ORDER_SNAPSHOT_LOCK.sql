-- PHASE 2D: ORDER SNAPSHOT LOCK
-- Run this in Supabase SQL editor.

ALTER TABLE IF EXISTS public.bookings
  ADD COLUMN IF NOT EXISTS takeout_items_subtotal numeric(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.takeout_order_items (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL,
  menu_item_id uuid NULL,
  name text NOT NULL,
  price numeric(12,2) NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  snapshot_at timestamptz NOT NULL DEFAULT now()
);

DO 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'takeout_order_items_booking_id_fkey'
  ) THEN
    ALTER TABLE public.takeout_order_items
      ADD CONSTRAINT takeout_order_items_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
  END IF;
END;

CREATE INDEX IF NOT EXISTS takeout_order_items_booking_id_idx
  ON public.takeout_order_items(booking_id);