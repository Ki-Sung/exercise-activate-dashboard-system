-- =====================================================================
-- Garmin Dashboard :: Supabase(Postgres) 스키마
-- Supabase 대시보드 > SQL Editor 에 그대로 붙여넣고 실행하세요.
-- =====================================================================

create schema if not exists garmin;

-- ---------------------------------------------------------------------
-- 1) 활동(Activity) 원장 테이블 : activity_id 기준 멱등 upsert
-- ---------------------------------------------------------------------
create table if not exists garmin.activities (
    activity_id        bigint       primary key,
    activity_name      text         not null default '이름 없음',
    activity_type      text         not null default 'unknown',   -- running / treadmill_running / trail_running ...
    is_run             boolean      not null default false,
    start_time_local   timestamp    not null,                     -- 가민이 주는 로컬시각(타임존 없음)
    start_time_utc     timestamptz,
    start_date         date         generated always as (start_time_local::date) stored,
    distance_m         numeric(10,2) not null default 0,
    duration_s         numeric(10,2) not null default 0,          -- elapsed
    moving_duration_s  numeric(10,2),                             -- 실제 러닝 페이스는 이 값이 더 정확
    calories           integer      not null default 0,
    avg_hr             integer,
    max_hr             integer,
    elevation_gain_m   numeric(8,2),
    avg_pace_s_per_km  numeric(8,2),                              -- duration_s / (distance_m/1000)
    raw                jsonb,                                     -- 원본 스냅샷(스키마 변경 대비)
    synced_at          timestamptz  not null default now(),
    updated_at         timestamptz  not null default now()
);

create index if not exists idx_activities_start_date on garmin.activities (start_date desc);
create index if not exists idx_activities_is_run     on garmin.activities (is_run, start_date desc);

-- ---------------------------------------------------------------------
-- 2) 일자별 스탯 (걸음수 등, 활동과 별개로 하루 단위로 오는 값)
-- ---------------------------------------------------------------------
create table if not exists garmin.daily_stats (
    stat_date       date primary key,
    total_steps     integer,
    total_kcal      integer,
    active_kcal     integer,
    resting_hr      integer,
    raw             jsonb,
    synced_at       timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) 배치 실행 로그 (관측 가능성 / QA용)
-- ---------------------------------------------------------------------
create table if not exists garmin.sync_runs (
    id              bigserial primary key,
    slot            text,                  -- '09' | '12' | '18' | '22' | 'manual'
    status          text not null,         -- 'success' | 'partial' | 'failed'
    window_from     date,
    window_to       date,
    activities_seen integer default 0,
    activities_upserted integer default 0,
    daily_upserted  integer default 0,
    attempts        integer default 0,     -- 총 재시도 횟수 합
    duration_ms     integer,
    error           text,
    started_at      timestamptz not null default now(),
    finished_at     timestamptz
);

create index if not exists idx_sync_runs_started on garmin.sync_runs (started_at desc);

-- ---------------------------------------------------------------------
-- 4) 가민 OAuth 토큰 저장소 (service_role 만 접근)
--    - GitHub Actions 는 상태가 없으므로 갱신된 토큰을 여기에 되돌려 저장
-- ---------------------------------------------------------------------
create table if not exists garmin.app_secrets (
    key         text primary key,          -- 'garmin_tokens'
    value       jsonb not null,
    updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5) 집계 뷰
--    ★ 평균 페이스는 "페이스의 평균"이 아니라 "총시간 / 총거리" 로 계산합니다.
--      (짧은 인터벌과 장거리 LSD를 단순평균하면 값이 왜곡됨)
-- ---------------------------------------------------------------------

-- 일간
create or replace view garmin.v_daily_summary as
select
    a.start_date                                       as period_start,
    a.start_date                                       as period_end,
    count(*)                                           as activity_count,
    round(sum(a.distance_m) / 1000.0, 2)               as total_distance_km,
    round(sum(a.duration_s))                           as total_duration_s,
    sum(a.calories)                                    as total_calories,
    round(
        sum(a.duration_s) / nullif(sum(a.distance_m) / 1000.0, 0)
    , 1)                                               as avg_pace_s_per_km,
    max(a.max_hr)                                      as max_hr,
    string_agg(distinct a.activity_name, ', ')         as activity_names
from garmin.activities a
where a.is_run
group by a.start_date;

-- 주간 (ISO 기준: 월요일 시작)
create or replace view garmin.v_weekly_summary as
select
    date_trunc('week', a.start_date)::date              as period_start,
    (date_trunc('week', a.start_date) + interval '6 day')::date as period_end,
    count(*)                                           as activity_count,
    round(sum(a.distance_m) / 1000.0, 2)               as total_distance_km,
    round(sum(a.duration_s))                           as total_duration_s,
    sum(a.calories)                                    as total_calories,
    round(
        sum(a.duration_s) / nullif(sum(a.distance_m) / 1000.0, 0)
    , 1)                                               as avg_pace_s_per_km
from garmin.activities a
where a.is_run
group by 1, 2;

-- 월간
create or replace view garmin.v_monthly_summary as
select
    date_trunc('month', a.start_date)::date            as period_start,
    (date_trunc('month', a.start_date) + interval '1 month - 1 day')::date as period_end,
    count(*)                                           as activity_count,
    round(sum(a.distance_m) / 1000.0, 2)               as total_distance_km,
    round(sum(a.duration_s))                           as total_duration_s,
    sum(a.calories)                                    as total_calories,
    round(
        sum(a.duration_s) / nullif(sum(a.distance_m) / 1000.0, 0)
    , 1)                                               as avg_pace_s_per_km
from garmin.activities a
where a.is_run
group by 1, 2;

-- ---------------------------------------------------------------------
-- 6) 보안: RLS 전면 활성화 + 정책 없음
--    => anon / authenticated 키로는 단 한 줄도 못 읽습니다.
--    => 오직 service_role(백엔드 서버, 배치)만 접근 가능.
-- ---------------------------------------------------------------------
alter table garmin.activities  enable row level security;
alter table garmin.daily_stats enable row level security;
alter table garmin.sync_runs   enable row level security;
alter table garmin.app_secrets enable row level security;

-- PostgREST 가 garmin 스키마를 노출하지 않도록 public 만 노출 유지(기본값).
-- 대신 API 서버가 RPC 없이 접근할 수 있도록 public 스키마에 뷰를 노출합니다.
create or replace view public.v_daily_summary   as select * from garmin.v_daily_summary;
create or replace view public.v_weekly_summary  as select * from garmin.v_weekly_summary;
create or replace view public.v_monthly_summary as select * from garmin.v_monthly_summary;
create or replace view public.v_activities as
select activity_id, activity_name, activity_type, start_time_local, start_date,
       round(distance_m / 1000.0, 2) as distance_km,
       duration_s, moving_duration_s, calories, avg_hr, max_hr,
       avg_pace_s_per_km, elevation_gain_m
from garmin.activities
order by start_time_local desc;

-- 이 public 뷰들도 anon 이 못 읽게 막습니다 (service_role 만 허용)
revoke all on public.v_daily_summary, public.v_weekly_summary,
              public.v_monthly_summary, public.v_activities
       from anon, authenticated;
