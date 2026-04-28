// Each mapper is namespaced to avoid `toDomain` collisions across the
// catalog. Import either the namespace or the direct file:
//
//   import * as userMapper from '@data/mappers/userMapper';
//   import { parseUserDoc, toDomain } from '@data/mappers/userMapper';
//
// Existing callsites use the direct file import; the namespace re-exports
// here exist for ergonomic top-level imports as the catalog grows.
export * as userMapper from './userMapper';
export * as serviceAreaMapper from './serviceAreaMapper';
export * as rideServiceMapper from './rideServiceMapper';
export * as rideMapper from './rideMapper';
export * as tripEventMapper from './tripEventMapper';
export * as tripPaymentMapper from './tripPaymentMapper';
export * as userLocationMapper from './userLocationMapper';
