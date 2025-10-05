import { createContext, useContext } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Legend, Tooltip } from 'recharts';
import type {
  DefaultLegendContentProps,
  LegendPayload,
  TooltipContentProps,
} from 'recharts';
import { cn } from '@/lib/utils';

interface ChartConfigItem {
  label: string;
  color?: string;
}

export interface ChartConfig {
  [key: string]: ChartConfigItem;
}

interface ChartContextValue {
  config: ChartConfig;
}

const ChartConfigContext = createContext<ChartContextValue>({ config: {} });

const toCSSVariables = (config: ChartConfig) => {
  return Object.entries(config).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value.color) {
      acc[`--color-${key}`] = value.color;
    }
    return acc;
  }, {});
};

interface ChartContainerProps {
  config: ChartConfig;
  className?: string;
  children: ReactNode;
}

export function ChartContainer({ config, className, children }: ChartContainerProps) {
  return (
    <ChartConfigContext.Provider value={{ config }}>
      <div className={cn('w-full', className)} style={toCSSVariables(config)}>
        {children}
      </div>
    </ChartConfigContext.Provider>
  );
}

const useChartConfig = () => {
  const context = useContext(ChartConfigContext);
  return context.config;
};

interface ChartTooltipItem {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
}

const isTooltipItem = (item: unknown): item is ChartTooltipItem => {
  return typeof item === 'object' && item !== null && 'value' in item;
};

export function ChartTooltipContent({ active, payload, label }: TooltipContentProps<number | string, string>) {
  const config = useChartConfig();
  const resolvedPayload = Array.isArray(payload) ? payload.filter(isTooltipItem) : [];

  if (!active || resolvedPayload.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-md border bg-background p-3 text-xs shadow">
      {label ? <div className="font-medium">{label}</div> : null}
      <div className="grid gap-1">
        {resolvedPayload.map((item) => {
          const key = typeof item.dataKey === 'string'
            ? item.dataKey
            : String(item.dataKey ?? item.name ?? 'value');
          const configItem = config[key];
          const color = typeof item.color === 'string'
            ? item.color
            : configItem?.color ?? 'hsl(var(--foreground))';
          const labelText = configItem?.label ?? (typeof item.name === 'string' ? item.name : key);
          const valueText = typeof item.value === 'number'
            ? item.value.toLocaleString()
            : typeof item.value === 'string'
              ? item.value
              : '';
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                <span>{labelText}</span>
              </div>
              <span className="font-semibold">{valueText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChartTooltipProps extends Omit<ComponentProps<typeof Tooltip>, 'content'> {
  content?: ComponentProps<typeof Tooltip>['content'];
}

export function ChartTooltip({ content, ...props }: ChartTooltipProps) {
  const renderChartTooltipContent = ((tooltipProps: TooltipContentProps<number | string, string>) => (
    <ChartTooltipContent {...tooltipProps} />
  )) as ComponentProps<typeof Tooltip>['content'];

  return <Tooltip {...props} content={content ?? renderChartTooltipContent} />;
}

export function ChartLegendContent({ payload }: DefaultLegendContentProps) {
  const config = useChartConfig();
  const resolvedPayload: readonly LegendPayload[] = Array.isArray(payload) ? payload : [];

  if (resolvedPayload.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-4 text-xs">
      {resolvedPayload.map((entry) => {
        const key = typeof entry.dataKey === 'string'
          ? entry.dataKey
          : String(entry.dataKey ?? entry.value ?? 'value');
        const configItem = config[key];
        const color = typeof entry.color === 'string'
          ? entry.color
          : configItem?.color ?? 'hsl(var(--muted-foreground))';
        const labelText = configItem?.label ?? (typeof entry.value === 'string' ? entry.value : key);
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="font-medium">{labelText}</span>
          </div>
        );
      })}
    </div>
  );
}

interface ChartLegendProps extends Omit<ComponentProps<typeof Legend>, 'content'> {
  content?: ComponentProps<typeof Legend>['content'];
}

export function ChartLegend({ content, ...props }: ChartLegendProps) {
  const renderChartLegendContent = (legendProps: DefaultLegendContentProps) => (
    <ChartLegendContent {...legendProps} />
  );

  return <Legend {...props} content={content ?? renderChartLegendContent} />;
}
