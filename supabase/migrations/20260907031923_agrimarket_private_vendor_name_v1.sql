alter table public.agrimarket_producers add column vendor_name text
  constraint agrimarket_vendor_name_valid check (
    vendor_name is null or (vendor_name = btrim(vendor_name) and char_length(vendor_name) between 2 and 60 and vendor_name !~ '[[:cntrl:]]')
  );
comment on column public.agrimarket_producers.vendor_name is
  'Private vendor identity: own farmer workspace, admin, and assigned driver only. Never return in passenger catalog or order payloads.';
