import assert from "node:assert/strict";
import test from "node:test";
import { sortVehiclesByName } from "../../lib/vehicle-name-sorting.js";

test("vehicle options are sorted alphabetically with natural numeric order", () => {
  const options = [
    { id: "a10", name: "A10" },
    { id: "camry", name: "Camry" },
    { id: "a4", name: "A4" },
  ];

  const sortedOptions = sortVehiclesByName(options);

  assert.deepEqual(
    sortedOptions.map((option) => option.name),
    ["A4", "A10", "Camry"],
  );
  assert.deepEqual(
    options.map((option) => option.name),
    ["A10", "Camry", "A4"],
    "sorting must not mutate API state",
  );
});
