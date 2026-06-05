-- v0.3: memory architecture overhaul + full personal-assistant scope.
-- Applies cleanly on top of 0001 + 0002.

-- ============================================================
-- LAYER 1: IDENTITY  (single-row, hand-maintained, always-loaded)
-- ============================================================
create table brain.identity (
  id                  int primary key default 1 check (id = 1),
  legal_name          text,
  preferred_name      text,
  pronouns            text,
  birthday            date,
  birthplace          text,
  primary_email       text,
  primary_phone       text,
  primary_address     text,
  timezone            text default 'America/New_York',
  languages           text[] default '{}',
  blood_type          text,
  core_values         text[] default '{}',
  beliefs             text,
  voice_rules         text,                  -- "no em dashes, no emoji, lowercase headers"
  extras              jsonb default '{}',    -- flexible long-tail
  updated_at          timestamptz not null default now()
);
-- Seed the singleton row so `update_identity` can just upsert(id=1).
insert into brain.identity (id) values (1);

-- ============================================================
-- LAYER 4: FACTS  (semantic, durable, subject-predicate-object)
-- ============================================================
create table brain.facts (
  id           uuid primary key default uuid_generate_v4(),
  subject      text not null,             -- 'user','spouse','child:Sam','self','family_member'
  predicate    text not null,             -- 'allergic_to','prefers','dislikes','lives_in'
  object       text not null,             -- the value
  confidence   numeric default 1.0 check (confidence between 0 and 1),
  source       text,                      -- 'self_reported','observed','derived_from_memory:<uuid>'
  source_memory_id uuid references brain.memory(id) on delete set null,
  context      text,                      -- free-text nuance
  active       boolean not null default true,
  superseded_by uuid references brain.facts(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  embedding    vector(1536)
);
create index facts_subject_idx       on brain.facts (lower(subject));
create index facts_predicate_idx     on brain.facts (predicate);
create index facts_active_idx        on brain.facts (active);
create index facts_embedding_idx     on brain.facts using ivfflat (embedding vector_cosine_ops) with (lists = 50);
create index facts_subject_trgm_idx  on brain.facts using gin (subject gin_trgm_ops);

-- Backfill: promote any existing brain.memory rows with type='fact'
-- into brain.facts. Best-effort heuristic: title → predicate, body → object.
insert into brain.facts (subject, predicate, object, source, source_memory_id, context, created_at)
select
  coalesce(nullif(split_part(m.title, ':', 1), ''), 'you') as subject,
  coalesce(nullif(split_part(m.title, ':', 2), ''), 'note') as predicate,
  m.body as object,
  'derived_from_memory:' || m.id as source,
  m.id,
  array_to_string(m.tags, ', '),
  m.created_at
from brain.memory m
where m.type = 'fact';

-- Mark the original memory rows as archived so they don't show up in
-- episodic searches, but stay around for audit.
alter table brain.memory add column if not exists archived boolean not null default false;
update brain.memory set archived = true where type = 'fact';

-- Make sure search_memory excludes archived rows.
create or replace function brain.search_memory(
  query_embedding vector(1536),
  match_count int default 10,
  filter_type text default null
)
returns table (
  id uuid, type text, title text, body text, tags text[],
  occurred_at timestamptz, similarity float
)
language sql stable
as $$
  select m.id, m.type, m.title, m.body, m.tags, m.occurred_at,
         1 - (m.embedding <=> query_embedding) as similarity
  from brain.memory m
  where (filter_type is null or m.type = filter_type)
    and m.embedding is not null
    and m.archived = false
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- RPC: semantic facts search
create or replace function brain.search_facts(
  query_embedding vector(1536),
  match_count int default 20,
  filter_subject text default null
)
returns table (
  id uuid, subject text, predicate text, object text,
  confidence numeric, context text, similarity float
)
language sql stable
as $$
  select f.id, f.subject, f.predicate, f.object, f.confidence, f.context,
         1 - (f.embedding <=> query_embedding) as similarity
  from brain.facts f
  where f.active = true
    and f.embedding is not null
    and (filter_subject is null or lower(f.subject) = lower(filter_subject))
  order by f.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- PETS
-- ============================================================
create table brain.pets (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  species         text,                    -- 'dog','cat','fish','horse'
  breed           text,
  sex             text,
  birthday        date,
  acquired_at     date,
  microchip       text,
  color           text,
  weight_lb       numeric,
  vet_provider_id uuid references brain.providers(id) on delete set null,
  food_brand      text,
  food_notes      text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index pets_active_idx on brain.pets (active);

create table brain.pet_health_events (
  id          uuid primary key default uuid_generate_v4(),
  pet_id      uuid references brain.pets(id) on delete cascade,
  occurred_at date not null,
  kind        text not null,               -- 'vaccine','vet_visit','meds','weight','grooming','incident'
  description text,
  cost_cents  int,
  vendor      text,
  next_due_at date,
  notes       text,
  created_at  timestamptz not null default now()
);
create index pet_health_events_pet_idx on brain.pet_health_events (pet_id, occurred_at desc);
create index pet_health_events_due_idx on brain.pet_health_events (next_due_at) where next_due_at is not null;

-- ============================================================
-- VEHICLES
-- ============================================================
create table brain.vehicles (
  id              uuid primary key default uuid_generate_v4(),
  nickname        text,                    -- 'truck','wife car','mower'
  year            int,
  make            text,
  model           text,
  trim            text,
  vin             text,
  license_plate   text,
  state_registered text,
  color           text,
  current_mileage int,
  acquired_at     date,
  acquired_price_cents int,
  fuel_type       text,                    -- 'gas','diesel','electric','hybrid'
  insurance_carrier text,
  insurance_policy text,
  insurance_renews_at date,
  registration_renews_at date,
  inspection_due_at date,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index vehicles_active_idx on brain.vehicles (active);
create index vehicles_insurance_renews_idx on brain.vehicles (insurance_renews_at) where active = true;
create index vehicles_registration_renews_idx on brain.vehicles (registration_renews_at) where active = true;

create table brain.vehicle_service_history (
  id             uuid primary key default uuid_generate_v4(),
  vehicle_id     uuid references brain.vehicles(id) on delete cascade,
  performed_at   date not null,
  service_type   text,                     -- 'oil_change','tires','brakes','registration','inspection','repair'
  mileage_at_service int,
  cost_cents     int,
  vendor         text,
  next_due_mileage int,
  next_due_at    date,
  notes          text,
  created_at     timestamptz not null default now()
);
create index vehicle_service_vehicle_idx on brain.vehicle_service_history (vehicle_id, performed_at desc);

-- ============================================================
-- PROPERTIES  (homes, cabin, parents', regular stays)
-- ============================================================
create table brain.properties (
  id             uuid primary key default uuid_generate_v4(),
  nickname       text not null,            -- 'home','cabin','parents','lake house'
  address        text,
  city           text,
  state          text,
  postal_code    text,
  country        text default 'US',
  property_type  text,                     -- 'primary','secondary','rental','family','airbnb_regular'
  owned          boolean default true,
  square_feet    int,
  bedrooms       int,
  bathrooms      numeric,
  acquired_at    date,
  purchase_price_cents int,
  mortgage_lender text,
  utility_accounts jsonb default '{}',     -- {electric:{provider, account_no}, water:{...}}
  wifi_ssid      text,
  wifi_password_hint text,                 -- hint only, real password elsewhere
  smart_home_hub text,                     -- 'HomeKit','Home Assistant','SmartThings'
  notes          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index properties_active_idx on brain.properties (active);

-- ============================================================
-- DOCUMENTS  (general: warranties, manuals, contracts, IDs, titles, etc.)
-- absorbs property docs; tax_documents stays separate (annual cycle)
-- ============================================================
create table brain.documents (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  category      text not null,             -- 'id','insurance','vehicle_title','property_deed','manual','warranty','contract','medical','legal','school','other'
  subject       text,                      -- 'you','wife','pet:Buddy','home','truck'
  issuer        text,
  doc_number    text,                      -- policy #, doc #, account #
  issued_at     date,
  expires_at    date,
  location      text not null,             -- 'OneDrive: ...', 'fireproof safe', 'attorney office'
  digital_copy_url text,
  amount_cents  int,
  related_property_id uuid references brain.properties(id) on delete set null,
  related_vehicle_id uuid references brain.vehicles(id) on delete set null,
  related_person_id uuid references brain.people(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index documents_category_idx on brain.documents (category);
create index documents_expires_idx on brain.documents (expires_at) where expires_at is not null;
create index documents_subject_trgm_idx on brain.documents using gin (subject gin_trgm_ops);

-- ============================================================
-- ANNIVERSARIES  (general repeating dates beyond birthdays)
-- ============================================================
create table brain.anniversaries (
  id          uuid primary key default uuid_generate_v4(),
  label       text not null,                -- 'Wedding anniversary','Met Sarah','Mom died'
  occurs_on   date not null,                -- original date; year matters for some
  kind        text,                         -- 'wedding','met','death','milestone','founding'
  involves    text[],                       -- ['you','wife']
  recurring   boolean not null default true,
  active      boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);
create index anniversaries_occurs_idx on brain.anniversaries (occurs_on);

-- ============================================================
-- WISHLIST  (things you wants — distinct from bucket_list experiences)
-- ============================================================
create table brain.wishlist (
  id             uuid primary key default uuid_generate_v4(),
  item           text not null,
  category       text,                      -- 'gear','tech','book','clothing','experience','household'
  price_cents    int,
  priority       text check (priority in ('low','med','high')),
  url            text,
  occasion_hint  text,                      -- 'birthday','christmas','anytime'
  status         text not null default 'open' check (status in ('open','received','dropped','purchased_self')),
  received_at    date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index wishlist_status_idx on brain.wishlist (status);

-- ============================================================
-- EMERGENCY / IN-CASE-OF
-- ============================================================
create table brain.emergency_info (
  id           uuid primary key default uuid_generate_v4(),
  category     text not null,               -- 'medical','contact','access','legal','financial','instructions'
  label        text not null,               -- 'Spare house key','POA holder','Will location'
  detail       text not null,
  who_to_call  text,
  phone        text,
  sensitive    boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index emergency_info_category_idx on brain.emergency_info (category);

-- ============================================================
-- ROUTINES & CHECKLISTS  (event-invoked, not date-driven)
-- ============================================================
create table brain.routines (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,               -- 'Morning','Leaving for trip','Closing cabin'
  trigger_kind text,                        -- 'time_of_day','event','seasonal','manual'
  description  text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table brain.routine_steps (
  id          uuid primary key default uuid_generate_v4(),
  routine_id  uuid references brain.routines(id) on delete cascade,
  step_order  int not null,
  step        text not null,
  optional    boolean not null default false,
  notes       text,
  unique (routine_id, step_order)
);
create index routine_steps_routine_idx on brain.routine_steps (routine_id, step_order);

-- ============================================================
-- PROFESSIONAL RELATIONSHIPS  (accountant, attorney, advisor, agent)
-- distinct from `providers` (medical) and `personal_contacts` (social)
-- ============================================================
create table brain.professional_relationships (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  role          text not null,              -- 'accountant','attorney','financial_advisor','insurance_agent','realtor','banker','tax_preparer'
  firm          text,
  email         text,
  phone         text,
  address       text,
  retainer_status text,                     -- 'on_retainer','project_basis','prior'
  last_meeting_at date,
  next_review_at date,
  for_entity    text,                       -- 'personal','{{ORG_A}}','{{ORG_B}}','all'
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index professional_relationships_role_idx on brain.professional_relationships (role) where active = true;

-- ============================================================
-- FINANCIAL ACCOUNTS DIRECTORY  (existence, not balances)
-- ============================================================
create table brain.financial_accounts (
  id              uuid primary key default uuid_generate_v4(),
  nickname        text not null,             -- 'Chase Checking','Vanguard 401k'
  institution     text not null,
  account_type    text,                      -- 'checking','savings','credit','brokerage','retirement','hsa','529'
  account_number_last4 text,
  routing_number  text,
  owner           text,                      -- 'you','wife','joint','{{ORG_A}}','{{ORG_B}}'
  beneficiary     text,
  login_portal    text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index financial_accounts_type_idx on brain.financial_accounts (account_type) where active = true;

-- ============================================================
-- PERSONAL PROJECTS  (self-improvement, hobbies, learning)
-- distinct from house_projects (physical) and business projects
-- ============================================================
create table brain.personal_projects (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,                -- 'Learn Spanish','Write the book','Garden expansion'
  category     text,                         -- 'learning','creative','fitness','hobby','side_project'
  status       text not null default 'active'
                 check (status in ('planned','active','paused','done','dropped')),
  why          text,
  target_date  date,
  next_step    text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index personal_projects_status_idx on brain.personal_projects (status);

-- ============================================================
-- ADD COMMUNICATION PREFS to existing contact tables
-- ============================================================
alter table brain.personal_contacts add column if not exists comm_prefs jsonb default '{}';
alter table brain.people add column if not exists comm_prefs jsonb default '{}';

-- ============================================================
-- WEEKLY SUMMARIES (memory consolidation — rolled up by cron)
-- ============================================================
create table brain.weekly_summaries (
  id            uuid primary key default uuid_generate_v4(),
  week_starts   date not null unique,
  summary       text not null,
  themes        text[] default '{}',
  decision_count int default 0,
  journal_count int default 0,
  workout_count int default 0,
  embedding     vector(1536),
  created_at    timestamptz not null default now()
);
create index weekly_summaries_starts_idx on brain.weekly_summaries (week_starts desc);
create index weekly_summaries_embedding_idx on brain.weekly_summaries
  using ivfflat (embedding vector_cosine_ops) with (lists = 25);

-- ============================================================
-- EXTEND upcoming_dates VIEW with new sources
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
  select 'anniversary', a.label, array_to_string(a.involves, ', '),
         case when a.recurring
              then make_date(extract(year from current_date)::int + case
                     when (date_part('doy', current_date) > date_part('doy', a.occurs_on)) then 1 else 0 end,
                     extract(month from a.occurs_on)::int,
                     extract(day from a.occurs_on)::int)
              else a.occurs_on end
  from brain.anniversaries a where a.active
  union all
  select 'maintenance', m.name, m.vendor, m.next_due_at
  from brain.maintenance_tasks m where m.active and m.next_due_at is not null
  union all
  select 'warranty_expires', h.name, h.brand, h.warranty_until
  from brain.home_inventory h where h.warranty_until is not null
  union all
  select 'document_expires', d.name, d.category, d.expires_at
  from brain.documents d where d.expires_at is not null
  union all
  select 'vehicle_registration', v.nickname, v.make || ' ' || v.model, v.registration_renews_at
  from brain.vehicles v where v.active and v.registration_renews_at is not null
  union all
  select 'vehicle_insurance', v.nickname, v.insurance_carrier, v.insurance_renews_at
  from brain.vehicles v where v.active and v.insurance_renews_at is not null
  union all
  select 'vehicle_inspection', v.nickname, v.make || ' ' || v.model, v.inspection_due_at
  from brain.vehicles v where v.active and v.inspection_due_at is not null
  union all
  select 'pet_health_due', pt.name, ph.kind, ph.next_due_at
  from brain.pet_health_events ph
  join brain.pets pt on pt.id = ph.pet_id
  where ph.next_due_at is not null and pt.active
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
  select 'pro_review', prr.name, prr.role, prr.next_review_at
  from brain.professional_relationships prr where prr.active and prr.next_review_at is not null
  union all
  select 'contact_followup', pc.name, ci.summary, ci.next_followup
  from brain.contact_interactions ci
  join brain.personal_contacts pc on pc.id = ci.contact_id
  where ci.next_followup is not null;

-- ============================================================
-- RLS + updated_at triggers for new tables
-- ============================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'brain'
    and tablename not in (
      'memory','recipes','people','house_projects','gifts','shopping',
      'home_inventory','maintenance_tasks','maintenance_history','household_expenses',
      'meal_plan','pantry','dietary_prefs','personal_contacts','contact_interactions',
      'trips','packing_templates','health_metrics','workouts','medications','providers',
      'reading_list','content_queue','subscriptions','tax_documents','bucket_list'
    )
  loop
    execute format('alter table brain.%I enable row level security', t);
  end loop;
end $$;

do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
    where c.table_schema = 'brain' and c.column_name = 'updated_at'
      and c.table_name in ('identity','facts','pets','vehicles','properties','documents',
                           'wishlist','emergency_info','routines','professional_relationships',
                           'financial_accounts','personal_projects')
  loop
    execute format(
      'create trigger %I before update on brain.%I for each row execute function brain.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;
