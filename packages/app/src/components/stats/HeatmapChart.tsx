import type { StatsChartDatum } from "@readany/core/stats";
import { cn } from "@readany/core/utils";

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfWeek(date: Date): Date {
  const next = startOfWeek(date);
  next.setDate(next.getDate() + 6);
  return next;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLabel(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(date);
}

function getIntensity(value: number, maxValue: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || maxValue <= 0) return 0;
  const ratio = value / maxValue;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.3) return 2;
  return 1;
}

function intensityClass(level: 0 | 1 | 2 | 3 | 4) {
  const palette = [
    "border-border/50 bg-muted/45",
    "border-primary/8 bg-primary/[0.08]",
    "border-primary/12 bg-primary/[0.14]",
    "border-primary/20 bg-primary/[0.22]",
    "border-primary/30 bg-primary/[0.32]",
  ] as const;

  return palette[level];
}

interface HeatmapChartProps {
  data: StatsChartDatum[];
  emptyMessage?: string;
  isZh?: boolean;
  lowLabel: string;
  highLabel: string;
  activeDaysLabel: (count: number) => string;
}

export function HeatmapChart({
  data,
  emptyMessage,
  isZh = false,
  lowLabel,
  highLabel,
  activeDaysLabel,
}: HeatmapChartProps) {
  const locale = isZh ? "zh-CN" : "en-US";
  const positiveData = data.filter((item) => item.value > 0);

  if (data.length === 0 || positiveData.length === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => a.key.localeCompare(b.key));
  const firstDate = startOfWeek(new Date(`${sorted[0].key}T00:00:00`));
  const lastDate = endOfWeek(new Date(`${sorted[sorted.length - 1].key}T00:00:00`));
  const maxValue = Math.max(...positiveData.map((item) => item.value), 0);
  const dataMap = new Map(sorted.map((item) => [item.key, item.value]));
  const weeks: Array<{ label: string; cells: Array<{ key: string; date: Date; value: number; inRange: boolean }> }> = [];
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2024, 0, 1 + index);
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  });

  const cursor = new Date(firstDate);
  while (cursor <= lastDate) {
    const weekStart = new Date(cursor);
    const cells: Array<{ key: string; date: Date; value: number; inRange: boolean }> = [];

    for (let day = 0; day < 7; day += 1) {
      const current = new Date(weekStart);
      current.setDate(weekStart.getDate() + day);
      const key = toDateKey(current);
      cells.push({
        key,
        date: current,
        value: dataMap.get(key) ?? 0,
        inRange: dataMap.has(key),
      });
    }

    weeks.push({
      label: String(weekStart.getDate()),
      cells,
    });

    cursor.setDate(cursor.getDate() + 7);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 sm:grid-cols-[56px_minmax(0,1fr)]">
        <div className="grid grid-rows-7 gap-2 pt-8">
          {weekdayLabels.map((label, index) => (
            <div
              key={`${label}-${index}`}
              className="flex h-5 items-center text-[11px] text-muted-foreground sm:h-6"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="min-w-0 overflow-x-auto">
          <div className="inline-grid min-w-fit gap-2">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(36px, 36px))` }}
            >
              {weeks.map((week, index) => (
                <div key={`${week.label}-${index}`} className="text-center text-[11px] text-muted-foreground">
                  {index === 0 || index % 2 === 1 ? week.label : ""}
                </div>
              ))}
            </div>

            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(36px, 36px))` }}
            >
              {weeks.map((week) => (
                <div key={`${week.label}-${week.cells[0]?.key ?? "week"}`} className="grid grid-rows-7 gap-2">
                  {week.cells.map((cell) => {
                    const intensity = getIntensity(cell.value, maxValue);
                    const tooltipLabel = cell.inRange
                      ? `${toLabel(cell.date, locale)} · ${Math.round(cell.value)} ${isZh ? "分钟" : "min"}`
                      : toLabel(cell.date, locale);

                    return (
                      <div
                        key={cell.key}
                        title={tooltipLabel}
                        className={cn(
                          "h-5 w-9 rounded-[8px] border transition-transform duration-150 hover:-translate-y-0.5 sm:h-6 sm:w-9",
                          cell.inRange ? intensityClass(intensity) : "border-transparent bg-transparent",
                        )}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{lowLabel}</span>
          <div className="flex items-center gap-1">
            {[0, 1, 2, 3, 4].map((level) => (
              <span
                key={level}
                className={cn("h-3 w-3 rounded-[4px] border", intensityClass(level as 0 | 1 | 2 | 3 | 4))}
              />
            ))}
          </div>
          <span>{highLabel}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {activeDaysLabel(positiveData.length)}
        </div>
      </div>
    </div>
  );
}
