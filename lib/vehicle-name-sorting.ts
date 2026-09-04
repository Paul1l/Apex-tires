interface VehicleOptionWithName {
  name: string;
}

const vehicleNameCollator = new Intl.Collator("ru-RU", {
  numeric: true,
  sensitivity: "base",
});

export function sortVehiclesByName<T extends VehicleOptionWithName>(
  vehicles: readonly T[],
): T[] {
  return [...vehicles].sort((firstVehicle, secondVehicle) =>
    vehicleNameCollator.compare(firstVehicle.name, secondVehicle.name),
  );
}
