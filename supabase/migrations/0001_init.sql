-- personal-brain-mcp initial schema.
-- All tables live under the `brain` schema to keep them isolated from
-- future business schemas (pts, rff) that may share this Supabase project.

create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";

create schema if not exists brain;

-- ============================================================
-- MEMORY  (journal entries, decisions, durable facts, gratitudes)
-- ============================================================
create table brain.memory (
  id           uuid primary key default uuid_generate_v4(),
  type         text not null check (type in ('journal','decision','fact','gratitude')),
  title        text,
  body         text not null,
  tags         text[] default '{}',
  mood         text,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  embedding    vector(1536)
);
create index memory_embedding_idx on brain.memory
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index memory_tags_idx on brain.memory using gin (tags);
create index memory_body_trgm_idx on brain.memory using gin (body gin_trgm_ops);
create index memory_type_idx on brain.memory (type);
create index memory_occurred_idx on brain.memory (occurred_at desc);

-- ============================================================
-- RECIPES
-- ============================================================
create table brain.recipes (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  cuisine       text,
  tags          text[] default '{}',
  ingredients   jsonb not null,
  steps         text[] not null,
  source_url    text,
  servings      int,
  prep_minutes  int,
  cook_minutes  int,
  last_made_at  date,
  rating        int check (rating between 1 and 5),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  embedding     vector(1536)
);
create index recipes_embedding_idx on brain.recipes
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index recipes_tags_idx on brain.recipes using gin (tags);
create index recipes_ingredients_idx on brain.recipes using gin (ingredients);
create index recipes_name_trgm_idx on brain.recipes using gin (name gin_trgm_ops);

-- ============================================================
-- PEOPLE  (family + close personal contacts)
-- ============================================================
create table brain.people (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  relationship    text,
  birthday        date,
  sizes           jsonb,
  allergies       text[] default '{}',
  interests       text[] default '{}',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index people_name_lower_idx on brain.people (lower(name));
create index people_name_trgm_idx on brain.people using gin (name gin_trgm_ops);

-- ============================================================
-- HOUSE PROJECTS
-- ============================================================
create table brain.house_projects (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  area         text,
  status       text not null default 'idea'
                check (status in ('idea','planned','in_progress','blocked','done')),
  priority     text check (priority in ('low','med','high')),
  budget_cents int,
  spent_cents  int default 0,
  contractor   text,
  next_step    text,
  notes        text,
  started_at   date,
  completed_at date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index house_projects_status_idx on brain.house_projects (status);
create index house_projects_area_idx on brain.house_projects (area);

-- ============================================================
-- GIFTS
-- ============================================================
create table brain.gifts (
  id          uuid primary key default uuid_generate_v4(),
  person_id   uuid references brain.people(id) on delete cascade,
  idea        text not null,
  occasion    text,
  status      text not null default 'idea'
                check (status in ('idea','bought','given','dropped')),
  cost_cents  int,
  given_at    date,
  notes       text,
  created_at  timestamptz not null default now()
);
create index gifts_person_status_idx on brain.gifts (person_id, status);

-- ============================================================
-- SHOPPING LIST
-- ============================================================
create table brain.shopping (
  id          uuid primary key default uuid_generate_v4(),
  item        text not null,
  category    text,
  quantity    text,
  status      text not null default 'open'
                check (status in ('open','bought','dropped')),
  added_at    timestamptz not null default now(),
  bought_at   timestamptz
);
create index shopping_status_idx on brain.shopping (status, category);

-- ============================================================
-- updated_at trigger (shared)
-- ============================================================
create or replace function brain.touch_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger memory_touch         before update on brain.memory          for each row execute function brain.touch_updated_at();
create trigger recipes_touch        before update on brain.recipes         for each row execute function brain.touch_updated_at();
create trigger people_touch         before update on brain.people          for each row execute function brain.touch_updated_at();
create trigger house_projects_touch before update on brain.house_projects  for each row execute function brain.touch_updated_at();

-- ============================================================
-- RPC: semantic memory search
-- ============================================================
create or replace function brain.search_memory(
  query_embedding vector(1536),
  match_count int default 10,
  filter_type text default null
)
returns table (
  id uuid,
  type text,
  title text,
  body text,
  tags text[],
  occurred_at timestamptz,
  similarity float
)
language sql stable
as $$
  select m.id, m.type, m.title, m.body, m.tags, m.occurred_at,
         1 - (m.embedding <=> query_embedding) as similarity
  from brain.memory m
  where (filter_type is null or m.type = filter_type)
    and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- RPC: semantic recipe search (optional ingredient filter)
-- ============================================================
create or replace function brain.search_recipes(
  query_embedding vector(1536),
  match_count int default 5,
  must_have text[] default null,
  exclude_ingredients text[] default null
)
returns table (
  id uuid,
  name text,
  cuisine text,
  tags text[],
  ingredients jsonb,
  steps text[],
  rating int,
  similarity float
)
language sql stable
as $$
  select r.id, r.name, r.cuisine, r.tags, r.ingredients, r.steps, r.rating,
         1 - (r.embedding <=> query_embedding) as similarity
  from brain.recipes r
  where r.embedding is not null
    and (must_have is null or (
      select bool_and(
        exists (
          select 1 from jsonb_array_elements(r.ingredients) ing
          where lower(ing->>'item') like '%' || lower(m) || '%'
        )
      )
      from unnest(must_have) m
    ))
    and (exclude_ingredients is null or not exists (
      select 1 from jsonb_array_elements(r.ingredients) ing
      where lower(ing->>'item') = any (
        select lower(x) from unnest(exclude_ingredients) x
      )
    ))
  order by r.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- Row Level Security (enabled, no policies yet — service role bypasses)
-- ============================================================
alter table brain.memory          enable row level security;
alter table brain.recipes         enable row level security;
alter table brain.people          enable row level security;
alter table brain.house_projects  enable row level security;
alter table brain.gifts           enable row level security;
alter table brain.shopping        enable row level security;
