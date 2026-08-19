-- ============================================================================
-- Acompanhamento de Alunos - schema Supabase / Postgres
-- Rode este arquivo inteiro em: Supabase > SQL Editor > New query > Run
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ALUNOS
-- ---------------------------------------------------------------------------
create table if not exists students (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  start_date  date not null default current_date,
  contact     text,
  -- aula semanal fixa: 0 = domingo ... 6 = sabado
  weekday     smallint check (weekday between 0 and 6),
  class_time  time,
  status      text not null default 'ativo'
              check (status in ('ativo', 'pausado', 'parou')),
  stopped_on  date,          -- preenchido quando status = 'parou'
  stop_reason text,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- LIVROS
-- ---------------------------------------------------------------------------
create table if not exists books (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null,
  level        text,
  lesson_count smallint not null default 12 check (lesson_count between 1 and 300),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- MATRICULAS (quais livros o aluno esta usando agora)
-- ---------------------------------------------------------------------------
create table if not exists enrollments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  book_id    uuid not null references books(id)    on delete cascade,
  started_on date not null default current_date,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, book_id)
);

-- ---------------------------------------------------------------------------
-- AULAS (uma linha por encontro, inclusive faltas e aulas que nao houveram)
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  session_date date not null,
  status       text not null default 'realizada'
               check (status in ('realizada', 'falta_aluno', 'cancelada', 'sem_aula')),
  notes        text,
  created_at   timestamptz not null default now(),
  unique (student_id, session_date)
);

-- ---------------------------------------------------------------------------
-- LICOES ATRIBUIDAS
--   assigned_session_id = aula em que a licao foi passada
--   review_session_id   = aula em que a licao foi conferida
--   result 'pendente' = ainda nao foi conferida (rola para a proxima aula)
-- ---------------------------------------------------------------------------
create table if not exists assignments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id          uuid not null references students(id) on delete cascade,
  book_id             uuid not null references books(id)    on delete cascade,
  lesson_no           smallint not null check (lesson_no >= 1),
  lesson_label        text,
  assigned_session_id uuid references sessions(id) on delete set null,
  review_session_id   uuid references sessions(id) on delete set null,
  result              text not null default 'pendente'
                      check (result in ('pendente', 'aprovado', 'reprovado', 'revisar', 'nao_trouxe')),
  attempt_no          smallint not null default 1 check (attempt_no >= 1),
  score               numeric(5,2),
  notes               text,
  assigned_on         date not null default current_date,
  reviewed_on         date,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- INDICES
-- ---------------------------------------------------------------------------
create index if not exists idx_students_user      on students   (user_id);
create index if not exists idx_students_weekday   on students   (user_id, weekday);
create index if not exists idx_books_user         on books      (user_id);
create index if not exists idx_enroll_student     on enrollments(user_id, student_id);
create index if not exists idx_sessions_student   on sessions   (user_id, student_id, session_date desc);
create index if not exists idx_assign_student     on assignments(user_id, student_id);
create index if not exists idx_assign_pending     on assignments(user_id, student_id, result);
create index if not exists idx_assign_book_lesson on assignments(user_id, book_id, lesson_no);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Sem isto, qualquer pessoa com a URL do app leria/gravaria seus dados.
-- ---------------------------------------------------------------------------
alter table students    enable row level security;
alter table books       enable row level security;
alter table enrollments enable row level security;
alter table sessions    enable row level security;
alter table assignments enable row level security;

drop policy if exists own_students    on students;
drop policy if exists own_books       on books;
drop policy if exists own_enrollments on enrollments;
drop policy if exists own_sessions    on sessions;
drop policy if exists own_assignments on assignments;

create policy own_students    on students    for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_books       on books       for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_enrollments on enrollments for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_sessions    on sessions    for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_assignments on assignments for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
