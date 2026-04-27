import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { buildContainer, type Container, type UseCases } from './container';

const ContainerContext = createContext<Container | null>(null);

interface ContainerProviderProps {
  /**
   * Override the container — used by tests to inject in-memory fakes.
   * In production, omit this prop and the provider builds the real container.
   */
  container?: Container;
  children: ReactNode;
}

/**
 * Provides the DI container to the React tree. Wrap the app root in this once.
 */
export function ContainerProvider({
  container,
  children,
}: ContainerProviderProps) {
  const value = useMemo(() => container ?? buildContainer(), [container]);
  return (
    <ContainerContext.Provider value={value}>
      {children}
    </ContainerContext.Provider>
  );
}

/**
 * Hook returning the use-case map. Throws if used outside of a
 * ContainerProvider — that's a programming error, not a domain error.
 */
export function useUseCases(): UseCases {
  const ctx = useContext(ContainerContext);
  if (ctx === null) {
    throw new Error(
      'useUseCases() called outside <ContainerProvider/>. Wrap your tree in <ContainerProvider/>.',
    );
  }
  return ctx.useCases;
}
