-- v0.2: full personal-life scope.
-- Adds 16 new tables + supporting types and indexes. Safe to apply on
-- top of 0001_init.sql.

-- ============================================================
-- HOME INVENTORY  (appliances, paint, filters, model numbers)
-- ============================================================
create table brain.home_inventory (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  category        text,                    -- 'appliance','paint','filter','tool','electronics','furniture'
  area            text,                    -- 'kitchen','garage','HVAC closet', etc.
  brand           text,
  model_number    text,
  serial_number   text,
  purchased_at    date,
  purchase_price_cents int,
  vendor          text,
  warranty_until  date,
  warranty_notes  text,
  attrs           jsonb default '{}',      -- flexible: filter_size, paint_code, voltage…
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index home_inventory_category_idx on brain.home_inventory (category);
create index home_inventory_name_trgm_idx on brain.home_inventory using gin (name gin_trgm_ops);
create index home_inventory_warranty_idx on brain.home_inventory (warranty_until)
  where warranty_until is not null;

-- ============================================================
-- MAINTENANCE SCHEDULE  (HVAC, septic, gutters, vehicles, etc.)
-- ============================================================
create table brain.maintenance_tasks (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,           -- 'HVAC filter change','Septic pump'
  asset_id        uuid references brain.home_inventory(id) on delete set null,
  interval_days   int,                     -- recurring every N days; null = one-off
  last_done_at    date,
  next_due_at     date,
  vendor          text,
  cost_cents      int,                     -- typical cost
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index maintenance_due_idx on brain.maintenance_tasks (next_due_at)
  where active = true;

create table brain.maintenance_history (
  id              uuid primary key default uuid_generate_v4(),
  task_id         uuid references brain.maintenance_tasks(id) on delete cascade,
  performed_at    date not null,
  cost_cents      int,
  vendor          text,
  notes           text,
  created_at      timestamptz not null default now()
);
create index maintenance_history_task_idx on brain.maintenance_history (task_id, performed_at desc);

-- ============================================================
-- HOUSEHOLD EXPENSES  (broad — includes house projects, groceries, utilities)
-- ============================================================
create table brain.household_expenses (
  id              uuid primary key default uuid_generate_v4(),
  category        text not null,           -- 'house_project','grocery','utility','maintenance','other'
  subcategory     text,
  amount_cents    int not null,
  vendor          text,
  description     text,
  occurred_at     date not null default current_date,
  project_id      uuid references brain.house_projects(id) on delete set null,
  maintenance_id  uuid references brain.maintenance_tasks(id) on delete set null,
  attrs           jsonb default '{}',
  created_at      timestamptz not null default now()
);
create index household_expenses_occurred_idx on brain.household_expenses (occurred_at desc);
create index household_expenses_category_idx on brain.household_expenses (category, subcategory);

-- ============================================================
-- MEAL PLAN  (one row per (date, slot))
-- ============================================================
create table brain.meal_plan (
  id            uuid primary key default uuid_generate_v4(),
  plan_date     date not null,
  slot          text not null check (slot in ('breakfast','lunch','dinner','snack')),
  recipe_id     uuid references brain.recipes(id) on delete set null,
  freeform      text,                      -- "leftovers", "pizza out", etc.
  notes         text,
  created_at    timestamptz not null default now(),
  unique (plan_date, slot)
);
create index meal_plan_date_idx on brain.meal_plan (plan_date);

-- ============================================================
-- PANTRY
-- ============================================================
create table brain.pantry (
  id            uuid primary key default uuid_generate_v4(),
  item          text not null,
  category      text,                      -- 'protein','grain','spice','canned','frozen','dairy','produce'
  quantity      text,
  location      text,                      -- 'pantry','fridge','freezer','spice rack'
  expires_at    date,
  notes         text,
  added_at      timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index pantry_item_trgm_idx on brain.pantry using gin (item gin_trgm_ops);
create index pantry_expires_idx on brain.pantry (expires_at) where expires_at is not null;

-- ============================================================
-- DIETARY PREFERENCES  (per person; references brain.people)
-- ============================================================
create table brain.dietary_prefs (
  id            uuid primary key default uuid_generate_v4(),
  person_id     uuid references brain.people(id) on delete cascade,
  kind          text not null check (kind in ('allergy','dislike','prefers','restriction')),
  item          text not null,             -- 'peanuts','cilantro','gluten','vegetarian'
  severity      text,                      -- 'mild','severe','life_threatening' (for allergies)
  notes         text,
  created_at    timestamptz not null default now()
);
create index dietary_prefs_person_idx on brain.dietary_prefs (person_id);

-- ============================================================
-- PERSONAL CONTACTS  (friends, neighbors, extended family — NOT a CRM)
-- ============================================================
create table brain.personal_contacts (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  relationship    text,                    -- 'friend','neighbor','cousin','college friend'
  email           text,
  phone           text,
  city            text,
  state           text,
  birthday        date,
  spouse          text,
  kids            jsonb,                   -- [{name, age_or_birthday}]
  pets            jsonb,                   -- [{name, species}]
  context         text,                    -- "their dog's name is Biscuit, kid started college"
  tags            text[] default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index personal_contacts_name_trgm_idx on brain.personal_contacts using gin (name gin_trgm_ops);
create index personal_contacts_tags_idx on brain.personal_contacts using gin (tags);

create table brain.contact_interactions (
  id              uuid primary key default uuid_generate_v4(),
  contact_id      uuid references brain.personal_contacts(id) on delete cascade,
  occurred_at     timestamptz not null default now(),
  channel         text,                    -- 'text','call','in_person','email','social'
  direction       text check (direction in ('inbound','outbound','mutual')),
  summary         text,
  next_followup   date,
  created_at      timestamptz not null default now()
);
create index contact_interactions_contact_idx on brain.contact_interactions (contact_id, occurred_at desc);
create index contact_interactions_followup_idx on brain.contact_interactions (next_followup) where next_followup is not null;

-- ============================================================
-- TRIPS  (personal travel only)
-- ============================================================
create table brain.trips (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  destination   text,
  country       text,
  start_date    date,
  end_date      date,
  trip_type     text,                      -- 'beach','city','road_trip','ski','family','solo','couple'
  companions    text[] default '{}',
  highlights    text,
  lowlights     text,
  rating        int check (rating between 1 and 5),
  total_cost_cents int,
  notes         text,
  created_at    timestamptz not null default now()
);
create index trips_dates_idx on brain.trips (start_date desc);

create table brain.packing_templates (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,             -- 'beach week','ski weekend','business trip'
  trip_type     text,
  items         jsonb not null,            -- [{item, category, optional, notes}]
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- HEALTH  (ingested from iPhone Shortcut or wearable webhook)
-- ============================================================
create table brain.health_metrics (
  id            uuid primary key default uuid_generate_v4(),
  recorded_at   timestamptz not null,
  metric        text not null,             -- 'weight_lb','sleep_hours','resting_hr','steps','hrv_ms'
  value         numeric not null,
  source        text,                      -- 'apple_health','manual','garmin','oura'
  notes         text,
  created_at    timestamptz not null default now()
);
create index health_metrics_metric_time_idx on brain.health_metrics (metric, recorded_at desc);

create table brain.workouts (
  id            uuid primary key default uuid_generate_v4(),
  performed_at  timestamptz not null default now(),
  activity      text not null,             -- 'run','lift','bike','yoga','walk'
  duration_min  int,
  distance_mi   numeric,
  calories      int,
  intensity     text,                      -- 'easy','moderate','hard'
  notes         text,
  source        text,                      -- 'manual','apple_watch','strava'
  created_at    timestamptz not null default now()
);
create index workouts_time_idx on brain.workouts (performed_at desc);

create table brain.medications (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid references brain.people(id) on delete cascade,
  name            text not null,
  dosage          text,                    -- '10mg', '1 tab'
  frequency       text,                    -- 'daily morning','BID','PRN'
  prescriber      text,
  pharmacy        text,
  rx_number       text,
  started_at      date,
  ended_at        date,
  refill_due_at   date,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index medications_person_idx on brain.medications (person_id) where active = true;
create index medications_refill_idx on brain.medications (refill_due_at) where active = true;

create table brain.providers (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  specialty     text,                      -- 'pcp','dentist','vet','optometrist','pediatrician'
  for_person    text,                      -- 'all','you','wife','kids','pet'
  practice      text,
  phone         text,
  address       text,
  portal_url    text,
  next_visit_at date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index providers_specialty_idx on brain.providers (specialty);

-- ============================================================
-- READING LIST + CONTENT QUEUE
-- ============================================================
create table brain.reading_list (
  id            uuid primary key default uuid_generate_v4(),
  title         text not null,
  author        text,
  kind          text not null default 'book' check (kind in ('book','article','paper','essay')),
  url           text,
  status        text not null default 'to_read'
                  check (status in ('to_read','reading','finished','abandoned')),
  added_at      timestamptz not null default now(),
  started_at    date,
  finished_at   date,
  rating        int check (rating between 1 and 5),
  notes         text,
  tags          text[] default '{}'
);
create index reading_list_status_idx on brain.reading_list (status, added_at desc);

create table brain.content_queue (
  id            uuid primary key default uuid_generate_v4(),
  title         text not null,
  kind          text not null check (kind in ('video','podcast','article','newsletter')),
  url           text,
  source        text,                      -- 'youtube','spotify','apple_podcasts'
  duration_min  int,
  status        text not null default 'queued' check (status in ('queued','watched','dropped')),
  added_at      timestamptz not null default now(),
  watched_at    timestamptz,
  tags          text[] default '{}'
);
create index content_queue_status_idx on brain.content_queue (status, added_at desc);

-- ============================================================
-- PERSONAL FINANCE  (lightweight — no transactions)
-- ============================================================
create table brain.subscriptions (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  category        text,                    -- 'streaming','saas','utility','membership','news'
  amount_cents    int not null,
  cadence         text not null check (cadence in ('monthly','quarterly','annual','weekly')),
  renews_on       date,
  payment_method  text,                    -- last 4 digits or label
  url             text,
  active          boolean not null default true,
  cancelled_at    date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index subscriptions_active_idx on brain.subscriptions (active, renews_on);

create table brain.tax_documents (
  id            uuid primary key default uuid_generate_v4(),
  tax_year      int not null,
  doc_type      text not null,             -- 'W-2','1099','K-1','receipt','charity','mortgage'
  source        text,                      -- 'employer','broker','bank'
  location      text,                      -- 'OneDrive: Personal/Tax/2025','file cabinet drawer 2'
  amount_cents  int,
  received_at   date,
  notes         text,
  created_at    timestamptz not null default now()
);
create index tax_documents_year_idx on brain.tax_documents (tax_year);

-- ============================================================
-- BUCKET LIST  (life goals, separate from business OKRs)
-- ============================================================
create table brain.bucket_list (
  id            uuid primary key default uuid_generate_v4(),
  goal          text not null,
  category      text,                      -- 'travel','skill','experience','family','health'
  status        text not null default 'someday'
                  check (status in ('someday','planning','in_progress','done','dropped')),
  target_year   int,
  why           text,
  notes         text,
  completed_at  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index bucket_list_status_idx on brain.bucket_list (status);

-- ============================================================
-- HELPER VIEW: unified upcoming dates
-- ============================================================
create or replace view brain.upcoming_dates as
  select 'birthday'::text as kind, p.name as label, p.relationship as detail,
         make_date(extract(year from current_date)::int + case
           when (date_part('doy', current_date) > date_part('doy', p.birthday)) then 1 else 0 end,
           extract(month from p.birthday)::int,
           extract(day from p.birthday)::int) as due_date
  from brain.people p where p.birthday is not null
  union all
  select 'birthday', pc.name, pc.relationship,
         make_date(extract(year from current_date)::int + case
           when (date_part('doy', current_date) > date_part('doy', pc.birthday)) then 1 else 0 end,
           extract(month from pc.birthday)::int,
           extract(day from pc.birthday)::int)
  from brain.personal_contacts pc where pc.birthday is not null
  union all
  select 'maintenance', m.name, m.vendor, m.next_due_at
  from brain.maintenance_tasks m where m.active and m.next_due_at is not null
  union all
  select 'warranty_expires', h.name, h.brand, h.warranty_until
  from brain.home_inventory h where h.warranty_until is not null
  union all
  select 'medication_refill', med.name, med.frequency, med.refill_due_at
  from brain.medications med where med.active and med.refill_due_at is not null
  union all
  select 'subscription_renews', s.name, s.category, s.renews_on
  from brain.subscriptions s where s.active and s.renews_on is not null
  union all
  select 'trip_departs', t.name, t.destination, t.start_date
  from brain.trips t where t.start_date is not null and t.start_date >= current_date
  union all
  select 'provider_visit', pr.name, pr.specialty, pr.next_visit_at
  from brain.providers pr where pr.next_visit_at is not null
  union all
  select 'contact_followup', pc.name, ci.summary, ci.next_followup
  from brain.contact_interactions ci
  join brain.personal_contacts pc on pc.id = ci.contact_id
  where ci.next_followup is not null;

-- ============================================================
-- RLS for new tables
-- ============================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'brain'
    and tablename not in ('memory','recipes','people','house_projects','gifts','shopping')
  loop
    execute format('alter table brain.%I enable row level security', t);
  end loop;
end $$;

-- ============================================================
-- updated_at triggers for new tables that have the column
-- ============================================================
do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
    where c.table_schema = 'brain' and c.column_name = 'updated_at'
      and c.table_name in ('home_inventory','maintenance_tasks','pantry',
                           'personal_contacts','packing_templates',
                           'medications','providers','subscriptions','bucket_list')
  loop
    execute format(
      'create trigger %I before update on brain.%I for each row execute function brain.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;
