/// <reference types="nativewind/types" />

// Allow `import './global.css'` (and any other side-effect-only stylesheet
// imports) to typecheck. NativeWind's Metro transformer turns the CSS into
// runtime style data — the JS side just needs the import to be picked up.
declare module '*.css';

// Phase 9 Turn 7 — bundled PNG / image assets (e.g. card-brand glyphs
// under `src/presentation/components/payment/assets/`). Metro's
// asset-registry transformer rewrites these imports into a numeric
// asset id at build time; React Native's `Image.source` prop accepts
// `number` directly, so the runtime is happy. Kept here alongside the
// `*.css` declaration since both are non-TS Metro-handled imports.
declare module '*.png' {
  const value: number;
  export default value;
}
declare module '*.jpg' {
  const value: number;
  export default value;
}
declare module '*.jpeg' {
  const value: number;
  export default value;
}
declare module '*.gif' {
  const value: number;
  export default value;
}
