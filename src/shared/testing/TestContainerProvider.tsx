import type { ReactNode } from 'react';

import {
  ContainerProvider,
  makeUseCases,
  type Container,
  type UseCases,
} from '@presentation/di';

import { InMemoryAuthRepository } from './InMemoryAuthRepository';
import { InMemoryUserRepository } from './InMemoryUserRepository';

/**
 * Provider for unit tests that need to render a component requiring
 * `useUseCases()`. Three usage modes:
 *
 *   1. Zero config — provides every use case wired against fresh in-memory
 *      AuthRepository + UserRepository instances.
 *
 *      <TestContainerProvider><Comp/></TestContainerProvider>
 *
 *   2. Override repositories — useful when the test wants to seed accounts
 *      / users before the component mounts.
 *
 *      <TestContainerProvider auth={authFake} users={usersFake}>
 *        <Comp/>
 *      </TestContainerProvider>
 *
 *   3. Override individual use cases — useful for stubbing a single use case
 *      to a fake implementation.
 *
 *      <TestContainerProvider useCases={{ logInUser: stub }}>
 *        <Comp/>
 *      </TestContainerProvider>
 */
export function TestContainerProvider({
  auth,
  users,
  useCases,
  children,
}: {
  auth?: InMemoryAuthRepository;
  users?: InMemoryUserRepository;
  useCases?: Partial<UseCases>;
  children: ReactNode;
}) {
  const authRepo = auth ?? new InMemoryAuthRepository();
  const usersRepo = users ?? new InMemoryUserRepository();
  const base = makeUseCases({ auth: authRepo, users: usersRepo });
  const merged: UseCases = { ...base, ...useCases };
  const container: Container = { useCases: merged };
  return (
    <ContainerProvider container={container}>{children}</ContainerProvider>
  );
}
