import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  ContainerProvider,
  makeUseCases,
  type Container,
  type UseCases,
} from '@presentation/di';

import { FakeCloudFunctionsService } from './FakeCloudFunctionsService';
import { FakeRoutesService } from './FakeRoutesService';
import { FakeStripeServerService } from './FakeStripeServerService';
import { FakeVinDecoderService } from './FakeVinDecoderService';
import { InMemoryAuthRepository } from './InMemoryAuthRepository';
import { InMemoryLocationRepository } from './InMemoryLocationRepository';
import { InMemoryRideRepository } from './InMemoryRideRepository';
import { InMemoryServiceAreaRepository } from './InMemoryServiceAreaRepository';
import { InMemoryUserRepository } from './InMemoryUserRepository';
import { InMemoryVehiclePhotoRepository } from './InMemoryVehiclePhotoRepository';
import { InMemoryVehicleRepository } from './InMemoryVehicleRepository';

/**
 * Provider for unit tests that need to render a component requiring
 * `useUseCases()`. Three usage modes:
 *
 *   1. Zero config — provides every use case wired against fresh in-memory
 *      AuthRepository + UserRepository + ServiceAreaRepository instances.
 *
 *      <TestContainerProvider><Comp/></TestContainerProvider>
 *
 *   2. Override repositories — useful when the test wants to seed accounts
 *      / users / service-areas before the component mounts.
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
  serviceAreas,
  rides,
  locations,
  routes,
  vehicles,
  vehiclePhotos,
  vinDecoder,
  stripeServer,
  cloudFunctions,
  useCases,
  children,
}: {
  auth?: InMemoryAuthRepository;
  users?: InMemoryUserRepository;
  serviceAreas?: InMemoryServiceAreaRepository;
  rides?: InMemoryRideRepository;
  locations?: InMemoryLocationRepository;
  routes?: FakeRoutesService;
  vehicles?: InMemoryVehicleRepository;
  vehiclePhotos?: InMemoryVehiclePhotoRepository;
  vinDecoder?: FakeVinDecoderService;
  stripeServer?: FakeStripeServerService;
  cloudFunctions?: FakeCloudFunctionsService;
  useCases?: Partial<UseCases>;
  children: ReactNode;
}) {
  const authRepo = auth ?? new InMemoryAuthRepository();
  const usersRepo = users ?? new InMemoryUserRepository();
  const serviceAreasRepo = serviceAreas ?? new InMemoryServiceAreaRepository();
  const ridesRepo = rides ?? new InMemoryRideRepository();
  const locationsRepo = locations ?? new InMemoryLocationRepository();
  const routesService = routes ?? new FakeRoutesService();
  const vehiclesRepo = vehicles ?? new InMemoryVehicleRepository();
  const vehiclePhotosRepo =
    vehiclePhotos ?? new InMemoryVehiclePhotoRepository();
  const vinDecoderService = vinDecoder ?? new FakeVinDecoderService();
  const stripeServerService = stripeServer ?? new FakeStripeServerService();
  const cloudFunctionsService =
    cloudFunctions ?? new FakeCloudFunctionsService();
  const base = makeUseCases({
    auth: authRepo,
    users: usersRepo,
    serviceAreas: serviceAreasRepo,
    rides: ridesRepo,
    locations: locationsRepo,
    routes: routesService,
    vehicles: vehiclesRepo,
    vehiclePhotos: vehiclePhotosRepo,
    vinDecoder: vinDecoderService,
    stripeServer: stripeServerService,
    paymentCallable: cloudFunctionsService,
  });
  const merged: UseCases = { ...base, ...useCases };
  const container: Container = { useCases: merged };

  // Every view-model test needs a QueryClientProvider — view-models
  // compose TanStack queries / mutations as of Phase 3 turn 3. Make a
  // fresh client per test so cache state doesn't leak between renders.
  // `retry: false` so a deliberate "this throws" path doesn't burn time
  // through TanStack's default retry policy.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ContainerProvider container={container}>{children}</ContainerProvider>
    </QueryClientProvider>
  );
}
