import { norm } from "./match";

// Who is worth a cold call. Two kinds of listing aren't:
//   chains     the person who answers a store phone can't buy: decisions sit with corporate marketing
//   non-fits   businesses that don't buy a local website + visibility program (gas stations, casinos…)
// Pure functions, used at discovery (skip / flag) and at scoring (rank them out of the call list).

// National and regional chains and franchises seen in the leads. A one-word brand must start the name
// ("Maverik #412"); a longer one can sit anywhere ("Tooele Discount Tire"). Add to it freely.
export const CHAIN_BRANDS = [
  "7-eleven", "ace hardware", "advance auto parts", "aamco", "american family insurance", "arby's", "autozone",
  "big o tires", "bed bath", "best buy", "burger king", "camping world", "carmax", "carquest", "chick-fil-a",
  "circle k", "costco", "cvs", "dairy queen", "dick's sporting", "discount tire", "dollar general", "dollar tree", "domino's",
  "edward jones", "enterprise rent", "esab", "family dollar", "farmers insurance", "firestone", "goodyear", "great clips",
  "h&r block", "harbor freight", "hertz", "holiday oil", "home depot", "jackson hewitt", "jiffy lube", "kum & go", "les schwab",
  "liberty tax", "lowe's", "maaco", "maidthis", "maverik", "mcdonald's", "meineke", "men's wearhouse", "midas", "miller travel",
  "mister car wash", "molly maid", "napa auto parts", "o'reilly", "orkin", "papa john's", "pep boys", "petco", "petsmart",
  "pilot travel", "pizza hut", "red hanger", "rent-a-center", "roto-rooter", "safelite", "sapp bros", "servicemaster",
  "servpro", "sherwin-williams", "sportsman's warehouse", "state farm", "subway", "supercuts",
  "take 5 oil", "taco bell", "terminix", "the joint chiropractic", "the ups store", "tractor supply", "u-haul", "valvoline",
  "walgreens", "walmart", "wendy's", "zions bank",
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const brands = CHAIN_BRANDS.map(norm);
const BRAND_RE = new RegExp(
  `^(the )?(${brands.filter((b) => !b.includes(" ")).map(esc).join("|")})\\b|\\b(${brands.filter((b) => b.includes(" ")).map(esc).join("|")})\\b`,
);

// Store-locator pages: the listing links to one branch of a bigger site.
const STORE_LOCATOR = /\/(locations?|stores?|store-locator|store-finder|branches|find-a-store|dealers?)\//i;

/** US/Canada toll-free main number: almost always a corporate line. */
export function tollFree(phone: string | null | undefined): boolean {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 && /^8(00|33|44|55|66|77|88)/.test(d);
}

/** Why this listing looks like a chain or franchise location, or null. */
export function chainReason(b: { name: string; phone?: string | null; website?: string | null; chain?: boolean | number | null }): string | null {
  const m = norm(b.name).match(BRAND_RE);
  if (m) {
    const brand = CHAIN_BRANDS[brands.indexOf(m[2] ?? m[3])] ?? m[0];
    return `Chain or franchise (${brand.replace(/(^|[\s-])\w/g, (c) => c.toUpperCase())})`;
  }
  if (b.chain) return "Part of a chain: several locations with this name";
  if (tollFree(b.phone)) return "Toll-free main number: a corporate line";
  try {
    if (b.website && STORE_LOCATOR.test(new URL(b.website).pathname)) return "Website is a branch page of a bigger site";
  } catch {}
  return null;
}

// Business kinds that don't buy a local website + visibility program, by Google type, Google label
// or name. `allow` = catalog types that searched for exactly this (then it's what the user wanted).
const NON_FIT: { what: string; gtypes: string[]; label?: RegExp; name?: RegExp; allow?: string[] }[] = [
  { what: "a gas station", gtypes: ["gas_station", "truck_stop"], label: /\b(gas station|fuel|truck stop|travel (center|plaza))\b/, name: /\b(travel (center|plaza)|truck stop|fuel stop)\b/ },
  { what: "a convenience store", gtypes: ["convenience_store"], label: /\bconvenience store\b/ },
  { what: "a casino", gtypes: ["casino"], label: /\bcasino\b/, name: /\bcasino\b/ },
  { what: "a hotel or lodging", gtypes: ["lodging", "hotel", "motel", "resort_hotel", "extended_stay_hotel", "inn", "hostel"], label: /\b(hotel|motel|lodging|resort|hostel)\b/, allow: ["hotel", "guest_house"] },
  { what: "an RV park or campground", gtypes: ["rv_park", "campground", "camping_cabin"], label: /\b(rv park|campground)\b/, name: /\b(rv park|campground)\b/, allow: ["vacation_rental"] },
  { what: "parking or storage", gtypes: ["parking", "parking_lot", "parking_garage", "storage"], label: /\b(parking|self storage|storage facility)\b/, name: /\b(self storage|storage units?|mini storage)\b/, allow: ["storage"] },
  { what: "an EV charging station", gtypes: ["electric_vehicle_charging_station"], label: /\bcharging station\b/, name: /\b(supercharger|ev charging)\b/ },
  { what: "a car rental", gtypes: ["car_rental", "truck_rental"], label: /\b(car|truck) rental\b/, allow: ["car_rental"] },
  { what: "a department store", gtypes: ["department_store", "warehouse_store", "discount_store", "wholesaler"], label: /\b(department store|warehouse store|wholesaler|discount store)\b/ },
  { what: "a supplier or manufacturer", gtypes: ["manufacturer", "supplier"], label: /\b(manufacturer|supplier|distributor|wholesale)\b/, name: /\b(supply|supplies|wholesale|distributors?|manufacturing)\b/ },
  { what: "a pawn shop", gtypes: ["pawn_shop"], label: /\bpawn\b/, name: /\bpawn\b/, allow: ["second_hand"] },
  { what: "an auction house", gtypes: ["auction_house"], label: /\bauction\b/, name: /\bauction\b/ },
  { what: "a park", gtypes: ["park", "state_park", "national_park", "tourist_attraction"], label: /^(park|state park|national park|tourist attraction|historical landmark)$/, name: /\b(state park|ranch historic)\b/ },
  { what: "an event venue", gtypes: ["event_venue", "concert_hall", "performing_arts_theater"], label: /\b(event venue|concert hall|performing arts)\b/, allow: ["event_venue", "theatre"] },
  { what: "a government office", gtypes: ["local_government_office", "government_office", "city_hall"], label: /\bgovernment\b/ },
];

/**
 * "Not a fit: a gas station", or null. `primaryType` (discovery) or the stored Google label decide;
 * the name catches what Google files elsewhere ("Hy & Mike's Pawn"). A search for exactly that
 * type (`categoryId`) is respected.
 */
export function nonFitReason(b: { name: string; primaryType?: string | null; googleLabel?: string | null; categoryId?: string | null }): string | null {
  const name = ` ${norm(b.name)} `;
  const label = b.googleLabel ? norm(b.googleLabel) : "";
  for (const r of NON_FIT) {
    if (b.categoryId && r.allow?.includes(b.categoryId)) continue;
    const hit = (b.primaryType && r.gtypes.includes(b.primaryType)) || (label && r.label?.test(label)) || (r.name && r.name.test(name));
    if (hit) return `Not a fit: ${r.what}`;
  }
  return null;
}

/** "(435) 884-3390" for US/Canada numbers; anything else is just trimmed. One format, so dedupe works. */
export function formatPhone(raw: string | null | undefined, countryCode?: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  const us = !countryCode || /^(US|CA)$/i.test(countryCode);
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : null;
  if (us && ten && !/^\+(?!1)/.test(v)) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return v;
}
