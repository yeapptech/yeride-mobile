import { act, fireEvent, render } from '@testing-library/react-native';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import {
  useFirestoreSubscription,
  useUseCaseSubscription,
} from '../useFirestoreSubscription';

/**
 * Minimal "fake source" that mirrors the shape of any of our Observe* use
 * cases. Tests can `emit(value)` to push values to all live subscribers and
 * `listenerCount()` to assert teardown. Importantly, it does NOT
 * synchronously emit a cached value when subscribed — that's a property of
 * specific repositories. Some of our tests opt into a synchronous initial
 * emission via `withInitial`.
 */
function makeFakeSource<T>(): {
  subscribe: (cb: (value: T) => void) => () => void;
  emit: (value: T) => void;
  listenerCount: () => number;
  withInitial: (value: T) => (cb: (value: T) => void) => () => void;
} {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    emit(value) {
      for (const cb of listeners) cb(value);
    },
    listenerCount: () => listeners.size,
    withInitial(value) {
      return (cb) => {
        cb(value);
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      };
    },
  };
}

describe('useFirestoreSubscription', () => {
  it('returns the initialValue before the source emits', () => {
    const source = makeFakeSource<number>();
    const subscribe = source.subscribe;

    function Probe() {
      const value = useFirestoreSubscription<number>(subscribe, 42);
      return <Text testID="value">{value}</Text>;
    }

    const { getByTestId } = render(<Probe />);
    expect(getByTestId('value').props.children).toBe(42);
  });

  it('reflects synchronous initial emissions', () => {
    const source = makeFakeSource<string>();
    const subscribe = source.withInitial('seeded');

    function Probe() {
      const value = useFirestoreSubscription<string>(subscribe, 'fallback');
      return <Text testID="value">{value}</Text>;
    }

    const { getByTestId } = render(<Probe />);
    expect(getByTestId('value').props.children).toBe('seeded');
  });

  it('re-renders the consumer when the source emits a new value', () => {
    const source = makeFakeSource<number>();

    function Probe() {
      const value = useFirestoreSubscription<number>(source.subscribe, 0);
      return <Text testID="value">{value}</Text>;
    }

    const { getByTestId } = render(<Probe />);
    expect(getByTestId('value').props.children).toBe(0);

    act(() => {
      source.emit(7);
    });
    expect(getByTestId('value').props.children).toBe(7);

    act(() => {
      source.emit(11);
    });
    expect(getByTestId('value').props.children).toBe(11);
  });

  it('unsubscribes when the consumer unmounts', () => {
    const source = makeFakeSource<number>();

    function Probe() {
      const value = useFirestoreSubscription<number>(source.subscribe, 0);
      return <Text>{value}</Text>;
    }

    const { unmount } = render(<Probe />);
    expect(source.listenerCount()).toBe(1);

    unmount();
    expect(source.listenerCount()).toBe(0);
  });

  it('re-subscribes when the subscribe callback identity changes', () => {
    const sourceA = makeFakeSource<string>();
    const sourceB = makeFakeSource<string>();

    function Probe({ which }: { which: 'a' | 'b' }) {
      const subscribe = useCallback(
        (cb: (v: string) => void) => {
          return which === 'a' ? sourceA.subscribe(cb) : sourceB.subscribe(cb);
        },
        [which],
      );
      const value = useFirestoreSubscription<string>(subscribe, 'init');
      return <Text testID="value">{value}</Text>;
    }

    const { getByTestId, rerender } = render(<Probe which="a" />);
    expect(sourceA.listenerCount()).toBe(1);
    expect(sourceB.listenerCount()).toBe(0);

    act(() => {
      sourceA.emit('from A');
    });
    expect(getByTestId('value').props.children).toBe('from A');

    rerender(<Probe which="b" />);
    expect(sourceA.listenerCount()).toBe(0);
    expect(sourceB.listenerCount()).toBe(1);

    act(() => {
      sourceB.emit('from B');
    });
    expect(getByTestId('value').props.children).toBe('from B');
  });

  it('does NOT re-subscribe on unrelated re-renders when subscribe is stable', () => {
    const source = makeFakeSource<number>();
    const stableSubscribe = source.subscribe;
    let subscribeCallCount = 0;
    const trackedSubscribe = (cb: (v: number) => void) => {
      subscribeCallCount += 1;
      return stableSubscribe(cb);
    };

    function Probe() {
      const [, setTick] = useState(0);
      const value = useFirestoreSubscription<number>(trackedSubscribe, 0);
      return (
        <Text testID="value" onPress={() => setTick((t) => t + 1)}>
          {value}
        </Text>
      );
    }

    const { getByTestId } = render(<Probe />);
    expect(subscribeCallCount).toBe(1);

    // Force an unrelated re-render via setState.
    fireEvent.press(getByTestId('value'));
    fireEvent.press(getByTestId('value'));

    expect(subscribeCallCount).toBe(1); // still only the original subscribe
  });
});

describe('useUseCaseSubscription', () => {
  it('threads args through and unsubscribes on unmount', () => {
    const source = makeFakeSource<{ rideId: string; status: string }>();
    // Holder object instead of a `let` because TS's narrowing-via-init gets
    // confused when a `let` is reassigned only inside a closure that the
    // type checker can't prove has been called yet — it narrows the
    // outer scope to `null` and downstream `.rideId` reads fail on
    // `Property 'rideId' does not exist on type 'never'`.
    const lastArgs: {
      current: { rideId: string; callback: unknown } | null;
    } = { current: null };
    const fakeUseCase = {
      execute: (args: {
        rideId: string;
        callback: (v: { rideId: string; status: string }) => void;
      }) => {
        lastArgs.current = args;
        return source.subscribe(args.callback);
      },
    };

    function Probe({ rideId }: { rideId: string }) {
      const ride = useUseCaseSubscription<
        { rideId: string; status: string },
        { rideId: string }
      >({
        useCase: fakeUseCase,
        args: { rideId },
        deps: [rideId],
        initialValue: { rideId, status: 'pending' },
      });
      return <Text testID="status">{`${ride.rideId}/${ride.status}`}</Text>;
    }

    const { getByTestId, rerender, unmount } = render(<Probe rideId="r1" />);
    expect(lastArgs.current?.rideId).toBe('r1');
    expect(getByTestId('status').props.children).toBe('r1/pending');

    act(() => {
      source.emit({ rideId: 'r1', status: 'dispatched' });
    });
    expect(getByTestId('status').props.children).toBe('r1/dispatched');

    rerender(<Probe rideId="r2" />);
    expect(lastArgs.current?.rideId).toBe('r2');
    expect(source.listenerCount()).toBe(1); // exactly one live subscription

    unmount();
    expect(source.listenerCount()).toBe(0);
  });
});
