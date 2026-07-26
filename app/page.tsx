import { PeriodDashboard } from './components/PeriodDashboard';
import {
  loadActivities,
  loadAllDaily,
  loadAllMonthly,
  loadAllWeekly,
} from './lib/supabase-summary';

export const dynamic = 'force-dynamic';

export default async function Page() {
  // Vercel 배포 API 한도와 무관하게 Supabase 에서 전체 이력을 직접 읽는다.
  const [daily, weekly, monthly, activities] = await Promise.all([
    loadAllDaily(),
    loadAllWeekly(),
    loadAllMonthly(),
    loadActivities(12),
  ]);

  // Asia/Seoul 기준 — 클라이언트 new Date() 와 SSR 불일치 방지
  const seoul = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const currentYear = seoul.getFullYear();
  const currentMonth = seoul.getMonth() + 1;

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="eyebrow">Garmin · Running</div>
        <h1>러닝 대시보드</h1>
        <p>
          가민 커넥트에서 매일 09 / 12 / 18 / 22시에 동기화됩니다.
          {daily.length > 0 && (
            <>
              {' '}
              · 일간 {daily.length.toLocaleString()}일
              {weekly.length > 0 ? ` · 주간 ${weekly.length}주` : ''}
              {monthly.length > 0 ? ` · 월간 ${monthly.length}개월` : ''}
            </>
          )}
        </p>
      </header>

      <PeriodDashboard
        daily={daily}
        weekly={weekly}
        monthly={monthly}
        currentYear={currentYear}
        currentMonth={currentMonth}
      />

      <section>
        <div className="sec-head">
          <h2>최근 활동</h2>
          <span>{activities.length}건</span>
        </div>
        {activities.length === 0 ? (
          <p className="empty">동기화된 활동이 없습니다.</p>
        ) : (
          activities.map((a) => (
            <div className="act" key={a.activity_id}>
              <div>
                <div className="act-name">{a.activity_name}</div>
                <div className="act-sub">
                  {a.start_time_local.replace('T', ' ').slice(0, 16)} · {a.activity_type}
                  {a.max_hr ? ` · 최대 ${a.max_hr}bpm` : ''}
                </div>
              </div>
              <div className="act-nums">
                <b>{a.distance_km.toFixed(2)}km</b> · {a.duration_label}
                <br />
                {a.avg_pace_label}/km · {a.calories}kcal
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
