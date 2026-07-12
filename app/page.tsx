import { getActivities, getDaily, getMonthly, getWeekly, type Summary } from './lib/api';

export const dynamic = 'force-dynamic';

/** 페이스가 빠를수록 앰버 → 시안으로 이동. 색이 곧 페이스다. */
function paceColor(paceSec: number | null): string {
  if (!paceSec) return 'var(--ink-3)';
  const fast = 4 * 60; // 4:00/km
  const slow = 8 * 60; // 8:00/km
  const t = Math.min(1, Math.max(0, (slow - paceSec) / (slow - fast)));
  return `color-mix(in oklab, var(--cool) ${Math.round(t * 100)}%, var(--lamp))`;
}

function Stats({ s }: { s?: Summary }) {
  const km = s?.total_distance_km ?? 0;
  return (
    <div className="stats">
      <div className="stat">
        <div className="label">누적 거리</div>
        <div className="value">{km.toFixed(1)}<span className="unit">km</span></div>
      </div>
      <div className="stat">
        <div className="label">누적 시간</div>
        <div className="value">{s?.duration_label ?? '0:00:00'}</div>
      </div>
      <div className="stat">
        <div className="label">칼로리</div>
        <div className="value">{(s?.total_calories ?? 0).toLocaleString()}<span className="unit">kcal</span></div>
      </div>
      <div className="stat">
        <div className="label">평균 페이스</div>
        <div className="value">{s?.avg_pace_label ?? '-'}<span className="unit">/km</span></div>
      </div>
    </div>
  );
}

/** 시그니처: 페이스 리본. 막대 길이 = 거리, 색 = 페이스. */
function PaceRibbon({ rows, format }: { rows: Summary[]; format: (r: Summary) => string }) {
  if (rows.length === 0) return <p className="empty">아직 기록이 없습니다. 배치를 한 번 수동 실행해 보세요.</p>;
  const max = Math.max(...rows.map((r) => r.total_distance_km), 1);
  return (
    <div className="ribbon">
      {rows.map((r) => (
        <div className="ribbon-row" key={r.period_start}>
          <div className="ribbon-label">{format(r)}</div>
          <div className="ribbon-track">
            <div
              className="ribbon-fill"
              style={{
                width: `${(r.total_distance_km / max) * 100}%`,
                background: paceColor(r.avg_pace_s_per_km),
              }}
            />
          </div>
          <div className="ribbon-meta">
            {r.total_distance_km.toFixed(1)}km <em>{r.avg_pace_label}</em>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function Page() {
  const [daily, weekly, monthly, activities] = await Promise.all([
    getDaily(14), getWeekly(8), getMonthly(6), getActivities(8),
  ]);

  const thisWeek = weekly[0];
  const md = (d: string) => d.slice(5).replace('-', '/');

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="eyebrow">Garmin · Running</div>
        <h1>러닝 대시보드</h1>
        <p>가민 커넥트에서 매일 09 / 12 / 18 / 22시에 동기화됩니다.</p>
      </header>

      <section>
        <div className="sec-head">
          <h2>이번 주</h2>
          <span>{thisWeek ? `${md(thisWeek.period_start)} – ${md(thisWeek.period_end)}` : '기록 없음'}</span>
        </div>
        <Stats s={thisWeek} />
      </section>

      <section>
        <div className="sec-head">
          <h2>이번 달</h2>
          <span>{monthly[0]?.period_start.slice(0, 7) ?? '기록 없음'}</span>
        </div>
        <Stats s={monthly[0]} />
      </section>

      <section>
        <div className="sec-head">
          <h2>주간 추이</h2>
          <span>막대 길이는 거리, 색은 페이스</span>
        </div>
        <PaceRibbon rows={[...weekly].reverse()} format={(r) => md(r.period_start)} />
      </section>

      <section>
        <div className="sec-head">
          <h2>일간 추이</h2>
          <span>최근 14일</span>
        </div>
        <PaceRibbon rows={[...daily].reverse()} format={(r) => md(r.period_start)} />
      </section>

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
