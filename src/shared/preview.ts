// File-type knowledge for inline previews, shared by the Bun side (mime type
// for the readFile RPC) and the UI (which files get a preview at all).
//
// Two preview families today:
//   - images   — binary formats git can't diff; rendered by default.
//   - markdown — text that diffs normally; an explicit toolbar toggle switches
//                the pane to the rendered document. (SVG/PDF may join later.)

/** Lowercased extension (no dot) of a repo-relative path; '' when none. */
function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Browser-renderable raster image formats, by extension. */
const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

/** The mime type to render `path` as an image, or null when it isn't one. */
export function imageMime(path: string): string | null {
  return IMAGE_MIMES[extensionOf(path)] ?? null;
}

/** True for files the markdown preview toggle applies to. */
export function isMarkdownPath(path: string): boolean {
  const ext = extensionOf(path);
  return ext === 'md' || ext === 'markdown' || ext === 'mdx';
}

/** Whether the preview toggle has anything to render for this change: a
 * markdown file with a "new" side (deleted files have nothing to preview). */
export function canPreviewMarkdown(file: { path: string; binary: boolean; newContents: string }): boolean {
  return !file.binary && file.newContents.length > 0 && isMarkdownPath(file.path);
}
