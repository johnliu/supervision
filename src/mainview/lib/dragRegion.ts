// Electrobun window-drag regions. The desktop preload (electrobun's
// dragRegions.ts) starts a native window move on mousedown inside an element
// carrying DRAG_REGION, unless a nearer ancestor carries NO_DRAG_REGION — the
// same drag/no-drag model as Electron's `-webkit-app-region`, but matched by
// these class names rather than a CSS property (WKWebView has no app-region).
//
// The pattern: mark the window shell DRAG_REGION, then punch NO_DRAG_REGION
// holes over every interactive surface (the content card, the toolbar, the
// sidebar's controls). What's left draggable is the inset frame around the
// card plus the sidebar's top band — the title-bar area.
//
// Inert in web mode (no preload listening, no matching CSS), so safe to apply
// unconditionally — web and e2e behavior is unchanged.
//
// Each class also carries cursor/selection utilities: a drag region pins the
// arrow cursor and disables text selection (otherwise a mousedown-drag starts
// a selection and flips to the I-beam mid-move), and a no-drag region resets
// both so the content underneath selects and shows cursors normally. These are
// per-element classes, so an element with its own `select-none` (the diff
// CodeView) still wins for its own subtree.

export const DRAG_REGION = 'electrobun-webkit-app-region-drag cursor-default select-none';
export const NO_DRAG_REGION = 'electrobun-webkit-app-region-no-drag cursor-auto select-text';
