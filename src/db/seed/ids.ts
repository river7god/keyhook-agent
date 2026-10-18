/**
 * Deterministic seed IDs so tests, evals and the simulator can reference fixtures by name.
 * Format: 00000000-0000-4000-8KKK-NNNNNNNNNNNN (valid v4-shaped UUID; KKK = entity kind).
 */
const KIND = {
  organization: 1,
  propertyManager: 2,
  owner: 3,
  property: 4,
  tenant: 5,
  tenancy: 6,
  tradie: 7,
  job: 8,
  arrearsCase: 9,
} as const;

export function seedId(kind: keyof typeof KIND, n: number): string {
  return `00000000-0000-4000-8${String(KIND[kind]).padStart(3, '0')}-${String(n).padStart(12, '0')}`;
}

export const ORG = {
  harbourCity: seedId('organization', 1),
  aroValley: seedId('organization', 2),
} as const;

export const PM = {
  aroha: seedId('propertyManager', 1),
  liam: seedId('propertyManager', 2),
  mere: seedId('propertyManager', 3),
} as const;

export const OWNER = {
  wilson: seedId('owner', 1),
  tePuniTrust: seedId('owner', 2),
  patel: seedId('owner', 3),
  kim: seedId('owner', 4),
  walkerTrust: seedId('owner', 5),
  oconnell: seedId('owner', 6),
  aroValleyOwner: seedId('owner', 7),
} as const;

export const PROPERTY = {
  teAro: seedId('property', 1),
  newtown: seedId('property', 2),
  kelburn: seedId('property', 3),
  karori: seedId('property', 4),
  islandBay: seedId('property', 5),
  miramar: seedId('property', 6),
  brooklyn: seedId('property', 7),
  thorndon: seedId('property', 8),
  mtVictoria: seedId('property', 9),
  johnsonville: seedId('property', 10),
  aroValley: seedId('property', 11),
} as const;

export const TRADIE = {
  capitalPlumbing: seedId('tradie', 1),
  southCoastPlumbing: seedId('tradie', 2),
  brightSparks: seedId('tradie', 3),
  windyCityElectrical: seedId('tradie', 4),
  heatPumpHeroes: seedId('tradie', 5),
  handyHana: seedId('tradie', 6),
  oldFixIt: seedId('tradie', 7),
  lockSafe: seedId('tradie', 8),
  aroValleyHandyman: seedId('tradie', 9),
} as const;
