-- ============================================================================
-- Pomocard MVP — Esquema Relacional (PostgreSQL / Supabase)
-- ============================================================================
-- Convenções:
--   * PKs em uuid (gen_random_uuid()) para evitar IDs sequenciais previsíveis.
--   * public.users estende auth.users (Supabase Auth / Google OAuth) 1:1.
--   * RLS habilitado em todas as tabelas com dados de usuário.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- GUILDS
-- ----------------------------------------------------------------------------
create table public.guilds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  banner_key  text,                         -- referência a asset pixel-art (bandeira da guilda)
  leader_id   uuid,                         -- FK adicionada após criação de public.users (ver abaixo)
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- USERS (perfil de jogo — 1:1 com auth.users do Supabase)
-- ----------------------------------------------------------------------------
create table public.users (
  id                     uuid primary key references auth.users(id) on delete cascade,
  username               text not null unique,
  avatar_key             text,              -- id do sprite/avatar pixel-art escolhido
  guild_id               uuid references public.guilds(id) on delete set null,

  -- Economia / progressão. Nomes de coluna preservados por compatibilidade com dados já
  -- gravados: no app (camada TS), `mana` é a moeda de recompensa e é exibida como "Gold";
  -- `stamina_reset_on`/minutes_focused_today alimentam o recurso "Mana" (o limitador diário
  -- de foco, antigo "Stamina") — ver o comentário no topo de player-state.service.ts.
  mana                   integer not null default 0 check (mana >= 0),
  xp                     integer not null default 0 check (xp >= 0),
  level                  integer not null default 1 check (level >= 1),

  -- Mana diária (regra Anti-Burnout — reseta por dia)
  minutes_focused_today  integer not null default 0 check (minutes_focused_today >= 0),
  stamina_reset_on       date not null default current_date,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.guilds
  add constraint guilds_leader_fk
  foreign key (leader_id) references public.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- PERFIL AUTOMÁTICO NO LOGIN (Google OAuth via Supabase Auth)
-- Cria a linha em public.users assim que um novo usuário é criado em
-- auth.users pelo fluxo de OAuth do Supabase.
-- Nota: para o beta de 20 usuários, o username inicial (derivado do e-mail
-- ou nome do Google) pode colidir; o usuário pode ajustá-lo depois. Uma
-- estratégia de sufixo automático pode ser adicionada na expansão pós-beta.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, username, avatar_key)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- DECKS
-- ----------------------------------------------------------------------------
create table public.decks (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.users(id) on delete cascade,
  title              text not null,
  description        text,
  is_public          boolean not null default false,   -- decks públicos podem ser clonados
  cloned_from_deck_id uuid references public.decks(id) on delete set null,
  mana_clone_cost    integer not null default 50 check (mana_clone_cost >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- FLASHCARDS (inclui metadados do algoritmo SM-2)
-- ----------------------------------------------------------------------------
create table public.flashcards (
  id               uuid primary key default gen_random_uuid(),
  deck_id          uuid not null references public.decks(id) on delete cascade,
  front_text       text not null,
  back_text        text not null,
  image_key        text,

  -- Metadados SM-2 (SuperMemo 2)
  easiness_factor  numeric(4,2) not null default 2.50 check (easiness_factor >= 1.30),
  interval_days    integer not null default 0 check (interval_days >= 0),
  repetitions      integer not null default 0 check (repetitions >= 0),
  next_review_at   timestamptz not null default now(),
  last_reviewed_at timestamptz,
  last_quality     smallint check (last_quality between 0 and 5), -- última nota SM-2 (0=blackout .. 5=perfeito)

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- POMODORO_SESSIONS (sessão de foco -> origem da criação de flashcards)
-- ----------------------------------------------------------------------------
create table public.pomodoro_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  duration_minutes integer not null check (duration_minutes > 0),
  flashcard_id     uuid references public.flashcards(id) on delete set null, -- carta criada ao fim do timer
  mana_earned      integer not null default 0 check (mana_earned >= 0),
  xp_earned        integer not null default 0 check (xp_earned >= 0),
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- CARD_REVIEWS (log de cada revisão SM-2 — "Boss Battle" de cartas difíceis)
-- ----------------------------------------------------------------------------
create table public.card_reviews (
  id                     uuid primary key default gen_random_uuid(),
  flashcard_id           uuid not null references public.flashcards(id) on delete cascade,
  user_id                uuid not null references public.users(id) on delete cascade,
  quality                smallint not null check (quality between 0 and 5),
  easiness_factor_after  numeric(4,2) not null,
  interval_days_after    integer not null,
  mana_earned            integer not null default 0 check (mana_earned >= 0),
  reviewed_at            timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ÍNDICES
-- ----------------------------------------------------------------------------
create index idx_users_guild_id            on public.users (guild_id);
create index idx_decks_owner_id            on public.decks (owner_id);
create index idx_decks_public              on public.decks (is_public) where is_public = true;
create index idx_flashcards_deck_id        on public.flashcards (deck_id);
create index idx_flashcards_next_review    on public.flashcards (next_review_at);
create index idx_pomodoro_sessions_user_id on public.pomodoro_sessions (user_id, started_at desc);
create index idx_card_reviews_user_id      on public.card_reviews (user_id, reviewed_at desc);
create index idx_card_reviews_flashcard_id on public.card_reviews (flashcard_id);

-- ----------------------------------------------------------------------------
-- VIEW: ranking de consistência por guilda (últimos 7 dias)
-- ----------------------------------------------------------------------------
create view public.guild_consistency_rankings as
select
  u.guild_id,
  u.id                              as user_id,
  u.username,
  count(distinct ps.id)             as sessions_last_7d,
  coalesce(sum(ps.duration_minutes), 0) as minutes_last_7d,
  count(distinct date_trunc('day', ps.started_at)) as active_days_last_7d
from public.users u
left join public.pomodoro_sessions ps
  on ps.user_id = u.id
 and ps.started_at >= now() - interval '7 days'
where u.guild_id is not null
group by u.guild_id, u.id, u.username
order by u.guild_id, active_days_last_7d desc, minutes_last_7d desc;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.users             enable row level security;
alter table public.guilds            enable row level security;
alter table public.decks             enable row level security;
alter table public.flashcards        enable row level security;
alter table public.pomodoro_sessions enable row level security;
alter table public.card_reviews      enable row level security;

-- users: qualquer usuário autenticado pode ler perfis (ranking/guilda), mas só edita o próprio
create policy users_select_all on public.users
  for select using (auth.role() = 'authenticated');
create policy users_update_own on public.users
  for update using (auth.uid() = id);

-- guilds: leitura pública para autenticados; só o líder edita
create policy guilds_select_all on public.guilds
  for select using (auth.role() = 'authenticated');
create policy guilds_update_leader on public.guilds
  for update using (auth.uid() = leader_id);

-- decks: dono tem CRUD total; decks públicos são visíveis para todos (necessário para clonagem)
create policy decks_select_own_or_public on public.decks
  for select using (auth.uid() = owner_id or is_public = true);
create policy decks_insert_own on public.decks
  for insert with check (auth.uid() = owner_id);
create policy decks_update_own on public.decks
  for update using (auth.uid() = owner_id);
create policy decks_delete_own on public.decks
  for delete using (auth.uid() = owner_id);

-- flashcards: acesso segue o dono do deck (ou deck público em modo leitura)
create policy flashcards_select on public.flashcards
  for select using (
    exists (
      select 1 from public.decks d
      where d.id = flashcards.deck_id
        and (d.owner_id = auth.uid() or d.is_public = true)
    )
  );
create policy flashcards_write on public.flashcards
  for all using (
    exists (
      select 1 from public.decks d
      where d.id = flashcards.deck_id and d.owner_id = auth.uid()
    )
  );

-- pomodoro_sessions / card_reviews: estritamente privados ao próprio usuário
create policy pomodoro_sessions_own on public.pomodoro_sessions
  for all using (auth.uid() = user_id);
create policy card_reviews_own on public.card_reviews
  for all using (auth.uid() = user_id);
