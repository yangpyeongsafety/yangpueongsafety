-- Run this in Supabase SQL Editor when worker pages show "업체명 확인 필요".
-- It lets a worker read only the clients linked to their own assignments.

drop policy if exists "clients worker select assigned" on public.clients;
create policy "clients worker select assigned"
on public.clients for select
to authenticated
using (
  public.is_admin()
  or id in (
    select jr.client_id
    from public.job_requests jr
    join public.assignments a on a.request_id = jr.id
    where a.worker_id = public.current_worker_id()
       or a.worker_id = auth.uid()
  )
);
