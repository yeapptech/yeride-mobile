export { ChatMessageDocSchema, type ChatMessageDoc } from './ChatMessageDoc';
export {
  RideDocSchema,
  type CancellationDoc,
  type DriverDoc as RideDriverDoc,
  type DropoffEndpointDoc,
  type EmbeddedDirectionsDoc,
  type PassengerDoc,
  type PickupEndpointDoc,
  type RideDoc,
  type RideServiceEmbeddedDoc,
  type RoutePreferenceDoc,
  type VehicleSnapshotDoc,
} from './RideDoc';
export { RideServiceDocSchema, type RideServiceDoc } from './RideServiceDoc';
export { ServiceAreaDocSchema, type ServiceAreaDoc } from './ServiceAreaDoc';
export { TripEventDocSchema, type TripEventDoc } from './TripEventDoc';
export { TripPaymentDocSchema, type TripPaymentDoc } from './TripPaymentDoc';
export {
  TripTrackingDocSchema,
  UserLocationDocSchema,
  type TripTrackingDoc,
  type UserLocationDoc,
} from './UserLocationDoc';
export {
  UserDocSchema,
  type DriverDoc,
  type RiderDoc,
  type SavedPlaceDoc,
  type UserDoc,
} from './UserDoc';
export {
  VehicleDocSchema,
  type VehicleDoc,
  type VehiclePhotosDoc,
  type VehicleSpecsDoc,
  type VehicleWriteDoc,
} from './VehicleDoc';
