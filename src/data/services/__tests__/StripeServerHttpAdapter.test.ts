import { Email } from '@domain/entities/Email';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { UserId } from '@domain/entities/UserId';

import { StripeServerHttpAdapter } from '../StripeServerHttpAdapter';

const BASE_URL = 'https://stripe.test';
const API_KEY = 'test-api-key';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nonJsonResponse(): Response {
  return new Response('<html>oops</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

function makeAdapter(): StripeServerHttpAdapter {
  return new StripeServerHttpAdapter({ baseUrl: BASE_URL, apiKey: API_KEY });
}

const USER_ID = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
const EMAIL = unwrap(Email.create('rider@yeapp.tech'));
const CUS_ID = unwrap(StripeCustomerId.create('cus_test123'));
const ACCT_ID = unwrap(StripeAccountId.create('acct_test123'));
const PM_ID = unwrap(PaymentMethodId.create('pm_test123'));

describe('StripeServerHttpAdapter', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  describe('createCustomer', () => {
    it('POSTs to /customers-create with the Idempotency-Key header and Bearer token', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: true, data: { id: 'cus_minted42' } }),
      );
      const r = await makeAdapter().createCustomer({
        userId: USER_ID,
        name: 'Ada Lovelace',
        email: EMAIL,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(String(r.value)).toBe('cus_minted42');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/customers-create`);
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${API_KEY}`);
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Idempotency-Key']).toBe(
        `customer-create-${String(USER_ID)}`,
      );
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({
        userId: String(USER_ID),
        name: 'Ada Lovelace',
        email: EMAIL.value,
      });
    });

    it('returns NetworkError when the response shape is missing data.id', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
      const r = await makeAdapter().createCustomer({
        userId: USER_ID,
        name: 'Ada',
        email: EMAIL,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('network');
        expect(r.error.code).toBe('stripe_server_response_invalid_shape');
      }
    });
  });

  describe('createSetupIntent', () => {
    it('returns the clientSecret on success', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ clientSecret: 'seti_test_secret' }),
      );
      const r = await makeAdapter().createSetupIntent({ customerId: CUS_ID });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.clientSecret).toBe('seti_test_secret');
    });

    it('does NOT send an Idempotency-Key header', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ clientSecret: 'seti_x' }));
      await makeAdapter().createSetupIntent({ customerId: CUS_ID });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toBeUndefined();
    });
  });

  describe('listPaymentMethods', () => {
    it('maps server rows into PaymentMethod value objects', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            {
              id: 'pm_test1',
              type: 'card',
              brand: 'visa',
              last4: '4242',
              funding: 'credit',
            },
            {
              id: 'pm_test2',
              type: 'card',
              brand: 'Mastercard',
              last4: '5555',
              funding: 'debit',
            },
          ],
        }),
      );
      const r = await makeAdapter().listPaymentMethods({ customerId: CUS_ID });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toHaveLength(2);
        expect(r.value[0]?.brand).toBe('visa');
        expect(r.value[0]?.last4).toBe('4242');
        expect(r.value[0]?.expiry).toBeNull();
        expect(r.value[1]?.brand).toBe('mastercard'); // normalized
      }
    });

    it('reads exp_month/exp_year when the server provides them (forward-compat)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            {
              id: 'pm_test1',
              type: 'card',
              brand: 'visa',
              last4: '4242',
              exp_month: 12,
              exp_year: 2030,
            },
          ],
        }),
      );
      const r = await makeAdapter().listPaymentMethods({ customerId: CUS_ID });
      if (r.ok) expect(r.value[0]?.expiry).toEqual({ month: 12, year: 2030 });
    });

    it('skips malformed rows rather than failing the whole list', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            { id: 'pm_good', brand: 'visa', last4: '4242' },
            { id: 'not_a_pm_id', brand: 'visa', last4: '0000' },
            { brand: 'visa', last4: '0000' }, // missing id
          ],
        }),
      );
      const r = await makeAdapter().listPaymentMethods({ customerId: CUS_ID });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toHaveLength(1);
    });
  });

  describe('detachPaymentMethod', () => {
    it('returns void on success', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));
      const r = await makeAdapter().detachPaymentMethod({
        paymentMethodId: PM_ID,
      });
      expect(r.ok).toBe(true);
    });
  });

  describe('createConnectAccount', () => {
    it('passes country when supplied', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: true, data: { id: 'acct_minted42' } }),
      );
      const r = await makeAdapter().createConnectAccount({
        userId: USER_ID,
        email: EMAIL,
        country: 'CA',
      });
      expect(r.ok).toBe(true);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body['country']).toBe('CA');
    });

    it('omits country when not supplied (server defaults to US)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: true, data: { id: 'acct_minted42' } }),
      );
      await makeAdapter().createConnectAccount({
        userId: USER_ID,
        email: EMAIL,
      });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body['country']).toBeUndefined();
    });
  });

  describe('createAccountLink', () => {
    it('returns the URL and a Date built from expires_at (UNIX seconds)', async () => {
      const expiresAt = Math.floor(
        new Date('2030-01-01T00:00:00Z').getTime() / 1000,
      );
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            url: 'https://stripe.example/onboard/abc',
            expires_at: expiresAt,
          },
        }),
      );
      const r = await makeAdapter().createAccountLink({
        accountId: ACCT_ID,
        refreshUrl: 'yeridenext-dev://stripe-refresh',
        returnUrl: 'yeridenext-dev://stripe-return',
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.url).toBe('https://stripe.example/onboard/abc');
        expect(r.value.expiresAt.toISOString()).toBe(
          '2030-01-01T00:00:00.000Z',
        );
      }
    });
  });

  describe('createAccountLoginLink', () => {
    it('returns the dashboard URL', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: 'https://stripe.example/login/xyz' },
        }),
      );
      const r = await makeAdapter().createAccountLoginLink({
        accountId: ACCT_ID,
      });
      if (r.ok) expect(r.value.url).toBe('https://stripe.example/login/xyz');
    });
  });

  describe('retrieveAccount', () => {
    it('coerces missing flags to false', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: true, data: { id: 'acct_x' } }),
      );
      const r = await makeAdapter().retrieveAccount({ accountId: ACCT_ID });
      if (r.ok) {
        expect(r.value.chargesEnabled).toBe(false);
        expect(r.value.payoutsEnabled).toBe(false);
      }
    });

    it('returns the flags as-is when present', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            id: 'acct_x',
            charges_enabled: true,
            payouts_enabled: true,
          },
        }),
      );
      const r = await makeAdapter().retrieveAccount({ accountId: ACCT_ID });
      if (r.ok) {
        expect(r.value.chargesEnabled).toBe(true);
        expect(r.value.payoutsEnabled).toBe(true);
      }
    });
  });

  describe('getAccountBalance', () => {
    it('sums USD rows and ignores non-USD rows', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          available: [
            { amount: 1234, currency: 'usd' },
            { amount: 999, currency: 'eur' },
          ],
          pending: [{ amount: 500, currency: 'usd' }],
        }),
      );
      const r = await makeAdapter().getAccountBalance({ accountId: ACCT_ID });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.available.minorUnits).toBe(1234);
        expect(r.value.pending.minorUnits).toBe(500);
      }
    });

    it('returns zero when both arrays are empty', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: true, available: [], pending: [] }),
      );
      const r = await makeAdapter().getAccountBalance({ accountId: ACCT_ID });
      if (r.ok) {
        expect(r.value.available.minorUnits).toBe(0);
        expect(r.value.pending.minorUnits).toBe(0);
      }
    });
  });

  describe('listAccountPayouts', () => {
    it('maps payout rows', async () => {
      const arrival = Math.floor(
        new Date('2026-04-01T00:00:00Z').getTime() / 1000,
      );
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            {
              id: 'po_1',
              amount: 1000,
              currency: 'usd',
              status: 'paid',
              arrival_date: arrival,
            },
            {
              id: 'po_2',
              amount: 2000,
              currency: 'usd',
              status: 'pending',
              arrival_date: arrival,
            },
          ],
        }),
      );
      const r = await makeAdapter().listAccountPayouts({
        accountId: ACCT_ID,
        days: 7,
        limit: 10,
      });
      if (r.ok) {
        expect(r.value).toHaveLength(2);
        expect(r.value[0]?.status).toBe('paid');
      }
    });
  });

  describe('listBalanceTransactions', () => {
    it('maps balance-transaction rows including tripId', async () => {
      const created = Math.floor(
        new Date('2026-04-01T00:00:00Z').getTime() / 1000,
      );
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            {
              id: 'txn_1',
              amount: 1000,
              fee: 30,
              net: 970,
              currency: 'usd',
              type: 'charge',
              created,
              tripId: 'trip_abc',
            },
          ],
        }),
      );
      const r = await makeAdapter().listBalanceTransactions({
        accountId: ACCT_ID,
        days: 7,
        limit: 25,
      });
      if (r.ok) {
        expect(r.value).toHaveLength(1);
        expect(r.value[0]?.id).toBe('txn_1');
        expect(r.value[0]?.tripId).toBe('trip_abc');
      }
    });

    it('skips rows where net != amount - fee (invariant violation)', async () => {
      const created = Math.floor(Date.now() / 1000);
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            {
              id: 'txn_bad',
              amount: 1000,
              fee: 30,
              net: 9999, // broken
              currency: 'usd',
              type: 'charge',
              created,
            },
          ],
        }),
      );
      const r = await makeAdapter().listBalanceTransactions({
        accountId: ACCT_ID,
        days: 7,
        limit: 25,
      });
      if (r.ok) expect(r.value).toHaveLength(0);
    });
  });

  describe('error mapping', () => {
    it('maps HTTP 401 to AuthorizationError', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { success: false, errorCode: 'unauthorized', message: 'bad key' },
          { status: 401 },
        ),
      );
      const r = await makeAdapter().createSetupIntent({ customerId: CUS_ID });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('authorization');
        expect(r.error.code).toBe('unauthorized');
      }
    });

    it('maps HTTP 403 to AuthorizationError', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { status: 403 }));
      const r = await makeAdapter().createSetupIntent({ customerId: CUS_ID });
      if (!r.ok) expect(r.error.kind).toBe('authorization');
    });

    it('maps HTTP 4xx (other) to ValidationError carrying the server errorCode', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { success: false, errorCode: 'card_declined', message: 'nope' },
          { status: 400 },
        ),
      );
      const r = await makeAdapter().detachPaymentMethod({
        paymentMethodId: PM_ID,
      });
      if (!r.ok) {
        expect(r.error.kind).toBe('validation');
        expect(r.error.code).toBe('card_declined');
        expect(r.error.message).toBe('nope');
      }
    });

    it('does not retry 4xx errors', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: false, errorCode: 'bad' }, { status: 422 }),
      );
      await makeAdapter().detachPaymentMethod({ paymentMethodId: PM_ID });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries on 5xx and resolves when a later attempt succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, { status: 500 }))
        .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ clientSecret: 'seti_x' }));
      const adapter = new StripeServerHttpAdapter({
        baseUrl: BASE_URL,
        apiKey: API_KEY,
      });
      const r = await adapter.createSetupIntent({ customerId: CUS_ID });
      // Use a low-overhead adapter; in test we don't override sleep but the
      // retry policy's delays sum to <2s, well within Jest's default timeout.
      expect(r.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }, 10_000);

    it('gives up after the retry budget on persistent 5xx', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { status: 500 }));
      const r = await makeAdapter().createSetupIntent({ customerId: CUS_ID });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('network');
        expect(r.error.code).toBe('stripe_server_server_error');
      }
      expect(fetchMock).toHaveBeenCalledTimes(4); // 1 + 3 retries
    }, 10_000);

    it('maps a transport throw to NetworkError and retries', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue(jsonResponse({ clientSecret: 'seti_x' }));
      const r = await makeAdapter().createSetupIntent({ customerId: CUS_ID });
      expect(r.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('maps a non-JSON 2xx body to NetworkError(invalid_json)', async () => {
      fetchMock.mockResolvedValue(nonJsonResponse());
      const r = await makeAdapter().createSetupIntent({ customerId: CUS_ID });
      if (!r.ok) {
        expect(r.error.kind).toBe('network');
        expect(r.error.code).toBe('stripe_server_response_invalid_json');
      }
    });

    it('maps 2xx with body.success === false to ValidationError', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: false, errorCode: 'odd', message: 'odd' }),
      );
      const r = await makeAdapter().detachPaymentMethod({
        paymentMethodId: PM_ID,
      });
      if (!r.ok) {
        expect(r.error.kind).toBe('validation');
        expect(r.error.code).toBe('odd');
      }
    });
  });

  describe('base URL composition', () => {
    it('strips a trailing slash from baseUrl so paths compose cleanly', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ clientSecret: 'seti_x' }));
      const adapter = new StripeServerHttpAdapter({
        baseUrl: `${BASE_URL}/`,
        apiKey: API_KEY,
      });
      await adapter.createSetupIntent({ customerId: CUS_ID });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(`${BASE_URL}/create-setup-intent`);
    });
  });
});
