create index jfleet_security_state_route_review_idx
  on public.jfleet_security_state(route_review_id)
  where route_review_id is not null;

create index jfleet_security_state_route_plan_idx
  on public.jfleet_security_state(route_plan_id)
  where route_plan_id is not null;
