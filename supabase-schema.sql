create extension if not exists pgcrypto;

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.workers
  add column if not exists phone text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique,
  role text not null check (role in ('admin', 'worker')),
  name text not null,
  phone text,
  worker_id uuid references public.workers(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists login_id text,
  add column if not exists role text,
  add column if not exists name text,
  add column if not exists phone text,
  add column if not exists worker_id uuid references public.workers(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists profiles_login_id_key on public.profiles (login_id);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.clients
  add column if not exists name text,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists clients_name_key on public.clients (name);

create table if not exists public.job_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_method text not null,
  headcount integer not null check (headcount > 0),
  site_location text not null,
  work_date date not null,
  notes text,
  status text not null default 'pending',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.job_requests
  add column if not exists client_id uuid references public.clients(id) on delete cascade,
  add column if not exists contact_method text,
  add column if not exists headcount integer,
  add column if not exists site_location text,
  add column if not exists work_date date,
  add column if not exists notes text,
  add column if not exists status text not null default 'pending',
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.job_requests(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (request_id, worker_id)
);

alter table public.assignments
  add column if not exists request_id uuid references public.job_requests(id) on delete cascade,
  add column if not exists worker_id uuid references public.workers(id) on delete cascade,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists assignments_request_worker_key
on public.assignments (request_id, worker_id);

create table if not exists public.work_logs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.assignments(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  start_time timestamptz,
  end_time timestamptz,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  work_hours numeric(4,1) not null default 0,
  labor_units numeric(4,1) not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.work_logs
  add column if not exists assignment_id uuid references public.assignments(id) on delete cascade,
  add column if not exists worker_id uuid references public.workers(id) on delete cascade,
  add column if not exists start_time timestamptz,
  add column if not exists end_time timestamptz,
  add column if not exists break_minutes integer not null default 0,
  add column if not exists work_hours numeric(4,1) not null default 0,
  add column if not exists labor_units numeric(4,1) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists work_logs_assignment_id_key
on public.work_logs (assignment_id);

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists work_logs_updated_at on public.work_logs;
create trigger work_logs_updated_at
before update on public.work_logs
for each row execute procedure public.handle_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text;
  meta_name text;
  meta_phone text;
  meta_login_id text;
  matched_worker_id uuid;
begin
  meta_role := coalesce(new.raw_user_meta_data->>'role', 'worker');
  meta_name := coalesce(new.raw_user_meta_data->>'name', '');
  meta_phone := new.raw_user_meta_data->>'phone';
  meta_login_id := coalesce(new.raw_user_meta_data->>'login_id', split_part(new.email, '@', 1));

  if meta_role = 'worker' then
    select id
      into matched_worker_id
    from public.workers
    where name = meta_name
      and coalesce(phone, '') = coalesce(meta_phone, '')
    limit 1;

    if matched_worker_id is null then
      insert into public.workers (name, phone)
      values (meta_name, meta_phone)
      returning id into matched_worker_id;
    end if;
  end if;

  insert into public.profiles (id, login_id, role, name, phone, worker_id)
  values (new.id, meta_login_id, meta_role, meta_name, meta_phone, matched_worker_id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.workers enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.job_requests enable row level security;
alter table public.assignments enable row level security;
alter table public.work_logs enable row level security;

drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles update own or admin" on public.profiles;
create policy "profiles update own or admin"
on public.profiles for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "workers admin manage" on public.workers;
create policy "workers admin manage"
on public.workers for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "workers own select" on public.workers;
create policy "workers own select"
on public.workers for select
to authenticated
using (
  public.is_admin()
  or id in (
    select worker_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "clients admin manage" on public.clients;
create policy "clients admin manage"
on public.clients for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "job requests admin manage" on public.job_requests;
create policy "job requests admin manage"
on public.job_requests for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "job requests worker select own" on public.job_requests;
create policy "job requests worker select own"
on public.job_requests for select
to authenticated
using (
  public.is_admin()
  or id in (
    select a.request_id
    from public.assignments a
    join public.profiles p on p.worker_id = a.worker_id
    where p.id = auth.uid()
  )
);

drop policy if exists "assignments admin manage" on public.assignments;
create policy "assignments admin manage"
on public.assignments for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "assignments worker select own" on public.assignments;
create policy "assignments worker select own"
on public.assignments for select
to authenticated
using (
  public.is_admin()
  or worker_id in (
    select worker_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "work logs admin manage" on public.work_logs;
create policy "work logs admin manage"
on public.work_logs for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "work logs worker read own" on public.work_logs;
create policy "work logs worker read own"
on public.work_logs for select
to authenticated
using (
  public.is_admin()
  or worker_id in (
    select worker_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "work logs worker upsert own" on public.work_logs;
create policy "work logs worker upsert own"
on public.work_logs for insert
to authenticated
with check (
  worker_id in (
    select worker_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "work logs worker update own" on public.work_logs;
create policy "work logs worker update own"
on public.work_logs for update
to authenticated
using (
  worker_id in (
    select worker_id from public.profiles where id = auth.uid()
  )
)
with check (
  worker_id in (
    select worker_id from public.profiles where id = auth.uid()
  )
);
