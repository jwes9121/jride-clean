-- Enable realtime streaming for dispatch_actions
do $$
begin
  begin
    alter publication supabase_realtime add table public.dispatch_actions;
  exception
    when duplicate_object then
      null; -- already added, ignore
  end;
end;
$$;

-- Turn on RLS if not yet enabled
alter table public.dispatch_actions enable row level security;

-- Simple read policy: authenticated users can see dispatch actions
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'dispatch_actions'
      and policyname = 'dispatch_actions_read_auth'
  ) then
    create policy dispatch_actions_read_auth
      on public.dispatch_actions
      for select
      using ( auth.role() = 'authenticated' );
  end if;
end;
$$;
