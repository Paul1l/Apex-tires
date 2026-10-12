import { sortVehiclesByName } from "@/lib/vehicle-name-sorting";

export interface VehicleMake {
  id: string;
  name: string;
}

export interface VehicleModel {
  id: string;
  name: string;
}

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

/**
 * Popular models of global makes sold in Russia. Used when the external
 * catalog (vPIC) is unavailable and merged with it otherwise, so the
 * reference list never shows a make without models. Keys are normalized make
 * names (normalizeVehicleMakeName).
 */
export const FALLBACK_GLOBAL_VEHICLE_MODELS: Record<string, string[]> = {
  TOYOTA: [
    "Alphard", "Auris", "Avensis", "C-HR", "Camry", "Corolla", "Fortuner",
    "Highlander", "Hilux", "Land Cruiser", "Land Cruiser Prado", "RAV4",
    "Venza", "Yaris",
  ],
  KIA: [
    "Carnival", "Ceed", "Cerato", "K5", "Mohave", "Optima", "Picanto", "Rio",
    "Rio X", "Seltos", "Sorento", "Soul", "Sportage", "Stinger",
  ],
  HYUNDAI: [
    "Accent", "Creta", "Elantra", "Getz", "i30", "ix35", "Palisade",
    "Santa Fe", "Solaris", "Sonata", "Staria", "Tucson",
  ],
  VOLKSWAGEN: [
    "Amarok", "Caddy", "Golf", "Jetta", "Multivan", "Passat", "Passat CC",
    "Polo", "Taos", "Teramont", "Tiguan", "Touareg", "Transporter",
  ],
  SKODA: ["Fabia", "Kamiq", "Karoq", "Kodiaq", "Octavia", "Rapid", "Superb", "Yeti"],
  RENAULT: [
    "Arkana", "Dokker", "Duster", "Fluence", "Kaptur", "Koleos", "Logan",
    "Megane", "Sandero", "Sandero Stepway",
  ],
  NISSAN: [
    "Almera", "Juke", "Murano", "Navara", "Note", "Pathfinder", "Patrol",
    "Qashqai", "Teana", "Terrano", "Tiida", "X-Trail",
  ],
  MITSUBISHI: [
    "ASX", "Eclipse Cross", "Galant", "L200", "Lancer", "Outlander", "Pajero",
    "Pajero Sport",
  ],
  MAZDA: ["3", "6", "CX-3", "CX-30", "CX-5", "CX-60", "CX-7", "CX-9"],
  HONDA: ["Accord", "CR-V", "Civic", "Fit", "HR-V", "Jazz", "Pilot"],
  FORD: [
    "EcoSport", "Explorer", "Fiesta", "Focus", "Galaxy", "Kuga", "Mondeo",
    "Ranger", "S-Max", "Transit",
  ],
  CHEVROLET: [
    "Aveo", "Captiva", "Cobalt", "Cruze", "Lacetti", "Lanos", "Niva", "Spark",
    "Tahoe", "Trailblazer",
  ],
  BMW: [
    "1 Series", "3 Series", "5 Series", "7 Series", "X1", "X3", "X4", "X5",
    "X6", "X7",
  ],
  "MERCEDES-BENZ": [
    "A-Class", "C-Class", "CLA", "E-Class", "G-Class", "GLA", "GLC", "GLE",
    "GLS", "S-Class", "Sprinter", "Vito",
  ],
  AUDI: ["A3", "A4", "A5", "A6", "A8", "Q3", "Q5", "Q7", "Q8"],
  LEXUS: ["ES", "GS", "GX", "IS", "LS", "LX", "NX", "RX", "UX"],
  SUBARU: ["Forester", "Impreza", "Legacy", "Outback", "Tribeca", "XV"],
  SUZUKI: ["Grand Vitara", "Jimny", "SX4", "Swift", "Vitara"],
  VOLVO: ["S60", "S80", "S90", "V60", "XC40", "XC60", "XC70", "XC90"],
  "LAND ROVER": [
    "Defender", "Discovery", "Discovery Sport", "Freelander", "Range Rover",
    "Range Rover Evoque", "Range Rover Sport", "Range Rover Velar",
  ],
  OPEL: ["Antara", "Astra", "Corsa", "Insignia", "Mokka", "Vectra", "Zafira"],
  PEUGEOT: [
    "2008", "206", "207", "208", "3008", "307", "308", "4008", "408", "5008",
    "Partner",
  ],
  CITROEN: ["Berlingo", "C-Elysee", "C3", "C4", "C4 Picasso", "C5", "C5 Aircross"],
  INFINITI: ["FX", "G", "Q50", "QX50", "QX56", "QX60", "QX70", "QX80"],
  PORSCHE: ["911", "Cayenne", "Macan", "Panamera", "Taycan"],
  JEEP: ["Cherokee", "Compass", "Grand Cherokee", "Renegade", "Wrangler"],
  CADILLAC: ["CTS", "Escalade", "SRX", "XT5", "XT6"],
  GENESIS: ["G70", "G80", "G90", "GV70", "GV80"],
  MINI: ["Clubman", "Cooper", "Countryman"],
  FIAT: ["500", "Albea", "Doblo", "Ducato", "Punto"],
  "ALFA ROMEO": ["159", "Giulia", "Stelvio"],
  SEAT: ["Ateca", "Ibiza", "Leon"],
  BENTLEY: ["Bentayga", "Continental GT", "Flying Spur"],
  JAGUAR: ["E-Pace", "F-Pace", "XE", "XF", "XJ"],
  TESLA: ["Model 3", "Model S", "Model X", "Model Y"],
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
  return sortVehiclesByName(makes);
}

export function sortVehicleModels(models: VehicleModel[]): VehicleModel[] {
  return sortVehiclesByName(models);
}

export function getSupplementalModelsForMake(makeName: string): VehicleModel[] {
  const normalizedMakeName = normalizeVehicleMakeName(makeName);
  const modelNames = new Set([
    ...(SUPPLEMENTAL_VEHICLE_MODELS[normalizedMakeName] ?? []),
    ...(FALLBACK_GLOBAL_VEHICLE_MODELS[normalizedMakeName] ?? []),
  ]);
  return Array.from(modelNames, (modelName) => ({
    id: `local-${normalizedMakeName}-${modelName}`,
    name: modelName,
  }));
}
