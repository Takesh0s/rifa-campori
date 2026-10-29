-- Rifa Solidária – Campori 2027 — database schema for Supabase (Postgres 15+).
--
-- Idempotent: safe to run again on an existing database; it upgrades
-- objects in place and never duplicates the spreadsheet import.
--
-- Security model:
--   * `tickets` and `settings` are world-readable; they hold no personal data.
--   * `orders` (buyer contact data) is readable only by admins.
--   * Clients never write tables directly. All state changes go through the
--     functions below, which enforce the business rules in one place.
--   * Functions that touch purchases run only as `service_role` (Vercel API)
--     or check `is_admin()` (admin panel).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.settings (
  id             int primary key default 1 check (id = 1),
  title          text    not null default 'Rifa Solidária – Campori 2027',
  subtitle       text    not null default 'Campori DSA',
  prize          text    not null default 'R$ 500',
  ticket_price   numeric(10,2) not null default 15,
  total_numbers  int     not null default 300,
  goal_amount    numeric(10,2) not null default 4500,
  goal_label     text    not null default 'Meta: todos os números vendidos',
  draw_info      text,
  whatsapp       text    not null default '5561984936058',
  pix_key        text    not null default '61984936058',
  pix_holder     text    not null default 'Luiz Phillipe de Souza Santos – Banco Inter',
  sales_open     boolean not null default true,
  pix_minutes    int     not null default 30,
  hold_hours     int     not null default 48,
  max_per_order  int     not null default 30
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique default upper(substr(md5(random()::text), 1, 6)),
  buyer_name     text not null,
  public_name    text,
  buyer_phone    text,
  buyer_email    text,
  show_on_wall   boolean not null default true,
  numbers        int[]  not null,
  amount         numeric(10,2) not null,
  method         text not null check (method in ('pix','in_person','manual')),
  status         text not null default 'pending'
                 check (status in ('pending','paid','expired','cancelled','conflict')),
  mp_payment_id  text,             -- Mercado Pago order id (ORD…)
  expires_at     timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);
-- Salted SHA-256 of the buyer IP, used only to rate-limit reservations.
alter table public.orders add column if not exists client_hash text;
-- Secret kept only in the buyer's browser; lets "Meus números" read the order
-- status. The order id is not usable for this because it is visible in `tickets`.
-- Two v4 UUIDs = 244 random bits, using only core functions (no pgcrypto schema issues).
alter table public.orders add column if not exists access_token text not null
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index if not exists orders_access_token_idx on public.orders (access_token);

alter table public.settings add column if not exists gallery_enabled boolean not null default false;
alter table public.settings add column if not exists gallery_title text not null default 'Memórias do Campori DSA';
alter table public.settings add column if not exists gallery_message text not null default
  'Obrigado pela colaboração de todos! Graças ao nosso bom Deus, conseguimos o valor para o Campori, e agora quero compartilhar com vocês as memórias desse momento mágico na minha vida. 💛';

create table if not exists public.tickets (
  number         int primary key,
  status         text not null default 'available' check (status in ('available','reserved','paid')),
  order_id       uuid references public.orders(id) on delete set null,
  reserved_until timestamptz,
  updated_at     timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.gallery_photos (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,
  caption     text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Integrity constraints (drop + add keeps the script re-runnable)
-- ---------------------------------------------------------------------------

alter table public.settings
  drop constraint if exists settings_gallery_chk,
  add  constraint settings_gallery_chk check (
    char_length(gallery_title) between 1 and 80 and char_length(gallery_message) <= 2000
  );

alter table public.settings
  drop constraint if exists settings_values_chk,
  add  constraint settings_values_chk check (
    ticket_price > 0
    and total_numbers between 1 and 10000
    and goal_amount > 0
    and pix_minutes between 30 and 1440
    and hold_hours between 1 and 720
    and max_per_order between 1 and 100
    and whatsapp ~ '^\d{12,13}$'
  );

alter table public.orders
  drop constraint if exists orders_values_chk,
  add  constraint orders_values_chk check (
    char_length(buyer_name) between 1 and 80
    and (public_name is null or char_length(public_name) <= 40)
    and (buyer_phone is null or buyer_phone ~ '^\d{10,13}$')
    and (buyer_email is null or char_length(buyer_email) <= 120)
    and (notes is null or char_length(notes) <= 500)
    and amount >= 0
    and (cardinality(numbers) > 0 or status = 'cancelled')
    and (client_hash is null or char_length(client_hash) = 64)
  );

alter table public.gallery_photos
  drop constraint if exists gallery_photos_values_chk,
  add  constraint gallery_photos_values_chk check (
    path ~ '^[0-9a-f-]{36}\.(webp|jpg)$'
    and (caption is null or char_length(caption) <= 200)
  );

alter table public.tickets
  drop constraint if exists tickets_number_chk,
  add  constraint tickets_number_chk check (number > 0);

create index if not exists orders_status_idx          on public.orders (status);
create index if not exists orders_pending_client_idx  on public.orders (client_hash) where status = 'pending';
create index if not exists tickets_order_id_idx       on public.tickets (order_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.settings enable row level security;
alter table public.tickets  enable row level security;
alter table public.orders   enable row level security;
alter table public.admins   enable row level security;
alter table public.gallery_photos enable row level security;

drop policy if exists "settings: public read"  on public.settings;
drop policy if exists "settings: admin update" on public.settings;
drop policy if exists "tickets: public read"   on public.tickets;
drop policy if exists "orders: admin read"     on public.orders;
drop policy if exists "orders: admin update"   on public.orders;
drop policy if exists "admins: self read"      on public.admins;
drop policy if exists "gallery: read when published" on public.gallery_photos;
drop policy if exists "gallery: admin insert"        on public.gallery_photos;
drop policy if exists "gallery: admin update"        on public.gallery_photos;
drop policy if exists "gallery: admin delete"        on public.gallery_photos;

create policy "settings: public read"  on public.settings for select using (true);
create policy "settings: admin update" on public.settings for update using (public.is_admin()) with check (public.is_admin());
create policy "tickets: public read"   on public.tickets  for select using (true);
create policy "orders: admin read"     on public.orders   for select using (public.is_admin());
create policy "orders: admin update"   on public.orders   for update using (public.is_admin()) with check (public.is_admin());
create policy "admins: self read"      on public.admins   for select using (user_id = auth.uid());
-- Photos stay hidden until the admin publishes the gallery.
create policy "gallery: read when published" on public.gallery_photos for select
  using ((select gallery_enabled from public.settings where id = 1) or public.is_admin());
create policy "gallery: admin insert" on public.gallery_photos for insert with check (public.is_admin());
create policy "gallery: admin update" on public.gallery_photos for update using (public.is_admin()) with check (public.is_admin());
create policy "gallery: admin delete" on public.gallery_photos for delete using (public.is_admin());

-- Table privileges: defense in depth on top of RLS. Supabase grants ALL to
-- anon/authenticated by default; reduce that to what the clients really use.
revoke insert, update, delete, truncate on public.settings, public.tickets, public.orders, public.admins
  from anon, authenticated;
revoke select on public.orders, public.admins from anon;
revoke insert, update, delete, truncate on public.gallery_photos from anon;
revoke update, truncate on public.gallery_photos from authenticated;
grant insert, delete on public.gallery_photos to authenticated;
grant update (caption, sort_order) on public.gallery_photos to authenticated;

-- Admins may edit display/contact fields only. Status, numbers and amounts
-- change exclusively through the functions, so they cannot drift apart.
grant update (title, subtitle, prize, goal_amount, goal_label, draw_info, whatsapp,
              pix_key, pix_holder, sales_open, pix_minutes, hold_hours, max_per_order,
              gallery_enabled, gallery_title, gallery_message)
  on public.settings to authenticated;
grant update (buyer_name, public_name, buyer_phone, show_on_wall, notes)
  on public.orders to authenticated;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Expired reservations are released lazily: every write path calls this
-- first, so no scheduler is needed for correctness.
create or replace function public.release_expired() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update orders set status = 'expired'
   where status = 'pending' and expires_at is not null and expires_at < now();
  update tickets set status = 'available', order_id = null, reserved_until = null, updated_at = now()
   where status = 'reserved' and reserved_until < now();
end $$;

create or replace function public._validate_numbers(p_numbers int[]) returns void
language plpgsql stable set search_path = public, pg_temp as $$
declare s settings;
begin
  select * into s from settings where id = 1;
  if p_numbers is null or cardinality(p_numbers) = 0 then
    raise exception 'EMPTY_SELECTION';
  end if;
  if cardinality(p_numbers) > s.max_per_order then
    raise exception 'TOO_MANY' using detail = s.max_per_order::text;
  end if;
  if (select count(distinct n) from unnest(p_numbers) n) <> cardinality(p_numbers) then
    raise exception 'DUPLICATED_NUMBERS';
  end if;
  if exists (select 1 from unnest(p_numbers) n where n < 1 or n > s.total_numbers) then
    raise exception 'OUT_OF_RANGE';
  end if;
end $$;

-- Locks the requested rows and fails with NUMBERS_TAKEN (detail = list) if
-- any of them is not free. Callers must already hold the transaction.
create or replace function public._lock_free_numbers(p_numbers int[]) returns void
language plpgsql set search_path = public, pg_temp as $$
declare v_taken int[];
begin
  -- Ordered locking prevents deadlocks between overlapping selections.
  perform 1 from tickets where number = any(p_numbers) order by number for update;
  select coalesce(array_agg(number order by number), '{}') into v_taken
    from tickets where number = any(p_numbers) and status <> 'available';
  if cardinality(v_taken) > 0 then
    raise exception 'NUMBERS_TAKEN' using detail = array_to_string(v_taken, ',');
  end if;
end $$;

-- v1 signature (without p_client_hash) is replaced, not overloaded.
drop function if exists public.reserve_numbers(int[], text, text, text, text, text, boolean);

create or replace function public.reserve_numbers(
  p_numbers int[], p_name text, p_public_name text, p_phone text,
  p_email text, p_method text, p_show boolean, p_client_hash text
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s settings; v_order orders; v_until timestamptz; v_pending_orders int; v_pending_numbers int;
begin
  select * into s from settings where id = 1;
  if not s.sales_open then raise exception 'SALES_CLOSED'; end if;
  if p_method not in ('pix', 'in_person') then raise exception 'INVALID_METHOD'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;
  if coalesce(p_phone, '') !~ '^\d{10,13}$' then raise exception 'PHONE_REQUIRED'; end if;
  perform _validate_numbers(p_numbers);
  perform release_expired();

  -- Anti-hoarding: one client cannot keep more than a full order's worth of
  -- numbers (or 5 orders) on hold at the same time.
  if p_client_hash is not null then
    select count(*), coalesce(sum(cardinality(numbers)), 0)
      into v_pending_orders, v_pending_numbers
      from orders where client_hash = p_client_hash and status = 'pending';
    if v_pending_orders >= 5 or v_pending_numbers + cardinality(p_numbers) > s.max_per_order then
      raise exception 'RATE_LIMITED';
    end if;
  end if;

  perform _lock_free_numbers(p_numbers);

  -- Pix hold outlives the QR code by 5 minutes so a payment made in the last
  -- second still finds its numbers reserved.
  v_until := case when p_method = 'pix'
                  then now() + make_interval(mins => s.pix_minutes + 5)
                  else now() + make_interval(hours => s.hold_hours) end;

  insert into orders (buyer_name, public_name, buyer_phone, buyer_email, show_on_wall,
                      numbers, amount, method, status, expires_at, client_hash)
  values (trim(p_name), nullif(trim(coalesce(p_public_name, '')), ''), p_phone, nullif(p_email, ''),
          coalesce(p_show, true), (select array_agg(n order by n) from unnest(p_numbers) n),
          cardinality(p_numbers) * s.ticket_price, p_method, 'pending', v_until, p_client_hash)
  returning * into v_order;

  update tickets set status = 'reserved', order_id = v_order.id,
                     reserved_until = v_until, updated_at = now()
   where number = any(p_numbers);

  return json_build_object('id', v_order.id, 'code', v_order.code, 'numbers', v_order.numbers,
                           'amount', v_order.amount, 'expires_at', v_order.expires_at,
                           'access_token', v_order.access_token);
end $$;

-- Idempotent: returns 'already_paid' on repeated webhooks. Returns 'conflict'
-- when the hold expired and someone else took a number before the payment
-- landed; the admin then swaps the number or refunds.
create or replace function public.confirm_order(p_order_id uuid, p_payment_id text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order orders; v_ok int;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'paid' then return 'already_paid'; end if;

  perform 1 from tickets where number = any(v_order.numbers) order by number for update;

  select count(*) into v_ok from tickets
   where number = any(v_order.numbers)
     and (order_id = v_order.id or status = 'available'
          or (status = 'reserved' and reserved_until < now()));

  if v_ok <> cardinality(v_order.numbers) then
    update orders set status = 'conflict', mp_payment_id = coalesce(p_payment_id, mp_payment_id),
                      notes = left(coalesce(notes || ' | ', '') || 'Pago após outro comprador reservar algum número', 500)
     where id = v_order.id;
    return 'conflict';
  end if;

  update tickets set status = 'paid', order_id = v_order.id, reserved_until = null, updated_at = now()
   where number = any(v_order.numbers);
  update orders set status = 'paid', paid_at = now(), expires_at = null,
                    mp_payment_id = coalesce(p_payment_id, mp_payment_id)
   where id = v_order.id;
  return 'paid';
end $$;

create or replace function public._cancel_order(p_order_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update tickets set status = 'available', order_id = null, reserved_until = null, updated_at = now()
   where order_id = p_order_id;
  update orders set status = 'cancelled', expires_at = null,
                    notes = case when p_note is null then notes
                                 else left(coalesce(notes || ' | ', '') || p_note, 500) end
   where id = p_order_id;
end $$;

-- "Meus números": the browser sends the tokens it stored at purchase time.
-- Returns no contact data; an expired-but-not-yet-swept hold already reads as expired.
create or replace function public.get_my_orders(p_tokens text[])
returns table (code text, numbers int[], status text, method text, amount numeric,
               expires_at timestamptz, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.code, o.numbers,
         case when o.status = 'pending' and o.expires_at < now() then 'expired' else o.status end,
         o.method, o.amount, o.expires_at, o.created_at, o.paid_at
    from orders o
   where o.access_token = any(p_tokens[1:50])
   order by o.created_at desc;
$$;

-- Thank-you wall: exposes only the chosen public name and a count.
create or replace function public.get_supporters()
returns table (name text, qty int, since timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public_name, split_part(buyer_name, ' ', 1)) as name,
         sum(cardinality(numbers))::int as qty,
         min(paid_at) as since
    from orders
   where status = 'paid' and show_on_wall
   group by 1
   order by min(paid_at) desc, 1;
$$;

-- Admin operations ---------------------------------------------------------

create or replace function public.admin_register_sale(
  p_numbers int[], p_name text, p_public_name text default null,
  p_phone text default null, p_show boolean default true, p_notes text default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare s settings; v_order orders;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;
  perform _validate_numbers(p_numbers);
  select * into s from settings where id = 1;
  perform release_expired();
  perform _lock_free_numbers(p_numbers);

  insert into orders (buyer_name, public_name, buyer_phone, show_on_wall, numbers, amount,
                      method, status, paid_at, notes)
  values (trim(p_name), nullif(trim(coalesce(p_public_name, '')), ''), nullif(p_phone, ''),
          coalesce(p_show, true), (select array_agg(n order by n) from unnest(p_numbers) n),
          cardinality(p_numbers) * s.ticket_price, 'manual', 'paid', now(), nullif(trim(p_notes), ''))
  returning * into v_order;

  update tickets set status = 'paid', order_id = v_order.id, reserved_until = null, updated_at = now()
   where number = any(p_numbers);
  return json_build_object('id', v_order.id, 'code', v_order.code);
end $$;

create or replace function public.admin_confirm_order(p_order_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  return confirm_order(p_order_id, null);
end $$;

create or replace function public.admin_cancel_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  perform _cancel_order(p_order_id, null);
end $$;

-- Releases individual numbers and shrinks their orders accordingly; an order
-- left without numbers becomes cancelled in the same statement.
create or replace function public.admin_release_numbers(p_numbers int[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s settings;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into s from settings where id = 1;

  with affected as (
    select distinct order_id from tickets where number = any(p_numbers) and order_id is not null
  ), remaining as (
    select o.id, coalesce(array_agg(n order by n) filter (where n <> all(p_numbers)), '{}') as nums
      from orders o join affected a on a.order_id = o.id
      cross join lateral unnest(o.numbers) n
     group by o.id
  )
  update orders o
     set numbers = r.nums,
         amount  = cardinality(r.nums) * s.ticket_price,
         status  = case when cardinality(r.nums) = 0 then 'cancelled' else o.status end
    from remaining r
   where o.id = r.id;

  update tickets set status = 'available', order_id = null, reserved_until = null, updated_at = now()
   where number = any(p_numbers);
end $$;

-- Function privileges: Postgres grants EXECUTE to PUBLIC by default, so
-- revoke everything first and re-grant explicitly.
revoke all on function public.is_admin()                                         from public, anon, authenticated;
revoke all on function public.release_expired()                                  from public, anon, authenticated;
revoke all on function public._validate_numbers(int[])                           from public, anon, authenticated;
revoke all on function public._lock_free_numbers(int[])                          from public, anon, authenticated;
revoke all on function public.reserve_numbers(int[],text,text,text,text,text,boolean,text) from public, anon, authenticated;
revoke all on function public.confirm_order(uuid,text)                           from public, anon, authenticated;
revoke all on function public._cancel_order(uuid,text)                           from public, anon, authenticated;
revoke all on function public.get_supporters()                                   from public, anon, authenticated;
revoke all on function public.get_my_orders(text[])                              from public, anon, authenticated;
revoke all on function public.admin_register_sale(int[],text,text,text,boolean,text) from public, anon, authenticated;
revoke all on function public.admin_confirm_order(uuid)                          from public, anon, authenticated;
revoke all on function public.admin_cancel_order(uuid)                           from public, anon, authenticated;
revoke all on function public.admin_release_numbers(int[])                       from public, anon, authenticated;

-- is_admin() runs inside RLS policies, so every role that can query a
-- protected table must be able to execute it.
grant execute on function public.is_admin()        to anon, authenticated, service_role;
grant execute on function public.get_supporters()  to anon, authenticated, service_role;
grant execute on function public.get_my_orders(text[]) to anon, authenticated, service_role;
grant execute on function public.release_expired() to authenticated, service_role;
grant execute on function public.reserve_numbers(int[],text,text,text,text,text,boolean,text) to service_role;
grant execute on function public.confirm_order(uuid,text)    to service_role;
grant execute on function public._cancel_order(uuid,text)    to service_role;
grant execute on function public._validate_numbers(int[])    to service_role;
grant execute on function public._lock_free_numbers(int[])   to service_role;
grant execute on function public.admin_register_sale(int[],text,text,text,boolean,text) to authenticated;
grant execute on function public.admin_confirm_order(uuid)   to authenticated;
grant execute on function public.admin_cancel_order(uuid)    to authenticated;
grant execute on function public.admin_release_numbers(int[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (RLS still applies: anon receives only `tickets` and `settings`)
-- ---------------------------------------------------------------------------

do $$ begin
  alter publication supabase_realtime add table public.tickets;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket for gallery photos
-- ---------------------------------------------------------------------------
-- Public bucket: files are served by URL without auth. Names are random UUIDs and
-- the admin UI re-encodes images before upload, which strips EXIF/GPS metadata.
-- Guarded so the script also runs on plain Postgres (local tests).
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('gallery', 'gallery', true, 5242880, array['image/webp', 'image/jpeg'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "gallery: admin upload" on storage.objects';
  execute 'drop policy if exists "gallery: admin update" on storage.objects';
  execute 'drop policy if exists "gallery: admin delete" on storage.objects';
  execute $p$create policy "gallery: admin upload" on storage.objects for insert to authenticated
            with check (bucket_id = 'gallery' and public.is_admin())$p$;
  execute $p$create policy "gallery: admin update" on storage.objects for update to authenticated
            using (bucket_id = 'gallery' and public.is_admin())$p$;
  execute $p$create policy "gallery: admin delete" on storage.objects for delete to authenticated
            using (bucket_id = 'gallery' and public.is_admin())$p$;
end $$;

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

insert into public.tickets (number)
select g from generate_series(1, (select total_numbers from public.settings where id = 1)) g
on conflict do nothing;

-- Sales already recorded in Rifa.xlsx before the site went live.
do $$
declare r record; v_id uuid; v_price numeric;
begin
  if exists (select 1 from public.orders where notes = 'Importado da planilha') then
    return;
  end if;
  select ticket_price into v_price from public.settings where id = 1;
  for r in select * from (values
    ('Jean', 'Jean', array[43, 258]),
    ('Luiz', 'Luiz', array[12, 44]),
    ('Gil', 'Gil', array[24, 33, 61, 68, 71, 171, 181, 222, 266, 296]),
    ('Ana Lúcia. Ely', 'Ana Lúcia e Ely', array[3]),
    ('Douglas', 'Douglas', array[10, 45]),
    ('Andreia', 'Andreia', array[88]),
    ('Da Silva', 'Da Silva', array[5, 42]),
    ('Tia da Iara', 'Tia da Iara', array[47, 137]),
    ('Terezinha', 'Terezinha', array[299, 300]),
    ('Tia Netinha', 'Tia Netinha', array[7, 36, 91, 147, 203, 276]),
    ('Ismaias', 'Ismaias', array[51]),
    ('Cleber.Vigilante', 'Cleber', array[135]),
    ('Junior. Primo', 'Junior', array[52]),
    ('Lídio', 'Lídio', array[136, 138]),
    ('Josué', 'Josué', array[11]),
    ('Esmael', 'Esmael', array[264, 274, 284, 294]),
    ('Rony (Vera)', 'Rony e Vera', array[13]),
    ('Valdelice', 'Valdelice', array[17, 139]),
    ('Leda', 'Leda', array[56]),
    ('Tio Toninho', 'Tio Toninho', array[125, 205, 224]),
    ('Silvia (boticario)', 'Silvia', array[16, 18]),
    ('Keké', 'Keké', array[186]),
    ('Margareth Qng 05', 'Margareth', array[228]),
    ('Robson', 'Robson', array[19]),
    ('Vanessa', 'Vanessa', array[126, 187]),
    ('Tica ( Marilene)', 'Marilene (Tica)', array[229]),
    ('Betinho', 'Betinho', array[273, 277]),
    ('Marciley', 'Marciley', array[23]),
    ('Nicivalda', 'Nicivalda', array[65]),
    ('Sonia QND', 'Sonia', array[76, 107]),
    ('Elizete', 'Elizete', array[66]),
    ('Zelito', 'Zelito', array[25]),
    ('Preto (Vagner)', 'Vagner', array[67, 70]),
    ('Mãe da Stefany', 'Mãe da Stefany', array[27]),
    ('Gerlucia', 'Gerlucia', array[69]),
    ('Eusenir ADV', 'Eusenir', array[28, 30]),
    ('Lilian Prima', 'Lilian', array[113]),
    ('Diolina Qng 08', 'Diolina', array[73]),
    ('Arlene', 'Arlene', array[74]),
    ('João QNG 26', 'João', array[77]),
    ('Pai da Iara', 'Pai da Iara', array[79]),
    ('Satoru', 'Satoru', array[168])
  ) as t(buyer_name, public_name, nums) loop
    insert into public.orders (buyer_name, public_name, numbers, amount, method, status, paid_at, notes)
    values (r.buyer_name, r.public_name, r.nums, cardinality(r.nums) * v_price, 'manual', 'paid',
            now(), 'Importado da planilha')
    returning id into v_id;
    update public.tickets set status = 'paid', order_id = v_id where number = any(r.nums);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- One-time step after creating your user in Authentication > Users:
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'YOUR_EMAIL';
-- ---------------------------------------------------------------------------
