// Switches what the review compares: the working tree (default), a single
// commit (vs its parent), or an arbitrary base..head range.

import { useState } from 'react';
import { useReviewStore } from '../store';

const FIELD = 'rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-neutral-200 outline-none';

export function CompareSelector() {
  const compare = useReviewStore((state) => state.compare);
  const setCompare = useReviewStore((state) => state.setCompare);
  const [ref, setRef] = useState('HEAD');
  const [base, setBase] = useState('main');
  const [head, setHead] = useState('HEAD');

  return (
    <div className="flex items-center gap-1 text-xs">
      <select
        className={FIELD}
        value={compare.kind}
        onChange={(event) => {
          const kind = event.target.value;
          if (kind === 'working') {
            void setCompare({
              kind: 'working',
            });
          } else if (kind === 'commit') {
            void setCompare({
              kind: 'commit',
              ref,
            });
          } else {
            void setCompare({
              kind: 'range',
              base,
              head,
            });
          }
        }}
      >
        <option value="working">Working tree</option>
        <option value="commit">Commit</option>
        <option value="range">Range</option>
      </select>

      {compare.kind === 'commit' ? (
        <input
          className={`${FIELD} w-28`}
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
        <>
          <input
            className={`${FIELD} w-24`}
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
          <span className="text-neutral-500">..</span>
          <input
            className={`${FIELD} w-24`}
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
        </>
      ) : null}
    </div>
  );
}
