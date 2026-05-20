-- Run this in Supabase SQL Editor when a worker can log in but cannot see assigned jobs.
-- It allows worker-facing pages to read assignments saved with either profiles.worker_id
-- or the worker user's own profile id.

drop policy if exists "job requests worker select own" on public.job_requests;
create policy "job requests worker select own"
on public.job_requests for select
to authenticated
using (
  public.is_admin()
  or id in (
    select a.request_id
    from public.assignments a
    where a.worker_id = public.current_worker_id()
       or a.worker_id = auth.uid()
  )
);

drop policy if exists "assignments worker select own" on public.assignments;
create policy "assignments worker select own"
on public.assignments for select
to authenticated
using (
  public.is_admin()
  or worker_id = public.current_worker_id()
  or worker_id = auth.uid()
);

drop policy if exists "work logs worker read own" on public.work_logs;
create policy "work logs worker read own"
on public.work_logs for select
to authenticated
using (
  public.is_admin()
  or worker_id = public.current_worker_id()
  or worker_id = auth.uid()
);

drop policy if exists "work logs worker upsert own" on public.work_logs;
create policy "work logs worker upsert own"
on public.work_logs for insert
to authenticated
with check (
  worker_id = public.current_worker_id()
  or worker_id = auth.uid()
);

drop policy if exists "work logs worker update own" on public.work_logs;
create policy "work logs worker update own"
on public.work_logs for update
to authenticated
using (
  worker_id = public.current_worker_id()
  or worker_id = auth.uid()
)
with check (
  worker_id = public.current_worker_id()
  or worker_id = auth.uid()
);
