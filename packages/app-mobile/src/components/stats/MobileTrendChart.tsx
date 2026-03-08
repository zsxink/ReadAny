/**
 * MobileTrendChart — compact SVG area/line chart for mobile
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear, scalePoint } from "d3-scale";
import { line, area, curveMonotoneX } from "d3-shape";

interface TrendData {
  date: string;
  value: number;
}

interface MobileTrendChartProps {
  data: TrendData[];
  height?: number;
  emptyMessage?: string;
}

const formatTime = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
};

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export function MobileTrendChart({ data, height = 130, emptyMessage }: MobileTrendChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);

  const updateWidth = useCallback(() => {
    if (containerRef.current) {
      setWidth(containerRef.current.clientWidth);
    }
  }, []);

  useEffect(() => {
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateWidth]);

  const margin = { top: 8, right: 8, bottom: 24, left: 32 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const hasData = data.some((d) => d.value > 0);
  const maxValue = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);

  const xScale = useMemo(
    () => scalePoint<string>().domain(data.map((d) => d.date)).range([0, innerWidth]).padding(0.05),
    [data, innerWidth],
  );

  const yScale = useMemo(
    () => scaleLinear().domain([0, maxValue * 1.1]).range([innerHeight, 0]).nice(),
    [maxValue, innerHeight],
  );

  const linePath = useMemo(() => {
    const gen = line<TrendData>()
      .x((d: TrendData) => xScale(d.date) || 0)
      .y((d: TrendData) => yScale(d.value))
      .curve(curveMonotoneX);
    return gen(data) || "";
  }, [data, xScale, yScale]);

  const areaPath = useMemo(() => {
    const gen = area<TrendData>()
      .x((d: TrendData) => xScale(d.date) || 0)
      .y0(innerHeight)
      .y1((d: TrendData) => yScale(d.value))
      .curve(curveMonotoneX);
    return gen(data) || "";
  }, [data, xScale, yScale, innerHeight]);

  // ~5 evenly spaced X labels
  const xTicks = useMemo(() => {
    if (data.length <= 6) return data.map((d) => d.date);
    const step = Math.ceil(data.length / 5);
    const ticks: string[] = [];
    for (let i = 0; i < data.length; i += step) {
      ticks.push(data[i].date);
    }
    if (ticks[ticks.length - 1] !== data[data.length - 1].date) {
      ticks.push(data[data.length - 1].date);
    }
    return ticks;
  }, [data]);

  const yTicks = useMemo(() => yScale.ticks(3), [yScale]);

  if (!hasData && emptyMessage) {
    return (
      <div ref={containerRef} className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="mTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(16, 185, 129)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="rgb(16, 185, 129)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Y axis */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={0} y1={yScale(tick)} x2={innerWidth} y2={yScale(tick)} stroke="#f0f0f0" strokeWidth={1} />
              <text x={-6} y={yScale(tick)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#a3a3a3">
                {formatTime(tick)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill="url(#mTrendGrad)" />
          <path d={linePath} fill="none" stroke="rgb(16, 185, 129)" strokeWidth={1.5} />

          {/* X axis labels */}
          {xTicks.map((date) => (
            <text key={`x-${date}`} x={xScale(date) || 0} y={innerHeight + 16} textAnchor="middle" fontSize={9} fill="#a3a3a3">
              {formatDate(date)}
            </text>
          ))}

          <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke="#e5e5e5" strokeWidth={1} />
        </g>
      </svg>
    </div>
  );
}
