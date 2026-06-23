/**
 * Format a metre distance as a rider-/driver-facing "miles away" string.
 * Lives at the neutral `presentation/utils/` location so the driver's
 * available-ride cards (`DriverRideCard`) and the dispatch panel
 * (`DriverDispatchScreen`) share one formatter — same labels the legacy
 * app used ("0.8 mi away").
 *
 * The input is the Haversine distance from `Coordinates.distanceTo`
 * (metres). Examples:
 *   formatMilesAway(120)    → 'Right here'   (< 0.1 mi)
 *   formatMilesAway(1_300)  → '0.8 mi away'
 *   formatMilesAway(40_000) → '25 mi away'
 */
export function formatMilesAway(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return 'Right here';
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}
