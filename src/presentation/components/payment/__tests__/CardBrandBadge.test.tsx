import { render } from '@testing-library/react-native';
import { Path, Rect, Svg } from 'react-native-svg';

import {
  CardBrandBadge,
  formatBrand,
} from '@presentation/components/payment/CardBrandBadge';

describe('CardBrandBadge', () => {
  // Each branded glyph (visa / mastercard / amex / discover / diners)
  // renders its own asset. JCB / UnionPay / unknown all fall through to
  // the generic `card.png`. We assert via the per-brand testID rather
  // than the asset import so the test is robust against asset id
  // renumbering between Metro builds.
  it.each([
    'visa',
    'mastercard',
    'amex',
    'discover',
    'diners',
    'jcb',
    'unionpay',
    'unknown',
  ] as const)('renders a glyph for brand=%s', (brand) => {
    const { getByTestId } = render(<CardBrandBadge brand={brand} />);
    expect(getByTestId(`card-brand-badge-${brand}`)).toBeTruthy();
  });

  it('defaults to size sm when no size prop is provided', () => {
    const { getByTestId } = render(<CardBrandBadge brand="visa" />);
    const node = getByTestId('card-brand-badge-visa');
    // The outer View carries the explicit dimensions; sm = 28x18.
    expect(node.props.style).toEqual({ width: 28, height: 18 });
  });

  it.each([
    ['sm', 28, 18],
    ['md', 36, 22],
    ['lg', 48, 30],
  ] as const)(
    'sizes the outer container for size=%s',
    (size, width, height) => {
      const { getByTestId } = render(
        <CardBrandBadge brand="visa" size={size} />,
      );
      const node = getByTestId('card-brand-badge-visa');
      expect(node.props.style).toEqual({ width, height });
    },
  );

  // Phase 9 turn 13: SVG-rendering smoke tests prove the rendering-
  // pipeline flip from PNG `<Image>` to per-brand SVG components.
  // The global `jest.mock('react-native-svg', ...)` factory in
  // `jest.setup.ts` exposes Svg / Path / Rect / etc. as `jest.fn()`
  // identity components; we assert reference identity via the
  // imported mocks rather than scanning the rendered tree.
  describe('SVG rendering pipeline (Phase 9 turn 13)', () => {
    beforeEach(() => {
      (Svg as unknown as jest.Mock).mockClear();
      (Path as unknown as jest.Mock).mockClear();
      (Rect as unknown as jest.Mock).mockClear();
    });

    it('mounts the per-brand SVG glyph for branded brands', () => {
      render(<CardBrandBadge brand="visa" />);
      // Each per-brand glyph wraps its content in <Svg>; at least one
      // Svg invocation proves the SVG path fired (and the legacy PNG
      // `<Image>` path is gone).
      expect(Svg).toHaveBeenCalled();
      // The Visa glyph specifically uses Path elements (V/I/S/A
      // letterform approximations + the yellow accent rect). Both
      // should fire on render.
      expect(Path).toHaveBeenCalled();
      expect(Rect).toHaveBeenCalled();
    });

    it('mounts the GenericCard SVG glyph for the unknown brand fallback', () => {
      render(<CardBrandBadge brand="unknown" />);
      expect(Svg).toHaveBeenCalled();
      // GenericCard uses Rect (card body + chip + number lines) and
      // Path (chip grid). Asserting both fire pins the fallback glyph
      // is rendered via the SVG pipeline (not a PNG remnant).
      expect(Rect).toHaveBeenCalled();
      expect(Path).toHaveBeenCalled();
    });
  });
});

describe('formatBrand', () => {
  it.each([
    ['visa', 'Visa'],
    ['mastercard', 'Mastercard'],
    ['amex', 'Amex'],
    ['discover', 'Discover'],
    ['diners', 'Diners'],
    ['jcb', 'JCB'],
    ['unionpay', 'UnionPay'],
    ['unknown', 'Card'],
  ] as const)('formats brand=%s as "%s"', (brand, expected) => {
    expect(formatBrand(brand)).toBe(expected);
  });
});
