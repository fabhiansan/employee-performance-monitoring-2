import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SortDirection, SortState } from '@/types/models';

interface SortableColumnHeaderProps<TColumn extends string = string> {
  columnId: TColumn;
  title: ReactNode;
  sort?: SortState<TColumn> | null;
  onSortChange?: (next: SortState<TColumn> | null) => void;
  align?: 'left' | 'center' | 'right';
  disabled?: boolean;
  className?: string;
}

const nextDirection = (direction?: SortDirection): SortDirection | null => {
  if (!direction) return 'asc';
  if (direction === 'asc') return 'desc';
  return null;
};

export function SortableColumnHeader<TColumn extends string = string>({
  columnId,
  title,
  sort,
  onSortChange,
  align = 'left',
  disabled = false,
  className,
}: SortableColumnHeaderProps<TColumn>) {
  const isActive = sort?.column === columnId;
  const direction = isActive ? sort?.direction : undefined;

  const handleClick = useCallback(() => {
    if (!onSortChange || disabled) {
      return;
    }

    const next = nextDirection(direction);
    if (!next) {
      onSortChange(null);
      return;
    }
    onSortChange({ column: columnId, direction: next });
  }, [columnId, direction, disabled, onSortChange]);

  const alignmentClass =
    align === 'right'
      ? 'justify-end text-right'
      : align === 'center'
        ? 'justify-center text-center'
        : 'justify-start text-left';

  const icon = !isActive
    ? <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />
    : direction === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
      : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />;

  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1 rounded px-0 py-0.5 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        alignmentClass,
        disabled ? 'cursor-default opacity-60' : 'hover:text-foreground',
        className,
      )}
      onClick={handleClick}
      disabled={disabled}
    >
      <span className="truncate">{title}</span>
      {icon}
    </button>
  );
}
