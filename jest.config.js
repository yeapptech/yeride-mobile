/** @type {import('jest').Config} */
// Under RN 0.83 (Expo SDK 55's recommended pair), the jest preset is still
// bundled inside `react-native`, so `jest-expo` works normally. RN 0.85
// extracted it into `@react-native/jest-preset`; if we later upgrade RN past
// the SDK 55 line we'll need to switch presets.
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.ts',
    '<rootDir>/src/**/__tests__/**/*.test.tsx',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/ios/',
    '/android/',
    '/.expo/',
    '/dist/',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@data/(.*)$': '<rootDir>/src/data/$1',
    '^@presentation/(.*)$': '<rootDir>/src/presentation/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  transformIgnorePatterns: [
    // Allow Babel to transform any expo-*, @expo/*, RN, and JSX-shipping
    // packages whose source is shipped as .ts. expo-modules-core in
    // particular ships .ts polyfills loaded by the jest-expo preset.
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo|expo-[\\w-]+|@expo/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|react-native-css-interop|react-native-maps|react-native-google-places-autocomplete|react-native-toast-message|@gorhom/bottom-sheet)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/index.ts',
    // Repository interfaces are type-only (no executable lines); they report
    // 0/0/0/0 and would sink the aggregate domain threshold below.
    '!src/domain/repositories/**',
  ],
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
    // Directory-path key (not a glob) => Jest applies these to the AGGREGATE
    // coverage of the domain layer, not per individual file. A glob key
    // ('src/domain/**/*.ts') applies per-file, which is unattainable for
    // pure type/enum guards (Role, VehicleClass, …) and sank CI permanently.
    'src/domain/': {
      branches: 88,
      functions: 95,
      lines: 95,
      statements: 94,
    },
  },
  clearMocks: true,
};
