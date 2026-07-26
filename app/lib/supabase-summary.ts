// 서버 컴포넌트에서만 호출. Vercel 에 아직 안 올라간 API 한도와 무관하게
// Supabase 에서 일/주/월 요약을 직접 읽어 전체 이력을 확보한다.
import 'server-only';

import type { Activity, Summary } from './api';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PAGE = 1000;

function paceLabel(paceSec: number | null | undefined): string {
  if (!paceSec) return '-';
  const m = Math.floor(paceSec / 60);
  const s = Math.round(paceSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function durationLabel(sec: number | null | undefined): string {
  const total = Math.floor(sec ?? 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toSummary(row: Record<string, unknown>): Summary {
  const pace = (row.avg_pace_s_per_km as number | null) ?? null;
  const duration = Number(row.total_duration_s ?? 0);
  return {
    period_start: String(row.period_start),
    period_end: String(row.period_end),
    activity_count: Number(row.activity_count ?? 0),
    total_distance_km: Number(row.total_distance_km ?? 0),
    total_duration_s: duration,
    total_calories: Number(row.total_calories ?? 0),
    avg_pace_s_per_km: pace,
    avg_pace_label: paceLabel(pace),
    duration_label: durationLabel(duration),
    activity_names: row.activity_names != null ? String(row.activity_names) : undefined,
  };
}

async function fetchAll(
  table: string,
  query: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [];

  const rows: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams(query);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'count=exact',
        Range: `${offset}-${offset + PAGE - 1}`,
      },
      next: { revalidate: 300 },
    });
    if (!res.ok) return rows;

    const chunk = (await res.json()) as Record<string, unknown>[];
    rows.push(...chunk);

    const contentRange = res.headers.get('content-range') ?? '';
    const totalPart = contentRange.split('/')[1];
    const total = totalPart && totalPart !== '*' ? Number(totalPart) : NaN;
    if (Number.isFinite(total)) {
      if (rows.length >= total || chunk.length === 0) break;
    } else if (chunk.length < PAGE) {
      break;
    }
    offset += PAGE;
  }

  return rows;
}

/** 전체 일간 요약 (활동이 있는 날만 — DB 뷰 기준). */
export async function loadAllDaily(): Promise<Summary[]> {
  const rows = await fetchAll('v_daily_summary', {
    select: '*',
    order: 'period_start.desc',
  });
  return rows.map(toSummary);
}

/** 전체 주간 요약. */
export async function loadAllWeekly(): Promise<Summary[]> {
  const rows = await fetchAll('v_weekly_summary', {
    select: '*',
    order: 'period_start.desc',
  });
  return rows.map(toSummary);
}

/** 전체 월간 요약. */
export async function loadAllMonthly(): Promise<Summary[]> {
  const rows = await fetchAll('v_monthly_summary', {
    select: '*',
    order: 'period_start.desc',
  });
  return rows.map(toSummary);
}

/** @deprecated loadAllMonthly 사용 */
export async function loadMonthly(limit = 36): Promise<Summary[]> {
  const rows = await fetchAll('v_monthly_summary', {
    select: '*',
    order: 'period_start.desc',
    limit: String(limit),
  });
  return rows.map(toSummary);
}

export async function loadActivities(limit = 12): Promise<Activity[]> {
  const rows = await fetchAll('v_activities', {
    select: '*',
    order: 'start_time_local.desc',
    limit: String(limit),
  });
  return rows.map((row) => {
    const pace = (row.avg_pace_s_per_km as number | null) ?? null;
    const duration = Number(row.duration_s ?? 0);
    return {
      activity_id: Number(row.activity_id),
      activity_name: String(row.activity_name ?? ''),
      activity_type: String(row.activity_type ?? ''),
      start_time_local: String(row.start_time_local ?? ''),
      distance_km: Number(row.distance_km ?? 0),
      calories: Number(row.calories ?? 0),
      max_hr: row.max_hr == null ? null : Number(row.max_hr),
      avg_pace_label: paceLabel(pace),
      duration_label: durationLabel(duration),
    };
  });
}
