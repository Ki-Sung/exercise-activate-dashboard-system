'use client';

import { useRef, useState } from 'react';

import type { Summary } from '../lib/api';

export type ChartPoint = {
  label: string;
  /** null 이면 해당 구간은 그리지 않음 (연간 YTD의 미래 달) */
  value: number | null;
  meta?: string;
};

type Series = {
  id: string;
  label: string;
  color: string;
  fill?: boolean;
  points: ChartPoint[];
};

type Props = {
  series: Series[];
  height?: number;
  yUnit?: string;
  avgValue?: number | null;
  /** 일·주간은 bar, 연간 비교는 line */
  variant?: 'line' | 'bar';
  showLegend?: boolean;
  /** X축 라벨을 전부 표시 (일·주간) */
  showAllLabels?: boolean;
};

type TipRow = { label: string; value: string; color: string };

/** 순수 SVG 차트. 드래그/호버로 수치 툴팁 표시. */
export function TrendLineChart({
  series,
  height = 240,
  yUnit = 'km',
  avgValue,
  variant = 'line',
  showLegend = true,
  showAllLabels = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const pad = { top: 20, right: 12, bottom: 28, left: 40 };
  const width = 640;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const allValues = series.flatMap((s) =>
    s.points.map((p) => p.value).filter((v): v is number => v != null),
  );
  const maxVal = Math.max(...allValues, 1);
  const { yMax, ticks: gridTicks } = buildIntegerAxis(maxVal);
  const labels = series[0]?.points ?? [];
  const xCount = Math.max(...series.map((s) => s.points.length), 1);

  const yAt = (v: number) => pad.top + innerH - (v / yMax) * innerH;
  const xAtLine = (i: number) =>
    pad.left + (xCount <= 1 ? innerW / 2 : (i / (xCount - 1)) * innerW);
  const xAtBar = (i: number) => pad.left + (i + 0.5) * (innerW / Math.max(labels.length, 1));
  const xAt = (i: number) => (variant === 'bar' ? xAtBar(i) : xAtLine(i));

  const labelStep =
    showAllLabels || variant === 'bar'
      ? 1
      : labels.length > 14
        ? Math.ceil(labels.length / 7)
        : labels.length > 8
          ? 2
          : 1;

  const tip = activeIdx != null ? buildTip(series, activeIdx, labels, yUnit) : null;
  const guideX = activeIdx != null ? xAt(activeIdx) : null;

  const pickIndex = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || labels.length === 0) return;
    const rect = el.getBoundingClientRect();
    const svg = el.querySelector('svg');
    if (!svg) return;
    const svgRect = svg.getBoundingClientRect();
    const xSvg = ((clientX - svgRect.left) / svgRect.width) * width;
    const clamped = Math.min(width - pad.right, Math.max(pad.left, xSvg));
    const t = (clamped - pad.left) / innerW;
    const idx = Math.round(t * Math.max(labels.length - 1, 0));
    setActiveIdx(Math.min(labels.length - 1, Math.max(0, idx)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    pickIndex(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging && e.pointerType === 'mouse' && e.buttons === 0) {
      pickIndex(e.clientX);
      return;
    }
    if (dragging || e.buttons > 0) pickIndex(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };
  const onPointerLeave = () => {
    if (!dragging) setActiveIdx(null);
  };

  const tipLeftPct = guideX != null ? (guideX / width) * 100 : 50;

  return (
    <div
      ref={wrapRef}
      className="chart-wrap chart-interactive"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="trend-chart"
        role="img"
        aria-label={variant === 'bar' ? '막대 차트' : '라인 차트'}
      >
        {gridTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              className="chart-grid"
            />
            <text x={pad.left - 8} y={yAt(tick) + 3} className="chart-axis" textAnchor="end">
              {String(Math.round(tick))}
            </text>
          </g>
        ))}

        {typeof avgValue === 'number' && Number.isFinite(avgValue) && avgValue > 0 && (
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={yAt(avgValue)}
            y2={yAt(avgValue)}
            className="chart-avg"
          />
        )}

        {variant === 'bar' ? (
          <BarSeries
            points={labels}
            color={series[0]?.color ?? '#4FD1C5'}
            activeIdx={activeIdx}
            padLeft={pad.left}
            padTop={pad.top}
            innerW={innerW}
            innerH={innerH}
            yMax={yMax}
          />
        ) : (
          series.map((s) => {
            const segments = buildSegments(s.points, xAtLine, yAt);
            return (
              <g key={s.id}>
                {segments.map((seg, si) => {
                  if (seg.length === 0) return null;
                  const lineD = seg
                    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
                    .join(' ');
                  return (
                    <g key={si}>
                      {s.fill && (
                        <path
                          d={`${lineD} L ${seg[seg.length - 1].x.toFixed(1)} ${pad.top + innerH} L ${seg[0].x.toFixed(1)} ${pad.top + innerH} Z`}
                          fill={s.color}
                          fillOpacity={0.2}
                          stroke="none"
                        />
                      )}
                      <path
                        d={lineD}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={2.75}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
                {s.points.map((p, i) => {
                  if (p.value == null) return null;
                  const isActive = activeIdx === i;
                  const cx = xAtLine(i);
                  const cy = yAt(p.value);
                  return (
                    <circle
                      key={`pt-${i}`}
                      cx={cx}
                      cy={cy}
                      r={isActive ? 5.5 : 3.5}
                      fill={s.color}
                      stroke="#10151F"
                      strokeWidth={isActive ? 1.5 : 1}
                      opacity={activeIdx == null || isActive ? 1 : 0.45}
                    />
                  );
                })}
              </g>
            );
          })
        )}

        {labels.map((p, i) => {
          if (i % labelStep !== 0 && i !== labels.length - 1) return null;
          const x = xAt(i);
          const isActive = activeIdx === i;
          return (
            <text
              key={`${p.label}-${i}`}
              x={x}
              y={height - 8}
              className={`chart-axis${showAllLabels || variant === 'bar' ? ' chart-axis-bar' : ''}${isActive ? ' is-active' : ''}`}
              textAnchor="middle"
            >
              {p.label}
            </text>
          );
        })}
      </svg>

      {tip && (
        <div
          className="chart-tip"
          style={{ left: `${Math.min(88, Math.max(12, tipLeftPct))}%` }}
          role="status"
        >
          <div className="chart-tip-title">{tip.title}</div>
          {tip.rows.map((row) => (
            <div key={row.label} className="chart-tip-row">
              <i style={{ background: row.color }} />
              <span>{row.label}</span>
              <b>
                {row.value}
                {yUnit}
              </b>
            </div>
          ))}
        </div>
      )}

      <p className="chart-scrub-hint">차트 위에서 드래그하거나 터치하면 수치를 볼 수 있습니다</p>

      {showLegend && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.id} className="chart-legend-item">
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
          {typeof avgValue === 'number' && Number.isFinite(avgValue) && avgValue > 0 && (
            <span className="chart-legend-item">
              <i className="avg" />
              평균 {avgValue.toFixed(1)}
              {yUnit}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function buildTip(
  series: Series[],
  idx: number,
  labels: ChartPoint[],
  yUnit: string,
): { title: string; rows: TipRow[] } | null {
  const title = labels[idx]?.label;
  if (!title) return null;
  const rows: TipRow[] = [];
  for (const s of series) {
    const p = s.points[idx];
    if (!p || p.value == null) continue;
    rows.push({
      label: s.label,
      value: p.value.toFixed(1),
      color: s.color,
    });
  }
  if (rows.length === 0) {
    return { title, rows: [{ label: '거리', value: '0.0', color: '#8A97AE' }] };
  }
  void yUnit;
  return { title, rows };
}

function BarSeries({
  points,
  color,
  activeIdx,
  padLeft,
  padTop,
  innerW,
  innerH,
  yMax,
}: {
  points: ChartPoint[];
  color: string;
  activeIdx: number | null;
  padLeft: number;
  padTop: number;
  innerW: number;
  innerH: number;
  yMax: number;
}) {
  const n = Math.max(points.length, 1);
  const slot = innerW / n;
  const barW = Math.max(4, Math.min(28, slot * 0.62));
  const baseY = padTop + innerH;
  const round = (n: number) => Math.round(n * 100) / 100;

  return (
    <g>
      {points.map((p, i) => {
        const v = p.value ?? 0;
        if (v <= 0) return null;
        const h = (v / yMax) * innerH;
        const x = padLeft + i * slot + (slot - barW) / 2;
        const y = baseY - h;
        const isActive = activeIdx === i;
        return (
          <g key={`${p.label}-${i}`}>
            <rect
              x={round(x)}
              y={round(y)}
              width={round(barW)}
              height={round(h)}
              rx={2}
              fill={color}
              className={`chart-bar${isActive ? ' is-active' : ''}`}
              opacity={activeIdx == null || isActive ? 1 : 0.4}
              aria-label={`${p.label}: ${v.toFixed(1)} km`}
            />
          </g>
        );
      })}
    </g>
  );
}

function buildSegments(
  points: ChartPoint[],
  xAt: (i: number) => number,
  yAt: (v: number) => number,
): { x: number; y: number }[][] {
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.value == null) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      return;
    }
    current.push({ x: xAt(i), y: yAt(p.value) });
  });
  if (current.length) segments.push(current);
  return segments;
}

function buildIntegerAxis(maxVal: number): { yMax: number; ticks: number[] } {
  const safe = Number.isFinite(maxVal) ? maxVal : 1;
  const raw = Math.max(1, Math.ceil(safe));
  const rough = raw / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const yMax = Math.max(step, Math.ceil(raw / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v));
  return { yMax, ticks };
}

export function summarize(rows: Summary[]) {
  const totalKm = rows.reduce((a, r) => a + r.total_distance_km, 0);
  const totalCal = rows.reduce((a, r) => a + r.total_calories, 0);
  const totalSec = rows.reduce((a, r) => a + r.total_duration_s, 0);
  const count = rows.reduce((a, r) => a + r.activity_count, 0);
  const paceSamples = rows.filter((r) => r.avg_pace_s_per_km != null);
  const avgPace =
    paceSamples.length > 0
      ? paceSamples.reduce((a, r) => a + (r.avg_pace_s_per_km ?? 0), 0) / paceSamples.length
      : null;
  const denom = rows.filter((r) => r.total_distance_km > 0).length || rows.length || 1;
  return {
    totalKm,
    totalCal,
    totalSec,
    count,
    avgPace,
    avgKm: totalKm / denom,
  };
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatPace(paceSec: number | null): string {
  if (!paceSec) return '-';
  const m = Math.floor(paceSec / 60);
  const s = Math.round(paceSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
