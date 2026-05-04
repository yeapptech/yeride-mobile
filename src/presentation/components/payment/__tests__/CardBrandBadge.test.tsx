import { render } from '@testing-library/react-native';

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
