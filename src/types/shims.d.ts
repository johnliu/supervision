// Electrobun is distributed as TypeScript source (its package `exports` point at
// `.ts` files), so `tsc` type-checks Electrobun's own modules as part of our
// program. One of them imports `three` without bundled types. We don't use
// `three`; this ambient declaration silences the implicit-any error so our own
// typecheck stays green. `skipLibCheck` does not help here because the offending
// file is `.ts` source, not a `.d.ts`.
declare module 'three';
