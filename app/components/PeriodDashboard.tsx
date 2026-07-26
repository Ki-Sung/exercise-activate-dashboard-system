'use client';

import { useState } from 'react';

import type { Summary } from '../lib/api';
import {
  TrendLineChart,
  formatDuration,
  formatPace,
  summarize,
  type ChartPoint,
} from './TrendLineChart';

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';

type Props = {
  daily: Summary[];
  weekly: Summary[];
  monthly: Summary[];
  /** 서버에서 넘긴 기준일 — 클라이언트 Date 와 SSR 불일치 방지 */
  currentYear: number;
  currentMonth: number;
};

const TABS: { id: Period; label: string }[] = [
  { id: 'daily', label: '일간' },
  { id: 'weekly', label: '주간' },
  { id: 'monthly', label: '월간' },
  { id: 'yearly', label: '연간' },
];

const MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

/** SVG stroke 는 CSS 변수가 깨지는 경우가 있어 hex 로 고정 — predawn 팔레트 */
const COLOR_FOCUS = '#22D3EE'; // 올해 — 시안
const COLOR_PREV = '#F472B6'; // 작년 — 핑크
const COLOR_DAILY = '#4FD1C5'; // --cool
const COLOR_WEEKLY = '#F5A524'; // --lamp
const COLOR_MONTHLY = '#A8B8D4'; // fog-lifted (차가운 새벽 하늘)

const DAILY_PAGE_SIZE = 14;
const WEEKLY_PAGE_SIZE = 8;
const MONTHLY_PAGE_SIZE = 12;

export function PeriodDashboard({ daily, weekly, monthly, currentYear, currentMonth }: Props) {
  const ym = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  const [period, setPeriod] = useState<Period>('daily');
  const [focusYear, setFocusYear] = useState(currentYear);
  const [comparePrevYear, setComparePrevYear] = useState(true);
  /** 0 = 가장 최근 구간. 커질수록 과거로 이동 */
  const [dailyPage, setDailyPage] = useState(0);
  const [weeklyPage, setWeeklyPage] = useState(0);
  const [monthlyPage, setMonthlyPage] = useState(0);

  // 이번 달: 월간 요약이 있으면 쓰고, 없으면 일간을 합산 (진행 중 달 대응)
  const thisMonth = resolveThisMonth(monthly, daily, ym);
  const weeklyNewestFirst = [...weekly].sort((a, b) => b.period_start.localeCompare(a.period_start));
  const thisWeek = weeklyNewestFirst[0];

  const dailyAsc = [...daily].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const weeklyAsc = [...weekly].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const monthlyAsc = [...monthly].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const dailyMaxPage = Math.max(0, Math.ceil(dailyAsc.length / DAILY_PAGE_SIZE) - 1);
  const weeklyMaxPage = Math.max(0, Math.ceil(weeklyAsc.length / WEEKLY_PAGE_SIZE) - 1);
  const monthlyMaxPage = Math.max(0, Math.ceil(monthlyAsc.length / MONTHLY_PAGE_SIZE) - 1);

  const yearsAvailable = (() => {
    const years = new Set<number>();
    for (const r of monthly) years.add(Number(r.period_start.slice(0, 4)));
    years.add(currentYear);
    return [...years].sort((a, b) => a - b);
  })();

  const minYear = Math.min(...yearsAvailable);
  const canPrevYear = focusYear > minYear;
  const canNextYear = focusYear < currentYear;

  // 진행 중 연도: 현재 달까지. 지난 연도: 12개월 전체. 달이 바뀌면 자동으로 한 칸 늘어남.
  const monthCount =
    focusYear === currentYear ? currentMonth : focusYear < currentYear ? 12 : 0;

  const view = (() => {
    if (period === 'daily') {
      const rows = slicePage(dailyAsc, dailyPage, DAILY_PAGE_SIZE);
      const points: ChartPoint[] = rows.map((r) => ({
        label: formatDayLabel(r.period_start),
        value: r.total_distance_km,
      }));
      const range =
        rows.length > 0
          ? `${formatDayLabel(rows[0].period_start)} – ${formatDayLabel(rows[rows.length - 1].period_start)}`
          : '';
      return {
        title: '일간 거리',
        subtitle: range || '기록 없음',
        chart: 'bar' as const,
        series: [{ id: 'daily', label: '거리', color: COLOR_DAILY, points }],
        stats: null,
        avgValue: null,
        rangeLabel: range,
      };
    }

    if (period === 'weekly') {
      const rows = slicePage(weeklyAsc, weeklyPage, WEEKLY_PAGE_SIZE);
      const points: ChartPoint[] = rows.map((r) => ({
        label: formatWeekLabel(r.period_start),
        value: r.total_distance_km,
      }));
      const range =
        rows.length > 0
          ? `${formatWeekLabel(rows[0].period_start)} – ${formatWeekLabel(rows[rows.length - 1].period_start)}`
          : '';
      return {
        title: '주간 거리',
        subtitle: range || '기록 없음',
        chart: 'bar' as const,
        series: [{ id: 'weekly', label: '거리', color: COLOR_WEEKLY, points }],
        stats: null,
        avgValue: null,
        rangeLabel: range,
      };
    }

    if (period === 'monthly') {
      const rows = slicePage(monthlyAsc, monthlyPage, MONTHLY_PAGE_SIZE);
      const points: ChartPoint[] = rows.map((r) => ({
        label: formatMonthLabel(r.period_start),
        value: r.total_distance_km,
      }));
      const range =
        rows.length > 0
          ? `${formatMonthLabel(rows[0].period_start)} – ${formatMonthLabel(rows[rows.length - 1].period_start)}`
          : '';
      return {
        title: '월간 거리',
        subtitle: range || '기록 없음',
        chart: 'bar' as const,
        series: [{ id: 'monthly', label: '거리', color: COLOR_MONTHLY, points }],
        stats: null,
        avgValue: null,
        rangeLabel: range,
      };
    }

    const primary = buildYearPoints(monthly, focusYear, monthCount);
    // 진행 중 이번 달: 월간 뷰가 비어 있으면 일간 합산 값을 마지막 점에 반영
    if (focusYear === currentYear && monthCount > 0 && thisMonth.stats.totalKm > 0) {
      const last = primary[monthCount - 1];
      if (last && (last.value == null || last.value === 0)) {
        primary[monthCount - 1] = { ...last, value: thisMonth.stats.totalKm };
      }
    }
    const prevYear = focusYear - 1;
    const series: {
      id: string;
      label: string;
      color: string;
      fill?: boolean;
      points: ChartPoint[];
    }[] = [];
    if (comparePrevYear) {
      // 공정 비교: 올해면 작년도 같은 달(1~현재월)만
      series.push({
        id: 'prev',
        label: `${prevYear}년`,
        color: COLOR_PREV,
        fill: false,
        points: buildYearPoints(monthly, prevYear, monthCount),
      });
    }
    series.push({
      id: 'focus',
      label: `${focusYear}년`,
      color: COLOR_FOCUS,
      fill: false,
      points: primary,
    });

    const primaryRows = monthly.filter((r) => {
      const y = Number(r.period_start.slice(0, 4));
      const m = Number(r.period_start.slice(5, 7));
      return y === focusYear && m <= monthCount;
    });
    const stats = summarize(primaryRows);
    const subtitle = comparePrevYear
      ? `${focusYear}년 · 작년(${prevYear}) 같은 기간 비교 · ${monthCount}월까지`
      : `${focusYear}년 · ${monthCount}월까지`;

    return {
      title: '연간 거리',
      subtitle,
      chart: 'line' as const,
      series,
      stats,
      avgValue: stats.avgKm,
      rangeLabel: '',
    };
  })();

  return (
    <section className="period-dash">
      <div className="now-progress">
        <div className="now-card">
          <div className="now-head">
            <h3>이번 달</h3>
            <span>
              {currentYear}년 {currentMonth}월 · 진행 중
              {thisMonth.source === 'daily' ? ' · 일간 합산' : ''}
            </span>
          </div>
          <div className="stats stats-compact">
            <div className="stat">
              <div className="label">거리</div>
              <div className="value">
                {thisMonth.stats.totalKm.toFixed(1)}
                <span className="unit">km</span>
              </div>
            </div>
            <div className="stat">
              <div className="label">횟수</div>
              <div className="value">
                {thisMonth.stats.count}
                <span className="unit">회</span>
              </div>
            </div>
            <div className="stat">
              <div className="label">시간</div>
              <div className="value">{formatDuration(thisMonth.stats.totalSec)}</div>
            </div>
            <div className="stat">
              <div className="label">평균 페이스</div>
              <div className="value">
                {formatPace(thisMonth.stats.avgPace)}
                <span className="unit">/km</span>
              </div>
            </div>
          </div>
        </div>

        <div className="now-card now-card-week">
          <div className="now-head">
            <h3>이번 주</h3>
            <span>
              {thisWeek
                ? `${thisWeek.period_start.slice(5).replace('-', '/')} – ${thisWeek.period_end.slice(5).replace('-', '/')}`
                : '기록 없음'}
            </span>
          </div>
          <div className="stats stats-compact">
            <div className="stat">
              <div className="label">거리</div>
              <div className="value">
                {(thisWeek?.total_distance_km ?? 0).toFixed(1)}
                <span className="unit">km</span>
              </div>
            </div>
            <div className="stat">
              <div className="label">횟수</div>
              <div className="value">
                {thisWeek?.activity_count ?? 0}
                <span className="unit">회</span>
              </div>
            </div>
            <div className="stat">
              <div className="label">시간</div>
              <div className="value">{thisWeek?.duration_label ?? '0:00:00'}</div>
            </div>
            <div className="stat">
              <div className="label">평균 페이스</div>
              <div className="value">
                {thisWeek?.avg_pace_label ?? '-'}
                <span className="unit">/km</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="period-tabs" role="tablist" aria-label="기간">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={period === t.id}
            className={`period-tab${period === t.id ? ' is-active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              setPeriod(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {period === 'yearly' && (
        <div className="year-controls">
          <div className="year-nav">
            <button
              type="button"
              className="year-btn"
              aria-label="이전 해"
              disabled={!canPrevYear}
              onClick={(e) => {
                e.preventDefault();
                setFocusYear((y) => y - 1);
              }}
            >
              ‹
            </button>
            <span className="year-label">{focusYear}년</span>
            <button
              type="button"
              className="year-btn"
              aria-label="다음 해"
              disabled={!canNextYear}
              onClick={(e) => {
                e.preventDefault();
                setFocusYear((y) => y + 1);
              }}
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className={`chip${comparePrevYear ? ' is-active' : ''}`}
            aria-pressed={comparePrevYear}
            onClick={(e) => {
              e.preventDefault();
              setComparePrevYear((v) => !v);
            }}
          >
            작년 비교 {comparePrevYear ? 'ON' : 'OFF'}
          </button>
        </div>
      )}

      <div className="sec-head">
        <h2>{view.title}</h2>
        <span>{view.subtitle}</span>
      </div>

      {(period === 'daily' || period === 'weekly' || period === 'monthly') && (
        <div className="period-nav">
          <button
            type="button"
            className="period-nav-btn"
            aria-label="이전"
            disabled={
              period === 'daily'
                ? dailyPage >= dailyMaxPage
                : period === 'weekly'
                  ? weeklyPage >= weeklyMaxPage
                  : monthlyPage >= monthlyMaxPage
            }
            onClick={(e) => {
              e.preventDefault();
              if (period === 'daily') setDailyPage((p) => Math.min(dailyMaxPage, p + 1));
              else if (period === 'weekly') setWeeklyPage((p) => Math.min(weeklyMaxPage, p + 1));
              else setMonthlyPage((p) => Math.min(monthlyMaxPage, p + 1));
            }}
          >
            ‹ 이전
          </button>
          <div className="period-nav-center">
            <strong>{view.rangeLabel || '—'}</strong>
            <span>
              {period === 'daily'
                ? `${dailyPage + 1} / ${Math.max(dailyMaxPage + 1, 1)} · 전체 ${dailyAsc.length}일`
                : period === 'weekly'
                  ? `${weeklyPage + 1} / ${Math.max(weeklyMaxPage + 1, 1)} · 전체 ${weeklyAsc.length}주`
                  : `${monthlyPage + 1} / ${Math.max(monthlyMaxPage + 1, 1)} · 전체 ${monthlyAsc.length}개월`}
            </span>
          </div>
          <button
            type="button"
            className="period-nav-btn"
            aria-label="다음"
            disabled={
              period === 'daily'
                ? dailyPage <= 0
                : period === 'weekly'
                  ? weeklyPage <= 0
                  : monthlyPage <= 0
            }
            onClick={(e) => {
              e.preventDefault();
              if (period === 'daily') setDailyPage((p) => Math.max(0, p - 1));
              else if (period === 'weekly') setWeeklyPage((p) => Math.max(0, p - 1));
              else setMonthlyPage((p) => Math.max(0, p - 1));
            }}
          >
            다음 ›
          </button>
        </div>
      )}

      {view.stats && (
        <div className="stats stats-compact">
          <div className="stat">
            <div className="label">총 거리</div>
            <div className="value">
              {view.stats.totalKm.toFixed(1)}
              <span className="unit">km</span>
            </div>
          </div>
          <div className="stat">
            <div className="label">월 평균</div>
            <div className="value">
              {view.stats.avgKm.toFixed(1)}
              <span className="unit">km</span>
            </div>
          </div>
          <div className="stat">
            <div className="label">누적 시간</div>
            <div className="value">{formatDuration(view.stats.totalSec)}</div>
          </div>
          <div className="stat">
            <div className="label">평균 페이스</div>
            <div className="value">
              {formatPace(view.stats.avgPace)}
              <span className="unit">/km</span>
            </div>
          </div>
        </div>
      )}

      {period === 'yearly' && (
        <div className="chart-swatch" aria-hidden>
          <span>
            <i style={{ background: COLOR_FOCUS }} />
            {focusYear}년
          </span>
          {comparePrevYear && (
            <span>
              <i style={{ background: COLOR_PREV }} />
              {focusYear - 1}년
            </span>
          )}
        </div>
      )}

      <TrendLineChart
        series={view.series}
        avgValue={view.avgValue}
        variant={view.chart}
        showLegend={period === 'yearly'}
        showAllLabels={period === 'daily' || period === 'weekly' || period === 'monthly'}
      />

      {period === 'yearly' && focusYear === currentYear && (
        <p className="chart-hint">
          {currentYear}년은 지금 {currentMonth}월까지 표시됩니다.
          맨 오른쪽 점이 이번 달({currentMonth}월) 진행 거리입니다.
          {currentMonth < 12
            ? ` ${currentMonth + 1}월이 되면 축에 ${currentMonth + 1}월이 추가됩니다.`
            : ' 12월까지 모두 채워진 상태입니다.'}
        </p>
      )}
    </section>
  );
}

/** 이번 달 수치: 월간 API 우선, 없으면 일간 합산으로 진행 중 달을 채운다. */
function resolveThisMonth(monthly: Summary[], daily: Summary[], ym: string) {
  const fromMonthly = monthly.find((r) => r.period_start.startsWith(ym));
  if (fromMonthly) {
    return {
      source: 'monthly' as const,
      stats: summarize([fromMonthly]),
    };
  }
  const fromDaily = daily.filter((r) => r.period_start.startsWith(ym));
  return {
    source: 'daily' as const,
    stats: summarize(fromDaily),
  };
}

function formatDayLabel(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** page 0 = 최신 구간. 오름차순 배열에서 끝쪽부터 PAGE_SIZE 씩 자른다. */
function slicePage<T>(asc: T[], page: number, pageSize: number): T[] {
  if (asc.length === 0) return [];
  const end = asc.length - page * pageSize;
  const start = Math.max(0, end - pageSize);
  if (end <= 0) return [];
  return asc.slice(start, end);
}

/** 주 시작일 기준 N월 M주차 (해당 월에서 몇 번째 주인지) */
function formatWeekLabel(periodStart: string): string {
  const [, m, d] = periodStart.split('-').map(Number);
  const weekOfMonth = Math.ceil(d / 7);
  return `${m}월 ${weekOfMonth}주차`;
}

function formatMonthLabel(periodStart: string): string {
  const [y, m] = periodStart.split('-');
  return `${y.slice(2)}년 ${Number(m)}월`;
}

/** monthCount 만큼만 포인트 생성. 7월이면 1~7월, 8월이 되면 1~8월. */
function buildYearPoints(monthly: Summary[], year: number, monthCount: number): ChartPoint[] {
  const byMonth = new Map<number, number>();
  for (const r of monthly) {
    const y = Number(r.period_start.slice(0, 4));
    if (y !== year) continue;
    const m = Number(r.period_start.slice(5, 7));
    byMonth.set(m, (byMonth.get(m) ?? 0) + r.total_distance_km);
  }

  return Array.from({ length: Math.max(monthCount, 0) }, (_, idx) => {
    const month = idx + 1;
    return {
      label: MONTH_LABELS[idx],
      value: byMonth.get(month) ?? 0,
    };
  });
}
