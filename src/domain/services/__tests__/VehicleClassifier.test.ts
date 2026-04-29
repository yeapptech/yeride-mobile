import { VehicleClassifier } from '../VehicleClassifier';

/**
 * Branch-coverage suite for the manual-entry classifier. Mirrors the
 * legacy `determineVehicleClassManual` / `checkManualEligibility` /
 * `getEligibleServices` so a vehicle a driver enters here gets the same
 * treatment a VIN decode would have produced for equivalent inputs.
 *
 * Eligibility tests pin `now` to a fixed date so the age-cutoff rule is
 * deterministic regardless of clock drift.
 */

const NOW_2026 = new Date('2026-04-28T12:00:00Z');

describe('VehicleClassifier.classifyManual', () => {
  describe('luxury brands', () => {
    it.each([
      ['Mercedes-Benz', 'sedan'],
      ['BMW', 'sedan'],
      ['Audi', 'wagon'],
      ['Lexus', 'SUV'],
      ['Cadillac', 'sedan'],
      ['Porsche', 'coupe'],
      ['Tesla', 'sedan'],
    ])('%s %s → luxury (brand beats body class)', (make, bodyClass) => {
      expect(
        VehicleClassifier.classifyManual({
          make,
          bodyClass,
          vehicleSize: null,
          seats: 5,
        }),
      ).toBe('luxury');
    });

    it('matches make case-insensitively (legacy parity)', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'mercedes-benz',
          bodyClass: 'sedan',
          vehicleSize: 'compact',
          seats: 5,
        }),
      ).toBe('luxury');
    });
  });

  describe('XL', () => {
    it('SUV → xl', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Toyota',
          bodyClass: 'SUV',
          vehicleSize: null,
          seats: 5,
        }),
      ).toBe('xl');
    });

    it('minivan → xl', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Honda',
          bodyClass: 'minivan',
          vehicleSize: null,
          seats: 7,
        }),
      ).toBe('xl');
    });

    it('plain "van" → xl', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Ford',
          bodyClass: 'van',
          vehicleSize: null,
          seats: 8,
        }),
      ).toBe('xl');
    });

    it('7+ seats forces xl even for non-SUV body classes', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Toyota',
          bodyClass: 'sedan',
          vehicleSize: 'mid-size',
          seats: 7,
        }),
      ).toBe('xl');
    });
  });

  describe('crossovers and wagons', () => {
    it('crossover → comfort', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Subaru',
          bodyClass: 'crossover',
          vehicleSize: null,
          seats: 5,
        }),
      ).toBe('comfort');
    });

    it('wagon → comfort', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Volvo',
          bodyClass: 'wagon',
          vehicleSize: null,
          seats: 5,
        }),
      ).toBe('comfort');
    });
  });

  describe('sedans (vehicleSize disambiguates)', () => {
    it('mid-size sedan → comfort', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Toyota',
          bodyClass: 'sedan',
          vehicleSize: 'mid-size',
          seats: 5,
        }),
      ).toBe('comfort');
    });

    it('compact sedan → economy', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Honda',
          bodyClass: 'sedan',
          vehicleSize: 'compact',
          seats: 5,
        }),
      ).toBe('economy');
    });

    it('sedan with no vehicleSize defaults to economy', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Nissan',
          bodyClass: 'sedan',
          vehicleSize: null,
          seats: 5,
        }),
      ).toBe('economy');
    });
  });

  describe('coupes, hatchbacks, defaults', () => {
    it('coupe → economy', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Toyota',
          bodyClass: 'coupe',
          vehicleSize: null,
          seats: 4,
        }),
      ).toBe('economy');
    });

    it('hatchback → economy', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Volkswagen',
          bodyClass: 'hatchback',
          vehicleSize: null,
          seats: 5,
        }),
      ).toBe('economy');
    });

    it('unknown body class falls through to economy', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Toyota',
          bodyClass: 'unknown-body-style',
          vehicleSize: null,
          seats: 5,
        }),
      ).toBe('economy');
    });

    it('null seats treated as 0 (no XL force)', () => {
      expect(
        VehicleClassifier.classifyManual({
          make: 'Toyota',
          bodyClass: 'sedan',
          vehicleSize: 'compact',
          seats: null,
        }),
      ).toBe('economy');
    });
  });
});

describe('VehicleClassifier.checkManualEligibility', () => {
  it('passes when year, doors, seats, body class are all in range', () => {
    expect(
      VehicleClassifier.checkManualEligibility({
        year: 2020,
        bodyClass: 'sedan',
        doors: 4,
        seats: 5,
        now: NOW_2026,
      }),
    ).toBe(true);
  });

  it('rejects vehicles older than 15 years', () => {
    expect(
      VehicleClassifier.checkManualEligibility({
        year: 2010,
        bodyClass: 'sedan',
        doors: 4,
        seats: 5,
        now: NOW_2026,
      }),
    ).toBe(false);
  });

  it('rejects when year is missing', () => {
    expect(
      VehicleClassifier.checkManualEligibility({
        year: null,
        bodyClass: 'sedan',
        doors: 4,
        seats: 5,
        now: NOW_2026,
      }),
    ).toBe(false);
  });

  it.each(['motorcycle', 'trailer', 'motorhome', 'bus', 'truck'])(
    'rejects body class containing %s',
    (token) => {
      expect(
        VehicleClassifier.checkManualEligibility({
          year: 2024,
          bodyClass: token,
          doors: 4,
          seats: 4,
          now: NOW_2026,
        }),
      ).toBe(false);
    },
  );

  it('rejects 2-door non-coupes', () => {
    expect(
      VehicleClassifier.checkManualEligibility({
        year: 2024,
        bodyClass: 'sedan',
        doors: 2,
        seats: 4,
        now: NOW_2026,
      }),
    ).toBe(false);
  });

  it('accepts 2-door coupes (legacy carve-out)', () => {
    expect(
      VehicleClassifier.checkManualEligibility({
        year: 2024,
        bodyClass: 'coupe',
        doors: 2,
        seats: 4,
        now: NOW_2026,
      }),
    ).toBe(true);
  });

  it('rejects fewer than 4 seats', () => {
    expect(
      VehicleClassifier.checkManualEligibility({
        year: 2024,
        bodyClass: 'sedan',
        doors: 4,
        seats: 2,
        now: NOW_2026,
      }),
    ).toBe(false);
  });

  it('null doors does NOT disqualify on its own (legacy parity)', () => {
    expect(
      VehicleClassifier.checkManualEligibility({
        year: 2024,
        bodyClass: 'sedan',
        doors: null,
        seats: 5,
        now: NOW_2026,
      }),
    ).toBe(true);
  });

  it('null seats does NOT disqualify on its own (legacy parity)', () => {
    expect(
      VehicleClassifier.checkManualEligibility({
        year: 2024,
        bodyClass: 'sedan',
        doors: 4,
        seats: null,
        now: NOW_2026,
      }),
    ).toBe(true);
  });

  it('uses the supplied `now` for the age check', () => {
    // Same vehicle that passes against 2026 fails against 2040.
    const args = {
      year: 2020,
      bodyClass: 'sedan',
      doors: 4,
      seats: 5,
    } as const;
    expect(
      VehicleClassifier.checkManualEligibility({
        ...args,
        now: new Date('2026-04-28T12:00:00Z'),
      }),
    ).toBe(true);
    expect(
      VehicleClassifier.checkManualEligibility({
        ...args,
        now: new Date('2040-01-01T00:00:00Z'),
      }),
    ).toBe(false);
  });
});

describe('VehicleClassifier.computeEligibleServices', () => {
  it('returns empty list when not eligible', () => {
    expect(VehicleClassifier.computeEligibleServices('comfort', false)).toEqual(
      [],
    );
  });

  it('economy → [economy, deliver]', () => {
    expect(
      VehicleClassifier.computeEligibleServices('economy', true).map(String),
    ).toEqual(['economy', 'deliver']);
  });

  it('comfort → [economy, comfort, deliver]', () => {
    expect(
      VehicleClassifier.computeEligibleServices('comfort', true).map(String),
    ).toEqual(['economy', 'comfort', 'deliver']);
  });

  it('xl → [economy, comfort, xl, deliver]', () => {
    expect(
      VehicleClassifier.computeEligibleServices('xl', true).map(String),
    ).toEqual(['economy', 'comfort', 'xl', 'deliver']);
  });

  it('luxury → [comfort, luxury, deliver]', () => {
    // Note: luxury intentionally excludes economy — legacy parity.
    expect(
      VehicleClassifier.computeEligibleServices('luxury', true).map(String),
    ).toEqual(['comfort', 'luxury', 'deliver']);
  });
});
