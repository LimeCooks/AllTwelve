import * as React from 'react';

import { cn } from '@/lib/utils';
import { ChevronDownIcon } from 'lucide-react';

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default';
};

function NativeSelect({
  className,
  size = 'default',
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        'group/native-select relative w-fit has-[select:disabled]:opacity-50',
        className,
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="border-input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-10 w-full min-w-0 cursor-pointer appearance-none rounded-xl border bg-transparent py-1.5 pr-10 pl-3 text-sm font-semibold transition-[background-color,border-color,box-shadow] select-none hover:border-slate-500 focus-visible:ring-3 aria-invalid:ring-3 data-[size=sm]:h-8 data-[size=sm]:rounded-lg data-[size=sm]:py-0.5 outline-none disabled:pointer-events-none disabled:cursor-not-allowed"
        {...props}
      />
      <ChevronDownIcon
        className="text-muted-foreground top-1/2 right-2.5 size-4 -translate-y-1/2 pointer-events-none absolute select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  );
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<'option'>) {
  return (
    <option
      data-slot="native-select-option"
      className={cn('bg-slate-950 py-2 text-slate-100', className)}
      {...props}
    />
  );
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn('bg-slate-950 text-slate-100', className)}
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
