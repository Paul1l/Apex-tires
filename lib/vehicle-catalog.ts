export interface VehicleMake {
  id: string;
  name: string;
}

export interface VehicleModel {
  id: string;
  name: string;
}

const PREFERRED_MAKE_ORDER = [
  "LADA",
  "MOSKVICH",
  "UAZ",
  "GAZ",
  "AURUS",
  "TOYOTA",
  "BMW",
  "MERCEDES-BENZ",
  "AUDI",
  "VOLKSWAGEN",
  "KIA",
  "HYUNDAI",
  "SKODA",
  "RENAULT",
  "NISSAN",
  "MITSUBISHI",
  "MAZDA",
  "HONDA",
  "FORD",
  "CHEVROLET",
  "VOLVO",
  "LAND ROVER",
  "LEXUS",
  "SUBARU",
  "PORSCHE",
  "CHERY",
  "EXEED",
  "OMODA",
  "JAECOO",
  "HAVAL",
  "TANK",
  "GEELY",
  "CHANGAN",
  "GAC",
  "HONGQI",
  "LI AUTO",
  "ZEEKR",
  "BYD",
];

const DISPLAY_MAKE_NAMES: Record<string, string> = {
  BMW: "BMW",
  BYD: "BYD",
  "GAC": "GAC",
  GAZ: "ГАЗ",
  GMC: "GMC",
  JAC: "JAC",
  KIA: "Kia",
  LADA: "LADA",
  "LAND ROVER": "Land Rover",
  "LI AUTO": "Li Auto",
  MAN: "MAN",
  MAZ: "МАЗ",
  MINI: "MINI",
  MOSKVICH: "Москвич",
  RAM: "RAM",
  UAZ: "УАЗ",
  VAZ: "ВАЗ",
};

const SUPPLEMENTAL_MAKE_ALIASES: Record<string, string> = {
  "ГАЗ": "GAZ",
  "МОСКВИЧ": "MOSKVICH",
  "УАЗ": "UAZ",
  "ВАЗ": "VAZ",
};

export const SUPPLEMENTAL_VEHICLE_MODELS: Record<string, string[]> = {
  LADA: [
    "Granta",
    "Vesta",
    "Vesta Cross",
    "Largus",
    "Niva Legend",
    "Niva Travel",
    "XRAY",
    "Kalina",
    "Priora",
    "Samara",
    "2104",
    "2105",
    "2106",
    "2107",
    "2108",
    "2109",
    "2110",
    "2111",
    "2112",
  ],
  MOSKVICH: ["3", "3e", "6", "8", "2140", "2141"],
  UAZ: ["Patriot", "Pickup", "Hunter", "Буханка", "469"],
  GAZ: ["Соболь NN", "Газель NN", "Газель Next", "Соболь", "Волга"],
  AURUS: ["Senat", "Komendant", "Arsenal"],
  CHERY: [
    "Arrizo 8",
    "Tiggo 4",
    "Tiggo 4 Pro",
    "Tiggo 7 Pro",
    "Tiggo 7 Pro Max",
    "Tiggo 8",
    "Tiggo 8 Pro",
    "Tiggo 8 Pro Max",
    "Tiggo 9",
  ],
  EXEED: ["LX", "TXL", "RX", "VX"],
  OMODA: ["C5", "C7", "S5", "S5 GT"],
  JAECOO: ["J7", "J8"],
  HAVAL: [
    "Dargo",
    "Dargo X",
    "F7",
    "F7x",
    "H5",
    "H6",
    "H9",
    "Jolion",
    "M6",
  ],
  TANK: ["300", "400", "500", "700"],
  GEELY: [
    "Atlas",
    "Atlas Pro",
    "Coolray",
    "Emgrand",
    "Monjaro",
    "Okavango",
    "Preface",
    "Tugella",
  ],
  CHANGAN: [
    "Alsvin",
    "CS35 Plus",
    "CS55 Plus",
    "CS75 Plus",
    "CS85 Coupe",
    "CS95",
    "Eado Plus",
    "Hunter Plus",
    "UNI-K",
    "UNI-S",
    "UNI-T",
    "UNI-V",
  ],
  GAC: ["Empow", "GS3", "GS4", "GS5", "GS8", "M8"],
  HONGQI: ["E-HS9", "H5", "H9", "HS3", "HS5", "HS7"],
  "LI AUTO": ["L6", "L7", "L8", "L9", "Mega"],
  ZEEKR: ["001", "007", "009", "7X", "X"],
  BYD: ["Atto 3", "Dolphin", "Han", "Seal", "Song Plus", "Tang"],
  VOYAH: ["Dream", "Free", "Passion"],
  BAIC: ["BJ40", "BJ60", "EU5", "U5 Plus", "X35", "X55", "X7"],
  JAC: ["J7", "JS3", "JS4", "JS6", "T8", "T9"],
  DONGFENG: ["580", "Aeolus Shine", "Huge", "Mage", "Shine Max"],
};

const FALLBACK_GLOBAL_MAKES = [
  "Toyota",
  "BMW",
  "Mercedes-Benz",
  "Audi",
  "Volkswagen",
  "Kia",
  "Hyundai",
  "Skoda",
  "Renault",
  "Nissan",
  "Mitsubishi",
  "Mazda",
  "Honda",
  "Ford",
  "Chevrolet",
  "Volvo",
  "Land Rover",
  "Lexus",
  "Subaru",
  "Porsche",
  "Peugeot",
  "Citroen",
  "Opel",
  "Suzuki",
  "Jeep",
  "Cadillac",
  "Infiniti",
  "Genesis",
  "Mini",
  "Fiat",
  "Alfa Romeo",
  "Seat",
  "Bentley",
  "Jaguar",
  "Tesla",
];

export function normalizeVehicleMakeName(makeName: string): string {
  const normalizedMakeName = makeName.trim().replace(/\s+/g, " ").toUpperCase();
  return SUPPLEMENTAL_MAKE_ALIASES[normalizedMakeName] ?? normalizedMakeName;
}

export function formatVehicleMakeName(makeName: string): string {
  const normalizedName = normalizeVehicleMakeName(makeName);
  if (DISPLAY_MAKE_NAMES[normalizedName]) {
    return DISPLAY_MAKE_NAMES[normalizedName];
  }
  return normalizedName
    .toLocaleLowerCase("en-US")
    .replace(/(^|[\s-])\p{L}/gu, (character) =>
      character.toLocaleUpperCase("en-US"),
    );
}

export function getSupplementalVehicleMakes(): VehicleMake[] {
  const supplementalNames = [
    ...Object.keys(SUPPLEMENTAL_VEHICLE_MODELS),
    ...FALLBACK_GLOBAL_MAKES,
  ];
  const uniqueNames = new Map<string, VehicleMake>();

  for (const makeName of supplementalNames) {
    const normalizedName = normalizeVehicleMakeName(makeName);
    uniqueNames.set(normalizedName, {
      id: `local-${normalizedName.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-")}`,
      name: formatVehicleMakeName(normalizedName),
    });
  }

  return Array.from(uniqueNames.values());
}

export function sortVehicleMakes(makes: VehicleMake[]): VehicleMake[] {
  const preferredPositions = new Map(
    PREFERRED_MAKE_ORDER.map((makeName, index) => [makeName, index]),
  );

  return [...makes].sort((firstMake, secondMake) => {
    const firstPosition =
      preferredPositions.get(normalizeVehicleMakeName(firstMake.name)) ??
      Number.MAX_SAFE_INTEGER;
    const secondPosition =
      preferredPositions.get(normalizeVehicleMakeName(secondMake.name)) ??
      Number.MAX_SAFE_INTEGER;
    if (firstPosition !== secondPosition) {
      return firstPosition - secondPosition;
    }
    return firstMake.name.localeCompare(secondMake.name, "ru");
  });
}

export function getSupplementalModelsForMake(makeName: string): VehicleModel[] {
  const normalizedMakeName = normalizeVehicleMakeName(makeName);
  return (SUPPLEMENTAL_VEHICLE_MODELS[normalizedMakeName] ?? []).map(
    (modelName) => ({
      id: `local-${normalizedMakeName}-${modelName}`,
      name: modelName,
    }),
  );
}
