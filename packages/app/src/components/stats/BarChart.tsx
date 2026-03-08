/**
 * BarChart — SVG bar chart using D3 scales + React rendering
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scaleBand, scaleLinear } from "d3-scale";

interface BarData {
  label: string;
  value: number;
}

interface BarChartProps {
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

export function BarChart({ data, height = 200, emptyMessage }: BarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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

  const margin = { top: 12, right: 12, bottom: 28, left: 48 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const maxValue = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);
  const hasData = data.some((d) => d.value > 0);

  const xScale = useMemo(
    () => scaleBand<string>().domain(data.map((d) => d.label)).range([0, innerWidth]).padding(0.3),
    [data, innerWidth],
  );

  const yScale = useMemo(
    () => scaleLinear().domain([0, maxValue]).range([innerHeight, 0]).nice(),
    [maxValue, innerHeight],
  );

  // Y axis ticks
  const yTicks = useMemo(() => yScale.ticks(4), [yScale]);

  if (!hasData && emptyMessage) {
    return (
      <div ref={containerRef} className="flex items-center justify-center text-sm text-neutral-400" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }

  // Tooltip positioning helper
  const getTooltipX = (idx: number): number => {
    const d = data[idx];
    const x = (xScale(d.label) || 0) + xScale.bandwidth() / 2;
    const tooltipW = 56;
    if (x - tooltipW / 2 < 0) return tooltipW / 2;
    if (x + tooltipW / 2 > innerWidth) return innerWidth - tooltipW / 2;
    return x;
  };

  return (
    <div ref={containerRef} className="w-full">
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="barGradient" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgb(16, 185, 129)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="rgb(16, 185, 129)" stopOpacity={0.9} />
          </linearGradient>
        </defs>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Y axis grid lines & labels */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={0}
                y1={yScale(tick)}
                x2={innerWidth}
                y2={yScale(tick)}
                stroke="#f0f0f0"
                strokeWidth={1}
              />
              <text
                x={-8}
                y={yScale(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="#a3a3a3"
              >
                {formatTime(tick)}
              </text>
            </g>
          ))}

          {/* Bars */}
          {data.map((d, i) => {
            const barHeight = innerHeight - yScale(d.value);
            const x = xScale(d.label) || 0;
            const barWidth = xScale.bandwidth();
            const isHovered = hoveredIndex === i;
            return (
              <g
                key={d.label}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Invisible wider hit area */}
                <rect
                  x={x - 2}
                  y={0}
                  width={barWidth + 4}
                  height={innerHeight}
                  fill="transparent"
                />
                <rect
                  x={x}
                  y={yScale(d.value)}
                  width={barWidth}
                  height={Math.max(barHeight, 0)}
                  fill="url(#barGradient)"
                  rx={3}
                  opacity={isHovered ? 1 : 0.85}
                  className="transition-opacity"
                />
                {/* Tooltip on hover */}
                {isHovered && d.value > 0 && (
                  <g>
                    <rect
                      x={getTooltipX(i) - 28}
                      y={Math.max(yScale(d.value) - 28, 0)}
                      width={56}
                      height={20}
                      rx={4}
                      fill="#262626"
                    />
                    <text
                      x={getTooltipX(i)}
                      y={Math.max(yScale(d.value) - 28, 0) + 13}
                      textAnchor="middle"
                      fill="white"
                      fontSize={11}
                      fontWeight={500}
                    >
                      {formatTime(d.value)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* X axis labels */}
          {data.map((d) => (
            <text
              key={`label-${d.label}`}
              x={(xScale(d.label) || 0) + xScale.bandwidth() / 2}
              y={innerHeight + 18}
              textAnchor="middle"
              fontSize={11}
              fill="#a3a3a3"
            >
              {d.label}
            </text>
          ))}

          {/* Baseline */}
          <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke="#e5e5e5" strokeWidth={1} />
        </g>
      </svg>
    </div>
  );
}
