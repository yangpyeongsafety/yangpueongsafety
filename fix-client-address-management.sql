-- Run this in the Supabase SQL Editor before using client address management.
alter table public.clients
  add column if not exists address text,
  add column if not exists postcode text;

create unique index if not exists clients_name_key on public.clients (name);

drop policy if exists "clients admin manage" on public.clients;
create policy "clients admin manage"
on public.clients for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
