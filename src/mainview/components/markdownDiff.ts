// Rendered-markdown diff for preview mode — GitHub's "rich diff" idea at the
// block level. Both versions are lexed into marked's block tokens, the two
// token sequences are LCS-diffed by their raw text, and consecutive same-kind
// blocks render as one marked run (.md-block-added / .md-block-removed,
// styled in index.css). Unchanged blocks render plain.
//
// Container descent, recursively: marked lexes a whole list or table as ONE
// block token, so a single edited bullet would flag the entire container.
// An edit pair (removed run + added run) therefore gets its substantive
// tokens aligned BY TYPE, and every aligned list↔list / table↔table pair
// descends one level — items/rows are LCS-diffed the same way and the
// container renders ONCE with only the changed entries marked (.md-li-* /
// .md-row-*). A changed item pair that still shares whole sub-blocks (the
// edit is somewhere inside, e.g. a nested list) recurses into this module's
// entry point, so only the innermost changed bullets carry marks. Structural
// mismatches (ul↔ol, a changed table header) and pairs with nothing to
// descend into keep the two-box presentation.
//
// Word-level highlights were tried and reverted: weaving struck/highlighted
// words into rendered prose made the result harder to read than
// old-block-above-new-block.
//
// Pure string → HTML (marked only, no DOM): the caller sanitizes the result
// (DOMPurify in FilePreview.tsx), and tests can run under bun without a DOM.

import { marked, type Token, type Tokens } from 'marked';
import '../../shared/obsidianMarkdown';

type Kind = 'equal' | 'added' | 'removed';

interface Run {
  kind: Kind;
  tokens: Token[];
}

/** Classic LCS walk over two key sequences, emitting per-item ops in order.
 * Removals emit before insertions, so old content reads above new. Sizes are
 * block/item counts (hundreds at most), so the O(n·m) table is fine. */
function lcsWalk(aKeys: string[], bKeys: string[], emit: (kind: Kind, aIndex: number, bIndex: number) => void): void {
  const n = aKeys.length;
  const m = bKeys.length;
  // lcs[i][j] = LCS length of aKeys[i..] vs bKeys[j..].
  const lcs: Int32Array[] = Array.from(
    {
      length: n + 1,
    },
    () => new Int32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = aKeys[i] === bKeys[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aKeys[i] === bKeys[j]) {
      emit('equal', i, j);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      emit('removed', i, -1);
      i++;
    } else {
      emit('added', -1, j);
      j++;
    }
  }
  for (; i < n; i++) {
    emit('removed', i, -1);
  }
  for (; j < m; j++) {
    emit('added', -1, j);
  }
}

/** Identity of a block for matching: its raw text minus trailing blank lines,
 * so reflowing the gaps between blocks doesn't read as a content change.
 * Every blank-line ('space') token collapses to the same key. */
function keyOf(token: Token): string {
  return token.raw.replace(/\n+$/, '');
}

function isSpaceRun(run: Run): boolean {
  return run.tokens.every((token) => token.type === 'space');
}

/** Block-level LCS over the two token sequences, grouped into runs. */
function diffTokens(oldTokens: Token[], newTokens: Token[]): Run[] {
  const runs: Run[] = [];
  const push = (kind: Kind, token: Token) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) {
      last.tokens.push(token);
    } else {
      runs.push({
        kind,
        tokens: [
          token,
        ],
      });
    }
  };
  lcsWalk(oldTokens.map(keyOf), newTokens.map(keyOf), (kind, aIndex, bIndex) => {
    // Render the NEW side of a match (gap reflow may differ).
    push(kind, kind === 'removed' ? oldTokens[aIndex] : newTokens[bIndex]);
  });

  // A blank-line-only equal run between two same-kind changed runs would split
  // one logical change into two marker boxes; fold it into a single run.
  for (let k = runs.length - 2; k >= 1; k--) {
    const prev = runs[k - 1];
    const mid = runs[k];
    const next = runs[k + 1];
    if (mid.kind === 'equal' && isSpaceRun(mid) && prev.kind === next.kind && prev.kind !== 'equal') {
      prev.tokens.push(...mid.tokens, ...next.tokens);
      runs.splice(k, 2);
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Container descent.

const TABLE_ROW_KEY = (row: Tokens.TableCell[]) => row.map((cell) => cell.text).join('\x1f');

/** Whether an aligned token pair can be diffed one level deeper instead of
 * boxed whole: same-shape lists, or tables sharing their header row. */
function canDescend(oldToken: Token, newToken: Token): boolean {
  if (oldToken.type === 'list' && newToken.type === 'list') {
    return (oldToken as Tokens.List).ordered === (newToken as Tokens.List).ordered;
  }
  if (oldToken.type === 'table' && newToken.type === 'table') {
    return TABLE_ROW_KEY((oldToken as Tokens.Table).header) === TABLE_ROW_KEY((newToken as Tokens.Table).header);
  }
  return false;
}

/** Marker class on the first element of an HTML fragment (an <li> or <tr>). */
function markFragment(html: string, cls: string): string {
  return html.replace(/<(li|tr)/, `<$1 class="${cls}"`);
}

/** One list item rendered exactly as marked would render it in place: a
 * single-item clone of its parent list (loose flag, task checkboxes and
 * nesting all handled by the lib), with the <ul>/<ol> wrapper stripped. */
function renderListItem(list: Tokens.List, item: Tokens.ListItem): string {
  const single = {
    ...list,
    items: [
      item,
    ],
    raw: item.raw,
  };
  return marked
    .parser([
      single as Token,
    ])
    .replace(/^<[ou]l[^>]*>\s*/, '')
    .replace(/\s*<\/[ou]l>\s*$/, '');
}

/**
 * A changed item pair. When the two versions still share whole sub-blocks,
 * the edit is somewhere INSIDE the item (typically a nested list) — recurse,
 * so only the innermost change carries marks. Otherwise the item itself is
 * the change: old (removed) above new (added). Task items never recurse —
 * the bare-<li> recursive render would drop their checkbox.
 */
function renderListItemPair(
  oldList: Tokens.List,
  newList: Tokens.List,
  oldItem: Tokens.ListItem,
  newItem: Tokens.ListItem,
): string {
  const newKeys = new Set(newItem.tokens.filter((token) => token.type !== 'space').map(keyOf));
  const shared = oldItem.tokens.some((token) => token.type !== 'space' && newKeys.has(keyOf(token)));
  if (!shared || oldItem.task || newItem.task) {
    return `${markFragment(renderListItem(oldList, oldItem), 'md-li-removed')}\n${markFragment(
      renderListItem(newList, newItem),
      'md-li-added',
    )}`;
  }
  return `<li>${renderTokensDiff(oldItem.tokens, newItem.tokens)}</li>`;
}

/** The edited list pair rendered as ONE list with changed items marked.
 * Removed and added items between two anchors pair up positionally, so an
 * edited item can recurse instead of rendering as a remove + insert. */
function renderListDiff(oldList: Tokens.List, newList: Tokens.List): string {
  const itemKey = (item: Tokens.ListItem) => item.raw.trim();
  const parts: string[] = [];
  const pendingOld: Tokens.ListItem[] = [];
  const pendingNew: Tokens.ListItem[] = [];
  const flushPending = () => {
    const pairs = Math.min(pendingOld.length, pendingNew.length);
    for (let k = 0; k < pairs; k++) {
      parts.push(renderListItemPair(oldList, newList, pendingOld[k], pendingNew[k]));
    }
    for (const item of pendingOld.slice(pairs)) {
      parts.push(markFragment(renderListItem(oldList, item), 'md-li-removed'));
    }
    for (const item of pendingNew.slice(pairs)) {
      parts.push(markFragment(renderListItem(newList, item), 'md-li-added'));
    }
    pendingOld.length = 0;
    pendingNew.length = 0;
  };
  lcsWalk(oldList.items.map(itemKey), newList.items.map(itemKey), (kind, aIndex, bIndex) => {
    if (kind === 'equal') {
      flushPending();
      parts.push(renderListItem(newList, newList.items[bIndex]));
    } else if (kind === 'removed') {
      pendingOld.push(oldList.items[aIndex]);
    } else {
      pendingNew.push(newList.items[bIndex]);
    }
  });
  flushPending();
  const tag = newList.ordered ? 'ol' : 'ul';
  const start = newList.ordered && newList.start !== '' && newList.start !== 1 ? ` start="${newList.start}"` : '';
  return `<${tag}${start}>\n${parts.join('\n')}\n</${tag}>\n`;
}

/** One table row rendered by marked via a single-row clone of its parent
 * table (cell alignment preserved), extracted from the clone's <tbody>. */
function renderTableRow(table: Tokens.Table, row: Tokens.TableCell[]): string {
  const single = {
    ...table,
    rows: [
      row,
    ],
  };
  const html = marked.parser([
    single as Token,
  ]);
  return /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1]?.trim() ?? '';
}

/** The edited table pair rendered as ONE table with changed rows marked. */
function renderTableDiff(oldTable: Tokens.Table, newTable: Tokens.Table): string {
  const parts: string[] = [];
  lcsWalk(oldTable.rows.map(TABLE_ROW_KEY), newTable.rows.map(TABLE_ROW_KEY), (kind, aIndex, bIndex) => {
    if (kind === 'equal') {
      parts.push(renderTableRow(newTable, newTable.rows[bIndex]));
    } else if (kind === 'added') {
      parts.push(markFragment(renderTableRow(newTable, newTable.rows[bIndex]), 'md-row-added'));
    } else {
      // Old rows render with the OLD table's alignment.
      parts.push(markFragment(renderTableRow(oldTable, oldTable.rows[aIndex]), 'md-row-removed'));
    }
  });
  const header =
    /<thead>[\s\S]*?<\/thead>/.exec(
      marked.parser([
        newTable as Token,
      ]),
    )?.[0] ?? '';
  return `<table>\n${header}\n<tbody>${parts.join('\n')}\n</tbody></table>\n`;
}

function renderContainerDiff(oldToken: Token, newToken: Token): string {
  return oldToken.type === 'list'
    ? renderListDiff(oldToken as Tokens.List, newToken as Tokens.List)
    : renderTableDiff(oldToken as Tokens.Table, newToken as Tokens.Table);
}

function renderBoxedTokens(kind: Kind, tokens: Token[]): string {
  return `<div class="md-block-${kind}">${marked.parser(tokens)}</div>`;
}

/**
 * An edit pair with its substantive tokens aligned BY TYPE, so a descendable
 * container pairs up even when the runs also carry other changed blocks
 * (e.g. a list plus a new trailing paragraph). Aligned containers descend;
 * everything else collects into removed/added boxes around them. Null when
 * nothing is descendable — one grouped box pair reads better than many.
 */
function renderEditedPair(removed: Run, added: Run): string | null {
  const oldTokens = removed.tokens.filter((token) => token.type !== 'space');
  const newTokens = added.tokens.filter((token) => token.type !== 'space');
  const ops: {
    kind: Kind;
    aIndex: number;
    bIndex: number;
  }[] = [];
  lcsWalk(
    oldTokens.map((token) => token.type),
    newTokens.map((token) => token.type),
    (kind, aIndex, bIndex) =>
      ops.push({
        kind,
        aIndex,
        bIndex,
      }),
  );
  if (!ops.some((op) => op.kind === 'equal' && canDescend(oldTokens[op.aIndex], newTokens[op.bIndex]))) {
    return null;
  }

  let out = '';
  let removedBuf: Token[] = [];
  let addedBuf: Token[] = [];
  const flushBufs = () => {
    if (removedBuf.length > 0) {
      out += renderBoxedTokens('removed', removedBuf);
      removedBuf = [];
    }
    if (addedBuf.length > 0) {
      out += renderBoxedTokens('added', addedBuf);
      addedBuf = [];
    }
  };
  for (const op of ops) {
    if (op.kind === 'equal' && canDescend(oldTokens[op.aIndex], newTokens[op.bIndex])) {
      flushBufs();
      out += renderContainerDiff(oldTokens[op.aIndex], newTokens[op.bIndex]);
    } else if (op.kind === 'removed') {
      removedBuf.push(oldTokens[op.aIndex]);
    } else if (op.kind === 'added') {
      addedBuf.push(newTokens[op.bIndex]);
    } else {
      // Same type, not descendable: a changed paragraph/heading/etc.
      removedBuf.push(oldTokens[op.aIndex]);
      addedBuf.push(newTokens[op.bIndex]);
    }
  }
  flushBufs();
  return out;
}

/** Render a block-token-level diff — the recursive core (list items whose
 * edit sits deeper re-enter here with their own sub-tokens). */
function renderTokensDiff(oldTokens: Token[], newTokens: Token[]): string {
  const runs = diffTokens(oldTokens, newTokens);
  const renderBox = (run: Run): string => {
    const html = marked.parser(run.tokens);
    // Blank-line-only changes have nothing visible to mark.
    if (run.kind === 'equal' || isSpaceRun(run)) {
      return html;
    }
    return `<div class="md-block-${run.kind}">${html}</div>`;
  };

  let out = '';
  for (let k = 0; k < runs.length; k++) {
    const run = runs[k];
    const next = runs[k + 1];
    if (run.kind === 'removed' && next?.kind === 'added') {
      const merged = renderEditedPair(run, next);
      if (merged !== null) {
        out += merged;
        k++;
        continue;
      }
    }
    out += renderBox(run);
  }
  return out;
}

/**
 * Unsanitized HTML of the rendered block diff from `oldSource` to
 * `newSource`. Identical sources (or an empty old side worth no markers —
 * the caller decides) still work: everything comes out as one kind of run.
 */
export function renderMarkdownDiff(oldSource: string, newSource: string): string {
  return renderTokensDiff(marked.lexer(oldSource), marked.lexer(newSource));
}
