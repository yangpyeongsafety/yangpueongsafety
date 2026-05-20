-- Run this in Supabase SQL Editor to allow admin users to delete worker accounts.
-- It removes related work logs, assignments, the public profile, and the Auth user.

create or replace function public.delete_worker_account(target_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_worker_id uuid;
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  select worker_id
    into target_worker_id
  from public.profiles
  where id = target_profile_id
    and role = 'worker';

  if not found then
    return false;
  end if;

  delete from public.work_logs wl
  using public.assignments a
  where wl.assignment_id = a.id
    and (
      a.worker_id = target_profile_id
      or (target_worker_id is not null and a.worker_id = target_worker_id)
    );

  delete from public.work_logs
  where worker_id = target_profile_id
     or (target_worker_id is not null and worker_id = target_worker_id);

  delete from public.assignments
  where worker_id = target_profile_id
     or (target_worker_id is not null and worker_id = target_worker_id);

  delete from public.profiles
  where id = target_profile_id
    and role = 'worker';

  delete from auth.users
  where id = target_profile_id;

  if target_worker_id is not null
    and not exists (select 1 from public.profiles where worker_id = target_worker_id)
    and not exists (select 1 from public.assignments where worker_id = target_worker_id)
    and not exists (select 1 from public.work_logs where worker_id = target_worker_id) then
    delete from public.workers where id = target_worker_id;
  end if;

  return not exists (select 1 from public.profiles where id = target_profile_id)
     and not exists (select 1 from auth.users where id = target_profile_id);
end;
$$;

revoke all on function public.delete_worker_account(uuid) from public;
grant execute on function public.delete_worker_account(uuid) to authenticated;
