import { retryWithBackoff } from '../retryWithBackoff';

describe('retryWithBackoff', () => {
  it('returns immediately when fn succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);
    const result = await retryWithBackoff(fn, {
      attempts: 3,
      delaysMs: [10, 20],
      shouldRetry: () => true,
      sleep,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries when shouldRetry returns true and resolves on a later attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue('ok-third');
    const sleep = jest.fn().mockResolvedValue(undefined);
    const result = await retryWithBackoff(fn, {
      attempts: 3,
      delaysMs: [10, 20],
      shouldRetry: () => true,
      sleep,
    });
    expect(result).toBe('ok-third');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('gives up and throws the last error after exhausting attempts', async () => {
    const final = new Error('fail-final');
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockRejectedValue(final);
    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(
      retryWithBackoff(fn, {
        attempts: 3,
        delaysMs: [10, 20],
        shouldRetry: () => true,
        sleep,
      }),
    ).rejects.toBe(final);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry when shouldRetry returns false', async () => {
    const error = new Error('client-4xx');
    const fn = jest.fn().mockRejectedValue(error);
    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(
      retryWithBackoff(fn, {
        attempts: 3,
        delaysMs: [10, 20],
        shouldRetry: () => false,
        sleep,
      }),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes the rejection value into shouldRetry so callers can branch on it', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');
    const shouldRetry = jest.fn(
      (e: unknown) =>
        typeof e === 'object' &&
        e !== null &&
        'status' in e &&
        typeof (e as { status: unknown }).status === 'number' &&
        (e as { status: number }).status >= 500,
    );
    const sleep = jest.fn().mockResolvedValue(undefined);
    const result = await retryWithBackoff(fn, {
      attempts: 3,
      delaysMs: [10, 20],
      shouldRetry,
      sleep,
    });
    expect(result).toBe('ok');
    expect(shouldRetry).toHaveBeenCalledWith({ status: 503 });
  });

  it('throws synchronously on attempts < 1 (programmer error)', async () => {
    await expect(
      retryWithBackoff(() => Promise.resolve('x'), {
        attempts: 0,
        delaysMs: [],
        shouldRetry: () => true,
      }),
    ).rejects.toThrow(/attempts must be >= 1/);
  });

  it('repeats the last delay if delaysMs is shorter than attempts - 1', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);
    const result = await retryWithBackoff(fn, {
      attempts: 4,
      delaysMs: [50],
      shouldRetry: () => true,
      sleep,
    });
    expect(result).toBe('ok');
    // Three retries, all with the only configured delay (50).
    expect(sleep.mock.calls).toEqual([[50], [50], [50]]);
  });
});
