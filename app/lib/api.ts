// 서버 컴포넌트에서만 호출된다. API 키가 브라우저 번들에 포함되지 않는다.
import 'server-only';

const BASE = process.env.INTERNAL_API_BASE ?? 'http://localhost:3000/api/py';
const KEY = process.env.DASHBOARD_API_KEY_SERVER ?? '';

export type Summary = {
  period_start: string;
  period_end: string;
  activity_count: number;
  total_distance_km: number;
  total_duration_s: number;
  total_calories: number;
  avg_pace_s_per_km: number | null;
  avg_pace_label: string;
  duration_label: string;
  activity_names?: string;
};

export type Activity = {
  activity_id: number;
  activity_name: string;
  activity_type: string;
  start_time_local: string;
  distance_km: number;
  calories: number;
  max_hr: number | null;
  avg_pace_label: string;
  duration_label: string;
};

async function get<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'X-API-Key': KEY },
      next: { revalidate: 300 }, // 배치가 하루 4번이므로 5분 캐시로 충분
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  }
}

export const getDaily = (days = 14) => get<Summary>(`/summary/daily?days=${days}`);
export const getWeekly = (weeks = 8) => get<Summary>(`/summary/weekly?weeks=${weeks}`);
export const getMonthly = (months = 6) => get<Summary>(`/summary/monthly?months=${months}`);
export const getActivities = (limit = 8) => get<Activity>(`/activities?limit=${limit}`);
