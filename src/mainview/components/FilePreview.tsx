// Rendered previews shown in place of the diff:
//   - MarkdownPreview — the selected markdown file rendered (marked →
//     DOMPurify) when the toolbar Preview toggle is on. When the file changed
//     (an old side exists and differs), the render is a GitHub-style rich
//     diff: block-level change markers from markdownDiff.ts. Styling lives
//     under `.markdown-preview` in index.css.
//   - ImagePreview — raster images, rendered by default (their "diff" would
//     otherwise be the binary placeholder). Bytes arrive base64 over the
//     readFile RPC; the webview's origin can't load repo files directly.

import DOMPurify from 'dompurify';
import { ImageOff, LoaderCircle } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../platform';
import { renderMarkdownDiff } from './markdownDiff';

export function MarkdownPreview({ source, oldSource = '' }: { source: string; oldSource?: string }) {
  const html = useMemo(() => {
    // A brand-new file gets a plain render — an all-green document carries no
    // information the file's `added` status doesn't already.
    const rich = oldSource.length > 0 && oldSource !== source;
    return DOMPurify.sanitize(
      rich
        ? renderMarkdownDiff(oldSource, source)
        : marked.parse(source, {
            gfm: true,
            async: false,
          }),
    );
  }, [
    source,
    oldSource,
  ]);
  return (
    <div
      data-testid="markdown-preview"
      className="min-h-0 flex-1 overflow-y-auto bg-background"
    >
      <div
        className="markdown-preview mx-auto max-w-3xl px-8 py-8"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized above
        dangerouslySetInnerHTML={{
          __html: html,
        }}
      />
    </div>
  );
}

type ImageState =
  | {
      kind: 'loading';
    }
  | {
      kind: 'loaded';
      src: string;
    }
  | {
      kind: 'error';
      message: string;
    };

export function ImagePreview({ path, gitRef }: { path: string; gitRef?: string }) {
  const [state, setState] = useState<ImageState>({
    kind: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    setState({
      kind: 'loading',
    });
    api
      .readFile({
        path,
        ref: gitRef,
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setState(
          payload.ok
            ? {
                kind: 'loaded',
                src: `data:${payload.mime};base64,${payload.base64}`,
              }
            : {
                kind: 'error',
                message: payload.error,
              },
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    path,
    gitRef,
  ]);

  return (
    <div
      data-testid="image-preview"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden bg-background p-6"
    >
      {state.kind === 'loading' ? (
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
      ) : state.kind === 'error' ? (
        <>
          <ImageOff className="size-8 text-muted-foreground opacity-40" />
          <span className="text-sm text-muted-foreground">{state.message}</span>
        </>
      ) : (
        <>
          {/* Checkered backdrop so transparent regions read as transparent. */}
          <img
            src={state.src}
            alt={path}
            className="max-h-full min-h-0 max-w-full rounded-md object-contain shadow-sm [background-image:repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] [background-size:16px_16px]"
          />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{path}</span>
        </>
      )}
    </div>
  );
}
