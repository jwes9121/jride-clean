create unique index agrimarket_driver_offers_one_active_per_order_idx
  on public.agrimarket_driver_offers(order_id)
  where status = 'offered';

create unique index agrimarket_driver_offers_one_active_per_driver_idx
  on public.agrimarket_driver_offers(driver_id)
  where status = 'offered';
