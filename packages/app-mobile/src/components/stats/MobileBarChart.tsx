/**
 * MobileBarChart — compact SVG bar chart for mobile, touch-friendly
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scaleBand, scaleLinear } from "d3-scale";

interface BarData {
  label: string;
  value: number;
}

interface MobileBarChartProps {
  data: BarData[];
  height?: number;
  emptyMessage?: string;
}

const formatTime = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
};

export function MobileBarChart({ data, height = 160, emptyMessage }: MobileBarChartProps) {
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

  const maxValue = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);
  const hasData = data.some((d) => d.value > 0);

  const xScale = useMemo(
    () => scaleBand<string>().domain(data.map((d) => d.label)).range([0, innerWidth]).padding(0.35),
    [data, innerWidth],
  );

  const yScale = useMemo(
    () => scaleLinear().domain([0, maxValue]).range([innerHeight, 0]).nice(),
    [maxValue, innerHeight],
  );

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
          <linearGradient id="mBarGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgb(16, 185, 129)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="rgb(16, 185, 129)" stopOpacity={0.85} />
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

          {/* Bars */}
          {data.map((d) => {
            const barHeight = innerHeight - yScale(d.value);
            return (
              <rect
                key={d.label}
                x={xScale(d.label) || 0}
                y={yScale(d.value)}
                width={xScale.bandwidth()}
                height={Math.max(barHeight, 0)}
                fill="url(#mBarGrad)"
                rx={2}
              />
            );
          })}

          {/* X axis labels */}
          {data.map((d) => (
            <text
              key={`l-${d.label}`}
              x={(xScale(d.label) || 0) + xScale.bandwidth() / 2}
              y={innerHeight + 16}
              textAnchor="middle"
              fontSize={9}
              fill="#a3a3a3"
            >
              {d.label}
            </text>
          ))}

          <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke="#e5e5e5" strokeWidth={1} />
        </g>
      </svg>
    </div>
  );
}
