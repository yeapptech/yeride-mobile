/**
 * Optional technical specifications harvested from the NHTSA decode (or
 * filled in by manual entry). Every sub-section and every field is
 * optional — this matches the legacy doc shape where `vehicleSpecs` is a
 * free-form object whose keys may or may not be present depending on
 * which NHTSA fields the VIN happened to populate.
 *
 * The mapper accepts whatever fields it sees; the entity treats them as
 * pure metadata. None of these are required for `Vehicle.create` to
 * succeed.
 */
export interface VehicleEngineSpecs {
  readonly cylinders?: number;
  readonly displacementL?: number;
  readonly fuelType?: string;
  readonly configuration?: string;
  readonly model?: string;
  readonly turbo?: string;
}

export interface VehicleTransmissionSpecs {
  readonly style?: string;
  readonly speeds?: number;
}

export interface VehicleSafetySpecs {
  readonly airbagLocations?: string;
  readonly seatBelts?: string;
  readonly abs?: string;
  readonly esc?: string;
  readonly tractionControl?: string;
}

export interface VehicleDimensionSpecs {
  readonly doors?: number;
  readonly seats?: number;
  readonly wheelBase?: number;
  readonly gvwr?: string;
}

export interface VehicleManufacturerSpecs {
  readonly manufacturer?: string;
  readonly plantCity?: string;
  readonly plantState?: string;
  readonly plantCountry?: string;
}

export interface VehicleSpecs {
  readonly engine?: VehicleEngineSpecs;
  readonly transmission?: VehicleTransmissionSpecs;
  readonly safety?: VehicleSafetySpecs;
  readonly dimensions?: VehicleDimensionSpecs;
  readonly manufacturer?: VehicleManufacturerSpecs;
}
