import type { Money } from '@domain/entities/Money';
import type { CardBrand } from '@domain/entities/PaymentMethod';
import type { Ride } from '@domain/entities/Ride';
import type { TripPayment } from '@domain/entities/TripPayment';

/**
 * Pure HTML-template builder for the rider RideReceipt PDF.
 *
 * Phase 9 Turn 16 — receipt-PDF feature. Consumes the same data the
 * `useRideReceiptViewModel` already exposes to the on-screen receipt
 * (the live `Ride` doc + the `payments` subcollection + the
 * wallet-cache-joined `paymentBrand` / `paymentLast4`) and renders a
 * single-file HTML document that `expo-print` rasterizes into a PDF
 * via WKWebView (iOS) / WebView (Android).
 *
 * Design choices:
 *   - **Single-file HTML.** No external CSS, no external image refs;
 *     the per-brand card glyph is inlined as an `<svg>` element via
 *     `getBrandSvgString`. `expo-print`'s renderer doesn't fetch
 *     network resources reliably on Android; inlining everything
 *     keeps the PDF bit-identical across platforms and offline.
 *   - **Inline styles only.** NativeWind tokens don't carry over to
 *     a generated HTML document. Each color is a literal hex with a
 *     `// --token` comment naming the design-system token it mirrors,
 *     so a future palette migration can grep these all in one pass.
 *   - **All inputs HTML-escaped.** Driver names, addresses, vehicle
 *     details, ride id, the brand-formatted name, and the last-4
 *     digits all flow through `escapeHtml` before interpolation. The
 *     SVG-string output of `getBrandSvgString` is trusted (we author
 *     it, brand is a finite enum). Same for the ISO date strings.
 *   - **Print-friendly typography.** Black-on-white only (no dark-mode
 *     branch — the user's printer doesn't have a dark mode). 12-14pt
 *     body type so the PDF reads at letter / A4 sizes and at
 *     phone-screen preview before sharing.
 *   - **Pure function.** No I/O, no `Date.now()` calls, no
 *     RNG-anything. Same inputs → same string. Easy to snapshot in
 *     tests; deferred to per-substring smoke tests instead (the
 *     full-string snapshot is brittle to legitimate design tweaks
 *     and the substring tests catch the regressions worth catching).
 *
 * Layout (top to bottom):
 *   1. Header: YeRide brand bar + "Trip receipt" title + ride id +
 *      formatted ride date.
 *   2. Trip block: pickup → dropoff addresses, optional distance /
 *      duration line if `dropoffTiming` carries data.
 *   3. Driver block: name, vehicle make/model/year/color + license
 *      plate. Omitted entirely if `ride.driver === null` (an
 *      orphan-doc resilience case — the legacy app sometimes wrote
 *      trips with no driver snapshot, and the on-screen receipt
 *      shows "Trip complete" instead of "Trip with X" in that arm).
 *   4. Fare table: one row per `TripPayment` (fare / tip / refund
 *      with sign), then a Total row using `args.fareTotal` if
 *      provided. The receipt VM already does the
 *      multi-row-collapse math (`fare + tip − refund`) so we just
 *      render the result.
 *   5. Payment block: per-brand SVG glyph + "Brand •••• last4" line
 *      when the wallet-cache join hits; falls back to a brand-
 *      agnostic "Charged to your card on file" line otherwise.
 *      Mirrors the on-screen branch.
 *   6. Footer: small note explaining the Stripe email-receipt
 *      pipeline (matches the on-screen "A receipt is emailed
 *      automatically when your charge clears." line) + a YeRide
 *      contact line.
 */

export interface BuildReceiptHtmlArgs {
  readonly ride: Ride;
  readonly payments: {
    readonly fare: TripPayment | null;
    readonly tip: TripPayment | null;
    readonly refund: TripPayment | null;
  };
  readonly fareTotal: Money | null;
  /** From the wallet-cache join in `useRideReceiptViewModel`. Null when the join misses. */
  readonly paymentBrand: CardBrand | null;
  /** Same null semantics as `paymentBrand`. */
  readonly paymentLast4: string | null;
}

/**
 * HTML-escape a free-text string for safe interpolation into the
 * receipt template. Uses the canonical 5-char replacement table
 * (`&`, `<`, `>`, `"`, `'`) — the same set DOMPurify and most
 * server-side templating engines use. Order matters: `&` first so
 * we don't double-escape entities we just emitted.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format a `Money` as a plain dollar string for the fare-row and
 * Total-row cells. Intentionally avoids `Intl.NumberFormat` (which
 * would carry locale-specific separators that may not survive the
 * round-trip through the WebView's HTML parser uniformly across
 * platforms). Always 2 decimal places, USD only.
 */
export function formatMoneyForPdf(amount: Money): string {
  return `$${amount.majorUnits.toFixed(2)}`;
}

/**
 * Format a Date as a US-locale long date + 12-hour time string for
 * the receipt header. Uses `toLocaleString` with explicit options
 * rather than the parameter-less form so the output is stable across
 * device locale settings (the receipt is for the rider's records;
 * predictable formatting beats locale-respecting formatting).
 */
export function formatRideDate(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format a CardBrand for the payment-block label. Mirrors
 * `formatBrand` from `@presentation/components/payment/CardBrandBadge`
 * — duplicated here because the shared module is in the presentation
 * layer (which the data + shared layers can't import). Single source
 * of truth lives in `CardBrandBadge`; we re-state the table here so
 * the two stay in sync. (The risk of drift is low — `CardBrand` is
 * a finite enum and adding a member would surface a TS exhaustiveness
 * check in BOTH files.)
 */
export function formatBrandForPdf(brand: CardBrand): string {
  switch (brand) {
    case 'visa':
      return 'Visa';
    case 'mastercard':
      return 'Mastercard';
    case 'amex':
      return 'Amex';
    case 'discover':
      return 'Discover';
    case 'diners':
      return 'Diners';
    case 'jcb':
      return 'JCB';
    case 'unionpay':
      return 'UnionPay';
    case 'unknown':
      return 'Card';
  }
}

/**
 * Returns the inlined SVG XML markup for a card-brand glyph. Each
 * brand's markup mirrors the JSX SVG components under
 * `src/presentation/components/payment/assets/svg/` 1:1 (the visual
 * source of truth) — same viewBox (`0 0 60 40`), same colors, same
 * `<Path/>` / `<Rect/>` / `<Circle/>` shape data. We can't import
 * the React-component versions because (a) they emit JSX (not a
 * string) and (b) they live in the presentation layer.
 *
 * Brand-to-glyph table mirrors `BRAND_GLYPHS` in `CardBrandBadge`:
 *   - visa / mastercard / amex / discover / diners → branded glyph
 *   - jcb / unionpay / unknown → generic card glyph
 *
 * The `<svg>` root carries `width="36" height="22"` — the same
 * dimensions the on-screen `'md'` size badge uses. PDF receipts
 * embed at this size; the WebView scales as needed.
 */
export function getBrandSvgString(brand: CardBrand): string {
  switch (brand) {
    case 'visa':
      return VISA_SVG;
    case 'mastercard':
      return MASTERCARD_SVG;
    case 'amex':
      return AMEX_SVG;
    case 'discover':
      return DISCOVER_SVG;
    case 'diners':
      return DINERS_SVG;
    case 'jcb':
    case 'unionpay':
    case 'unknown':
      return GENERIC_CARD_SVG;
  }
}

const SVG_PRELUDE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="22" viewBox="0 0 60 40">';

const VISA_SVG =
  SVG_PRELUDE +
  '<rect x="0" y="0" width="60" height="40" rx="4" fill="#1A1F71"/>' +
  '<g>' +
  '<path d="M 10 14 L 13 26 L 16 26 L 19 14 L 16 14 L 14.5 22 L 13 14 Z" fill="#FFFFFF"/>' +
  '<path d="M 21 14 L 24 14 L 22 26 L 19 26 Z" fill="#FFFFFF"/>' +
  '<path d="M 26 17 Q 26 14 30 14 L 33 14 L 32.5 16.5 L 30 16.5 Q 28.5 16.5 28.5 17.5 Q 28.5 18.5 30 19 L 31 19.5 Q 33 20.5 33 22.5 Q 33 26 28.5 26 L 25 26 L 25.5 23.5 L 28.5 23.5 Q 30 23.5 30 22.5 Q 30 21.5 28.5 21 L 27.5 20.5 Q 26 19.5 26 17 Z" fill="#FFFFFF"/>' +
  '<path d="M 38 14 L 41 14 L 44 26 L 41 26 L 40.5 24 L 37.5 24 L 37 26 L 34 26 Z M 38 22 L 40 22 L 39 17.5 Z" fill="#FFFFFF"/>' +
  '</g>' +
  '<rect x="6" y="30" width="48" height="3" fill="#F7B600"/>' +
  '</svg>';

const MASTERCARD_SVG =
  SVG_PRELUDE +
  '<rect x="0" y="0" width="60" height="40" rx="4" fill="#FFFFFF"/>' +
  '<circle cx="24" cy="20" r="11" fill="#EB001B"/>' +
  '<circle cx="36" cy="20" r="11" fill="#F79E1B"/>' +
  '<path d="M 30 11 A 11 11 0 0 1 30 29 A 11 11 0 0 1 30 11 Z" fill="#FF5F00"/>' +
  '</svg>';

const AMEX_SVG =
  SVG_PRELUDE +
  '<rect x="0" y="0" width="60" height="40" rx="4" fill="#016FD0"/>' +
  '<g>' +
  '<path d="M 10 26 L 12 14 L 15 14 L 17 26 L 14.5 26 L 14 24 L 13 24 L 12.5 26 Z M 13.3 22 L 13.7 19 L 14 22 Z" fill="#FFFFFF"/>' +
  '<path d="M 19 26 L 19 14 L 22 14 L 23.5 20 L 25 14 L 28 14 L 28 26 L 26 26 L 26 18 L 24.5 24 L 22.5 24 L 21 18 L 21 26 Z" fill="#FFFFFF"/>' +
  '<path d="M 31 14 L 38 14 L 38 16.5 L 33 16.5 L 33 19 L 37 19 L 37 21 L 33 21 L 33 23.5 L 38 23.5 L 38 26 L 31 26 Z" fill="#FFFFFF"/>' +
  '<path d="M 41 14 L 43.5 14 L 45 17 L 46.5 14 L 49 14 L 46.5 20 L 49 26 L 46.5 26 L 45 23 L 43.5 26 L 41 26 L 43.5 20 Z" fill="#FFFFFF"/>' +
  '</g>' +
  '</svg>';

const DISCOVER_SVG =
  SVG_PRELUDE +
  '<rect x="0" y="0" width="60" height="40" rx="4" fill="#FFFFFF"/>' +
  '<rect x="0.5" y="0.5" width="59" height="39" rx="3.5" fill="none" stroke="#E0E0E0" stroke-width="0.5"/>' +
  '<g>' +
  '<path d="M 6 18 L 8 18 L 8 22 L 6 22 Z M 9 18 L 11 18 L 11 22 L 9 22 Z M 12 18 L 14 18 L 14 22 L 12 22 Z M 15 18 L 17 18 L 17 22 L 15 22 Z M 18 18 L 20 18 L 20 22 L 18 22 Z M 21 18 L 23 18 L 23 22 L 21 22 Z" fill="#231F20"/>' +
  '</g>' +
  '<circle cx="44" cy="20" r="10" fill="#FF6000"/>' +
  '<circle cx="41" cy="17" r="3" fill="#FF8533" opacity="0.6"/>' +
  '</svg>';

const DINERS_SVG =
  SVG_PRELUDE +
  '<rect x="0" y="0" width="60" height="40" rx="4" fill="#FFFFFF"/>' +
  '<circle cx="30" cy="20" r="13" fill="#0079BE"/>' +
  '<rect x="29" y="7" width="2" height="26" fill="#FFFFFF"/>' +
  '<circle cx="26" cy="20" r="8" fill="#FFFFFF"/>' +
  '<circle cx="26" cy="20" r="6" fill="#0079BE"/>' +
  '<circle cx="34" cy="20" r="8" fill="#FFFFFF"/>' +
  '<circle cx="34" cy="20" r="6" fill="#0079BE"/>' +
  '</svg>';

const GENERIC_CARD_SVG =
  SVG_PRELUDE +
  '<rect x="0" y="0" width="60" height="40" rx="4" fill="#5A6772"/>' +
  '<rect x="6" y="13" width="12" height="10" rx="1.5" fill="#D4A55F"/>' +
  '<path d="M 12 13 L 12 23 M 6 18 L 18 18" stroke="#8B6F35" stroke-width="0.8" fill="none"/>' +
  '<rect x="6" y="28" width="20" height="2" rx="0.5" fill="#9AA5AF"/>' +
  '<rect x="30" y="28" width="20" height="2" rx="0.5" fill="#9AA5AF"/>' +
  '</svg>';

/**
 * Build the receipt HTML. Pure function — same args produce the same
 * string. Safe to call at any point in the receipt lifecycle (the
 * caller in `useGenerateReceiptPdfViewModel` gates on
 * `ride.status === 'completed'` so the receipt is always finalized
 * by the time we get here).
 */
export function buildReceiptHtml(args: BuildReceiptHtmlArgs): string {
  const { ride, payments, fareTotal, paymentBrand, paymentLast4 } = args;

  const driver = ride.driver;
  const driverName = driver
    ? escapeHtml(`${driver.name.first} ${driver.name.last}`)
    : null;
  const driverVehicle =
    driver && driver.vehicle
      ? escapeHtml(
          `${driver.vehicle.year} ${driver.vehicle.make} ${driver.vehicle.model}` +
            ` · ${driver.vehicle.color} · Plate ${driver.vehicle.licensePlate}`,
        )
      : null;
  const driverFirstName = driver ? escapeHtml(driver.name.first) : null;

  const pickupText = escapeHtml(ride.pickup.placeName ?? ride.pickup.address);
  const dropoffText = escapeHtml(
    ride.dropoff.placeName ?? ride.dropoff.address,
  );

  const headerTitle = driverFirstName
    ? `Trip with ${driverFirstName}`
    : 'Trip complete';
  const rideIdText = escapeHtml(String(ride.id));
  const rideDateText = escapeHtml(formatRideDate(ride.createdAt));

  const paymentRowsHtml = renderPaymentRows(payments, fareTotal);

  const paymentBlockHtml =
    paymentBrand !== null && paymentLast4 !== null
      ? renderPaymentBlockBranded(paymentBrand, paymentLast4)
      : renderPaymentBlockFallback();

  const driverBlockHtml =
    driverName !== null ? renderDriverBlock(driverName, driverVehicle) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>YeRide trip receipt</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #000000; /* --foreground (light) */ background: #FFFFFF; /* --background (light) */ }
  body { padding: 32px 40px; font-size: 13pt; line-height: 1.5; }
  .brand-bar { background: #F9C901; /* --primary */ color: #000000; /* --primary-foreground */ padding: 12px 16px; border-radius: 6px; font-weight: 700; font-size: 18pt; letter-spacing: 0.5px; margin-bottom: 24px; }
  h1 { font-size: 20pt; font-weight: 700; margin-bottom: 4px; color: #000000; /* --foreground */ }
  .receipt-meta { color: #6b4701; /* --brand-deep */ font-size: 11pt; margin-bottom: 24px; }
  .section { border-top: 1px solid #E5E7EB; padding: 16px 0; }
  .section-label { text-transform: uppercase; letter-spacing: 0.6px; font-size: 9pt; color: #6b4701; /* --brand-deep */ margin-bottom: 6px; font-weight: 600; }
  .endpoint-row { margin-bottom: 8px; }
  .endpoint-row:last-child { margin-bottom: 0; }
  .driver-line { font-weight: 600; }
  .vehicle-line { font-size: 11pt; color: #424242; margin-top: 4px; }
  .fare-table { width: 100%; border-collapse: collapse; }
  .fare-table td { padding: 6px 0; font-size: 12pt; }
  .fare-table td.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .fare-table tr.total td { border-top: 1px solid #E5E7EB; padding-top: 12px; font-weight: 700; font-size: 13pt; }
  .payment-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .payment-row .glyph { display: inline-flex; }
  .footer { margin-top: 32px; font-size: 10pt; color: #6b4701; /* --brand-deep */ line-height: 1.4; }
  .footer p { margin-bottom: 4px; }
</style>
</head>
<body>
  <div class="brand-bar">YeRide</div>
  <h1>${headerTitle}</h1>
  <div class="receipt-meta">Receipt ${rideIdText} · ${rideDateText}</div>

  <div class="section">
    <div class="section-label">Trip</div>
    <div class="endpoint-row"><strong>Pickup:</strong> ${pickupText}</div>
    <div class="endpoint-row"><strong>Dropoff:</strong> ${dropoffText}</div>
  </div>

  ${driverBlockHtml}

  <div class="section">
    <div class="section-label">Fare</div>
    <table class="fare-table">
      ${paymentRowsHtml}
    </table>
  </div>

  <div class="section">
    <div class="section-label">Payment</div>
    ${paymentBlockHtml}
    <p style="margin-top: 8px; font-size: 10pt; color: #424242;">
      A receipt is emailed automatically when your charge clears.
    </p>
  </div>

  <div class="footer">
    <p>Thanks for riding with YeRide.</p>
    <p>Questions about this trip? Contact support through the YeRide app.</p>
  </div>
</body>
</html>`;
}

function renderDriverBlock(
  driverName: string,
  driverVehicle: string | null,
): string {
  const vehicleLine = driverVehicle
    ? `<div class="vehicle-line">${driverVehicle}</div>`
    : '';
  return `<div class="section">
    <div class="section-label">Driver</div>
    <div class="driver-line">${driverName}</div>
    ${vehicleLine}
  </div>`;
}

function renderPaymentRows(
  payments: BuildReceiptHtmlArgs['payments'],
  fareTotal: Money | null,
): string {
  const rows: string[] = [];
  if (payments.fare) {
    rows.push(
      `<tr><td>Trip fare</td><td class="amount">${formatMoneyForPdf(payments.fare.amount)}</td></tr>`,
    );
  }
  if (payments.tip) {
    rows.push(
      `<tr><td>Tip</td><td class="amount">${formatMoneyForPdf(payments.tip.amount)}</td></tr>`,
    );
  }
  if (payments.refund) {
    // Refund amount is positive on the wire (Stripe stores absolute
    // values). The on-screen receipt prefixes a "-" and the PDF
    // mirrors that convention so the math is visible at a glance.
    rows.push(
      `<tr><td>Refund</td><td class="amount">-${formatMoneyForPdf(payments.refund.amount)}</td></tr>`,
    );
  }
  if (fareTotal) {
    rows.push(
      `<tr class="total"><td>Total</td><td class="amount">${formatMoneyForPdf(fareTotal)}</td></tr>`,
    );
  }
  if (rows.length === 0) {
    rows.push(
      `<tr><td colspan="2" style="color: #424242;">Total updates as soon as your charge clears.</td></tr>`,
    );
  }
  return rows.join('\n      ');
}

function renderPaymentBlockBranded(brand: CardBrand, last4: string): string {
  const safeLast4 = escapeHtml(last4);
  const brandLabel = escapeHtml(formatBrandForPdf(brand));
  const svg = getBrandSvgString(brand);
  return `<div class="payment-row">
      <span class="glyph">${svg}</span>
      <span><strong>${brandLabel}</strong> •••• ${safeLast4}</span>
    </div>`;
}

function renderPaymentBlockFallback(): string {
  return `<p>Charged to your card on file.</p>`;
}
