/// <reference types="nativewind/types" />

// Allow `import './global.css'` (and any other side-effect-only stylesheet
// imports) to typecheck. NativeWind's Metro transformer turns the CSS into
// runtime style data — the JS side just needs the import to be picked up.
declare module '*.css';
