// A single keycap chip. Used by the shortcuts cheat sheet and inside toolbar
// tooltips, so the same key reads identically everywhere.

import { cn } from '@/lib/utils';

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        // capitalize: bare letter keys ('a', 'j') read as keycaps ('A', 'J');
        // word tokens ('Esc', 'Space') already lead with a capital.
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[0.7rem] text-foreground capitalize shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
