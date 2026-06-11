// Switches what the review compares: the working tree (default), a single
// commit (vs its parent), or an arbitrary base..head range. Stacks vertically
// to fit its home in the sidebar footer.

import { useState } from 'react';
import { useReviewStore } from '../store';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function CompareSelector() {
  const compare = useReviewStore((state) => state.compare);
  const setCompare = useReviewStore((state) => state.setCompare);
  const [ref, setRef] = useState('HEAD');
  const [base, setBase] = useState('main');
  const [head, setHead] = useState('HEAD');

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={compare.kind}
        onValueChange={(kind) => {
          if (kind === 'working') {
            void setCompare({
              kind: 'working',
            });
          } else if (kind === 'commit') {
            void setCompare({
              kind: 'commit',
              ref,
            });
          } else if (kind === 'range') {
            void setCompare({
              kind: 'range',
              base,
              head,
            });
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="working">Working tree</SelectItem>
          <SelectItem value="commit">Commit</SelectItem>
          <SelectItem value="range">Range</SelectItem>
        </SelectContent>
      </Select>

      {compare.kind === 'commit' ? (
        <Input
          className="h-8 w-full"
          value={ref}
          placeholder="ref"
          onChange={(event) => setRef(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void setCompare({
                kind: 'commit',
                ref,
              });
            }
          }}
          onBlur={() =>
            void setCompare({
              kind: 'commit',
              ref,
            })
          }
        />
      ) : null}

      {compare.kind === 'range' ? (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-8 min-w-0 flex-1"
            value={base}
            placeholder="base"
            onChange={(event) => setBase(event.target.value)}
            onBlur={() =>
              void setCompare({
                kind: 'range',
                base,
                head,
              })
            }
          />
          <span className="text-muted-foreground">..</span>
          <Input
            className="h-8 min-w-0 flex-1"
            value={head}
            placeholder="head"
            onChange={(event) => setHead(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void setCompare({
                  kind: 'range',
                  base,
                  head,
                });
              }
            }}
            onBlur={() =>
              void setCompare({
                kind: 'range',
                base,
                head,
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}
