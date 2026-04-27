import { validateEnv } from '../validateEnv';

describe('validateEnv', () => {
  it('accepts a valid environment', () => {
    const env = validateEnv({
      EXPO_PUBLIC_APP_ENV: 'development',
    } as unknown as NodeJS.ProcessEnv);
    expect(env.EXPO_PUBLIC_APP_ENV).toBe('development');
  });

  it('defaults APP_ENV to development when missing', () => {
    const env = validateEnv({} as unknown as NodeJS.ProcessEnv);
    expect(env.EXPO_PUBLIC_APP_ENV).toBe('development');
  });

  it('rejects an unknown environment', () => {
    expect(() =>
      validateEnv({
        EXPO_PUBLIC_APP_ENV: 'qa',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment configuration/);
  });
});
