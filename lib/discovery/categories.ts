// Business-type catalog. Each type maps to OpenStreetMap tags (for the free Overpass source),
// optional name keywords (for types that are often tagged inconsistently, e.g. smoke shops),
// and Google Places text queries (for the optional Google source).
//
// A search stores a list of selection tokens:
//   "<typeId>"            one catalog type, e.g. "smoke_shop"
//   "group:<groupId>"     every type in a group, e.g. "group:smoke"
//   "all"                 every commercial business
//   "kw:<text>"           custom: business name contains <text>
//   "tag:<key>=<value>"   custom: any OpenStreetMap tag, e.g. "tag:shop=tobacco" ("tag:<key>" = any value)

import { localLang, localTerm, type Lang } from "./local-terms";

export type OsmMatch = { key: string; values?: string[] };

export type BizType = {
  id: string;
  label: string;
  group: string;
  osm: OsmMatch[];
  names?: string[]; // name keywords, matched case-insensitively on businesses with a commercial tag
  google: string[];
  gtypes?: string[]; // Google Places types that confirm a place is this type (see GOOGLE_TYPES)
  search?: string; // what customers type for the top-3 check, when it isn't google[0] (lib/check/terms.ts)
};

export const GROUPS = [
  { id: "food", label: "Food & drink" },
  { id: "smoke", label: "Smoke, vape & CBD" },
  { id: "health", label: "Health & medical" },
  { id: "beauty", label: "Beauty & wellness" },
  { id: "fitness", label: "Fitness & sports" },
  { id: "retail", label: "Retail" },
  { id: "home", label: "Home & garden" },
  { id: "auto", label: "Automotive" },
  { id: "professional", label: "Professional services" },
  { id: "trades", label: "Trades & home services" },
  { id: "hospitality", label: "Hotels & travel" },
  { id: "education", label: "Education & childcare" },
  { id: "pets", label: "Pets" },
  { id: "entertainment", label: "Entertainment & events" },
] as const;

const t = (id: string, label: string, group: string, osm: OsmMatch[], google: string[], names?: string[]): BizType => ({
  id,
  label,
  group,
  osm,
  google,
  names,
});
const shop = (...values: string[]): OsmMatch => ({ key: "shop", values });
const amenity = (...values: string[]): OsmMatch => ({ key: "amenity", values });
const craft = (...values: string[]): OsmMatch => ({ key: "craft", values });
const office = (...values: string[]): OsmMatch => ({ key: "office", values });
const healthcare = (...values: string[]): OsmMatch => ({ key: "healthcare", values });
const leisure = (...values: string[]): OsmMatch => ({ key: "leisure", values });
const tourism = (...values: string[]): OsmMatch => ({ key: "tourism", values });

export const BUSINESS_TYPES: BizType[] = [
  // Food & drink
  t("restaurant", "Restaurants", "food", [amenity("restaurant")], ["restaurant"]),
  t("cafe", "Cafés & coffee shops", "food", [amenity("cafe"), shop("coffee", "tea")], ["cafe", "coffee shop"]),
  t("bar", "Bars & pubs", "food", [amenity("bar", "pub", "biergarten")], ["bar", "pub"]),
  t("fast_food", "Fast food & takeaway", "food", [amenity("fast_food", "food_court")], ["takeaway restaurant"]),
  t("bakery", "Bakeries & pastry", "food", [shop("bakery", "pastry", "confectionery", "chocolate")], ["bakery"]),
  t("ice_cream", "Ice cream & desserts", "food", [amenity("ice_cream"), shop("ice_cream")], ["ice cream shop"]),
  t("butcher", "Butchers & delis", "food", [shop("butcher", "deli", "cheese", "seafood")], ["butcher shop", "deli"]),
  t("grocery", "Grocery & convenience", "food", [shop("greengrocer", "convenience", "health_food", "organic", "farm")], ["grocery store"]),
  t("liquor", "Liquor & wine stores", "food", [shop("alcohol", "wine", "beverages")], ["liquor store", "wine shop"]),
  t("brewery", "Breweries, wineries & distilleries", "food", [craft("brewery", "winery", "distillery")], ["brewery", "winery"]),
  t("caterer", "Catering", "food", [craft("caterer")], ["catering service"]),

  // Smoke, vape & CBD
  t("smoke_shop", "Smoke shops & tobacconists", "smoke", [shop("tobacco", "headshop", "smoke_shop", "smoking")], ["smoke shop", "tobacco shop"], [
    "smoke",
    "tobacco",
    "cigar",
    "head shop",
    // Spanish / Portuguese / French / German names, common outside the US
    "tabac",
    "tabaq",
    "fumador",
    "habano",
    "grow shop",
    "growshop",
    "tabak",
  ]),
  t("vape_shop", "Vape shops", "smoke", [shop("e-cigarette", "vape")], ["vape shop"], ["vape", "vapor", "vaper", "vapeo"]),
  t("cbd_shop", "CBD & cannabis dispensaries", "smoke", [shop("cannabis", "cbd"), healthcare("cannabis")], ["cbd store", "dispensary"], [
    "cbd",
    "dispensary",
    "cannabis",
  ]),
  t("hookah", "Hookah lounges", "smoke", [amenity("hookah_lounge"), shop("hookah")], ["hookah lounge"], ["hookah", "shisha", "cachimba", "narguil"]),

  // Health & medical
  t("dentist", "Dentists & orthodontists", "health", [amenity("dentist"), healthcare("dentist")], ["dentist", "orthodontist"]),
  t("doctor", "Doctors & clinics", "health", [amenity("doctors", "clinic"), healthcare("doctor", "clinic", "centre")], ["medical clinic", "doctor"]),
  t("pharmacy", "Pharmacies", "health", [amenity("pharmacy"), shop("chemist")], ["pharmacy"]),
  t("physio", "Physiotherapy & rehab", "health", [healthcare("physiotherapist", "rehabilitation", "occupational_therapist")], ["physiotherapist"]),
  t("chiropractor", "Chiropractors", "health", [{ key: "healthcare:speciality", values: ["chiropractic"] }], ["chiropractor"], ["chiropract"]),
  t("optician", "Opticians & optometrists", "health", [shop("optician"), healthcare("optometrist")], ["optometrist", "optician"]),
  t("mental_health", "Therapists & counselling", "health", [healthcare("psychotherapist", "counselling", "psychologist")], ["therapist", "counselor"]),
  t("alt_medicine", "Alternative medicine & acupuncture", "health", [healthcare("alternative")], ["acupuncture", "naturopath"]),
  t("hearing", "Hearing & medical supply", "health", [shop("hearing_aids", "medical_supply"), healthcare("audiologist")], ["hearing aid center"]),
  t("veterinary", "Veterinarians", "health", [amenity("veterinary")], ["veterinarian"]),

  // Beauty & wellness
  t("hair_salon", "Hair salons", "beauty", [shop("hairdresser")], ["hair salon"]),
  t("barber", "Barbershops", "beauty", [shop("barber"), { key: "hairdresser", values: ["barber"] }], ["barbershop"], ["barber"]),
  t("beauty_salon", "Beauty salons", "beauty", [shop("beauty")], ["beauty salon"]),
  t("nail_salon", "Nail salons", "beauty", [shop("nails"), { key: "beauty", values: ["nails"] }], ["nail salon"], ["nail"]),
  t("spa", "Spas & massage", "beauty", [leisure("spa", "sauna"), amenity("spa"), shop("massage")], ["day spa", "massage"]),
  t("tanning", "Tanning salons", "beauty", [leisure("tanning_salon"), { key: "beauty", values: ["tanning"] }], ["tanning salon"]),
  t("tattoo", "Tattoo & piercing", "beauty", [shop("tattoo", "piercing")], ["tattoo shop"]),
  t("cosmetics", "Cosmetics & perfume", "beauty", [shop("cosmetics", "perfumery", "wigs")], ["cosmetics store"]),

  // Fitness & sports
  t("gym", "Gyms & fitness centres", "fitness", [leisure("fitness_centre")], ["gym"]),
  t("yoga", "Yoga & pilates studios", "fitness", [{ key: "sport", values: ["yoga", "pilates"] }], ["yoga studio", "pilates studio"], ["yoga", "pilates"]),
  t("martial_arts", "Martial arts & boxing", "fitness", [{ key: "sport", values: ["martial_arts", "karate", "judo", "taekwondo", "boxing", "mma", "brazilian_jiu_jitsu", "kickboxing"] }], [
    "martial arts school",
    "boxing gym",
  ]),
  t("dance", "Dance studios", "fitness", [leisure("dance"), amenity("dancing_school")], ["dance studio"]),
  t("sports_centre", "Sports centres & clubs", "fitness", [leisure("sports_centre", "sports_hall")], ["sports club"]),
  t("climbing", "Climbing gyms", "fitness", [{ key: "sport", values: ["climbing"] }], ["climbing gym"]),
  t("golf", "Golf courses", "fitness", [leisure("golf_course")], ["golf course"]),

  // Retail
  t("clothing", "Clothing & boutiques", "retail", [shop("clothes", "boutique", "fashion", "fashion_accessories")], ["clothing store", "boutique"]),
  t("shoes", "Shoe stores", "retail", [shop("shoes")], ["shoe store"]),
  t("jewelry", "Jewelry & watches", "retail", [shop("jewelry", "watches")], ["jewelry store"]),
  t("electronics", "Electronics & phones", "retail", [shop("electronics", "computer", "mobile_phone", "hifi")], ["electronics store", "cell phone store"]),
  t("books", "Books & stationery", "retail", [shop("books", "stationery")], ["bookstore"]),
  t("gifts", "Gift, party & souvenir shops", "retail", [shop("gift", "souvenir", "party", "craft")], ["gift shop"]),
  t("toys", "Toys & games", "retail", [shop("toys", "games", "video_games", "model")], ["toy store"]),
  t("sports_shop", "Sporting goods & outdoor", "retail", [shop("sports", "outdoor", "fishing", "hunting", "weapons")], ["sporting goods store"]),
  t("bicycle", "Bike shops", "retail", [shop("bicycle")], ["bike shop"]),
  t("music_shop", "Music & instruments", "retail", [shop("musical_instrument", "music")], ["music store"]),
  t("art_shop", "Art, framing & galleries", "retail", [shop("art", "frame"), tourism("gallery")], ["art gallery", "frame shop"]),
  t("second_hand", "Thrift, antiques & pawn", "retail", [shop("second_hand", "charity", "antiques", "pawnbroker")], ["thrift store", "antique shop", "pawn shop"]),
  t("variety", "Variety & general stores", "retail", [shop("variety_store", "general", "department_store")], ["variety store"]),
  t("photo", "Photo & camera shops", "retail", [shop("photo", "camera")], ["camera store"]),
  t("fabric", "Fabric & sewing", "retail", [shop("fabric", "sewing", "wool")], ["fabric store"]),
  t("adult", "Adult & lingerie", "retail", [shop("erotic", "lingerie")], ["lingerie store"]),

  // Home & garden
  t("furniture", "Furniture stores", "home", [shop("furniture", "bed")], ["furniture store"]),
  t("interior", "Interior design & decor", "home", [shop("interior_decoration", "curtain", "carpet", "flooring", "tiles", "lighting")], ["interior designer"]),
  t("kitchen_bath", "Kitchen & bath", "home", [shop("kitchen", "bathroom_furnishing", "appliance")], ["kitchen remodeling"]),
  t("garden_centre", "Garden centres & nurseries", "home", [shop("garden_centre", "garden_furniture")], ["garden center", "plant nursery"]),
  t("florist", "Florists", "home", [shop("florist")], ["florist"]),
  t("hardware", "Hardware & paint", "home", [shop("hardware", "doityourself", "paint", "trade")], ["hardware store"]),

  // Automotive
  t("car_dealer", "Car dealers", "auto", [shop("car")], ["car dealer"]),
  t("car_repair", "Auto repair & body shops", "auto", [shop("car_repair")], ["auto repair shop"]),
  t("tyres", "Tires & auto parts", "auto", [shop("tyres", "car_parts")], ["tire shop", "auto parts store"]),
  t("car_wash", "Car wash & detailing", "auto", [amenity("car_wash")], ["car wash", "auto detailing"], ["detailing"]),
  t("motorcycle", "Motorcycles & powersports", "auto", [shop("motorcycle", "motorcycle_repair", "atv")], ["motorcycle dealer"]),
  t("car_rental", "Car rental", "auto", [amenity("car_rental")], ["car rental"]),
  // Owner-run auto niches (Oct 2026 audit brief): high-ticket, rarely with a good website.
  t("mobile_mechanic", "Mobile mechanics", "auto", [], ["mobile mechanic"], ["mobile mechanic", "mobile auto repair", "mobile diesel"]),
  t("diesel_repair", "Diesel & fleet repair", "auto", [], ["diesel repair shop", "fleet repair service"], ["diesel", "fleet"]),
  t("ceramic_coating", "Ceramic coating & PPF", "auto", [], ["ceramic coating", "paint protection film"], ["ceramic", "ppf", "paint protection"]),

  // Professional services
  t("lawyer", "Law firms", "professional", [office("lawyer", "notary")], ["law firm"]),
  t("accountant", "Accountants & tax", "professional", [office("accountant", "tax_advisor")], ["accountant", "tax preparation"]),
  t("real_estate", "Real estate agents", "professional", [office("estate_agent", "property_management")], ["real estate agency"]),
  t("insurance", "Insurance agents", "professional", [office("insurance")], ["insurance agency"]),
  t("financial", "Financial advisors", "professional", [office("financial", "financial_advisor")], ["financial advisor"]),
  t("architect", "Architects & engineers", "professional", [office("architect", "engineer", "surveyor")], ["architect"]),
  t("marketing", "Marketing & design agencies", "professional", [office("advertising_agency", "marketing", "graphic_design")], ["marketing agency"]),
  t("it", "IT & software companies", "professional", [office("it", "telecommunication")], ["it services"]),
  t("consulting", "Consultants", "professional", [office("consulting")], ["consultant"]),
  t("recruitment", "Staffing & recruitment", "professional", [office("employment_agency")], ["staffing agency"]),
  t("coworking", "Coworking spaces", "professional", [office("coworking"), amenity("coworking_space")], ["coworking space"]),
  t("printing", "Printing & copy shops", "professional", [shop("copyshop"), craft("printer")], ["print shop"]),
  t("photographer", "Photographers & studios", "professional", [craft("photographer"), shop("photo_studio")], ["photographer"]),

  // Trades & home services
  t("plumber", "Plumbers", "trades", [craft("plumber")], ["plumber"]),
  t("electrician", "Electricians", "trades", [craft("electrician")], ["electrician"]),
  t("hvac", "HVAC & heating", "trades", [craft("hvac", "heating_engineer")], ["hvac contractor"]),
  t("roofer", "Roofers", "trades", [craft("roofer")], ["roofing contractor"]),
  t("builder", "Builders & contractors", "trades", [craft("builder", "carpenter", "joiner"), office("construction_company")], ["general contractor"]),
  t("painter", "Painters & decorators", "trades", [craft("painter", "plasterer", "tiler", "floorer")], ["painting contractor"]),
  t("landscaping", "Landscaping & gardening", "trades", [craft("gardener", "landscaper")], ["landscaping company"]),
  t("locksmith", "Locksmiths", "trades", [craft("locksmith"), shop("locksmith")], ["locksmith"]),
  t("cleaning", "Cleaning, laundry & dry cleaning", "trades", [shop("laundry", "dry_cleaning"), craft("cleaning")], ["dry cleaner", "cleaning service"]),
  t("tailor", "Tailors & shoe repair", "trades", [craft("tailor", "shoemaker", "dressmaker"), shop("tailor", "shoe_repair")], ["tailor"]),
  t("metalwork", "Metalwork, glass & stone", "trades", [craft("metal_construction", "welder", "glaziery", "window_construction", "stonemason")], ["welding shop"]),
  t("repair", "Electronics & appliance repair", "trades", [craft("electronics_repair", "computer_repair"), shop("repair")], ["phone repair"]),
  // Home-service trades (Oct 2026 audit brief): owner-run, local, and they live on Google Maps.
  t("garage_door", "Garage door repair", "trades", [], ["garage door repair"], ["garage door", "overhead door"]),
  t("concrete", "Concrete & flatwork", "trades", [], ["concrete contractor"], ["concrete", "flatwork", "cement"]),
  t("fencing", "Fencing", "trades", [], ["fence contractor"], ["fence", "fencing"]),
  t("tree_service", "Tree service", "trades", [], ["tree service"], ["tree service", "tree care", "arborist", "stump"]),
  t("irrigation", "Sprinkler & irrigation repair", "trades", [], ["sprinkler repair", "irrigation contractor"], ["sprinkler", "irrigation"]),
  t("pest_control", "Pest control", "trades", [craft("pest_control"), shop("pest_control")], ["pest control service"], ["pest", "exterminat", "termite"]),
  t("window_cleaning", "Window cleaning & pressure washing", "trades", [], ["window cleaning service", "pressure washing service"], ["window clean", "pressure wash", "power wash", "soft wash"]),
  t("gutters", "Gutters", "trades", [], ["gutter installation"], ["gutter"]),
  t("handyman", "Handyman", "trades", [craft("handyman")], ["handyman"], ["handyman", "handy man"]),
  t("junk_removal", "Junk removal", "trades", [], ["junk removal service"], ["junk", "haul away", "hauling"]),
  t("epoxy_floors", "Epoxy floor coatings", "trades", [], ["epoxy flooring contractor"], ["epoxy", "garage floor"]),
  t("carpet_cleaning", "Carpet & upholstery cleaning", "trades", [craft("carpet_cleaner")], ["carpet cleaning service", "upholstery cleaning"], ["carpet", "upholstery"]),
  t("septic", "Septic & excavation", "trades", [], ["septic service", "excavation contractor"], ["septic", "excavat"]),
  // Rochester, MN calls (Oct 28 2026): trades that were filed as plumbers or builders.
  t("waterproofing", "Basement waterproofing", "trades", [], ["basement waterproofing"], ["waterproof", "basement", "foundation repair", "mudjack"]),
  t("deck_builder", "Deck builders", "trades", [], ["deck builder"], ["deck", "decks", "patio cover", "pergola"]),
  t("remodeling", "Remodeling", "trades", [], ["remodeling contractor", "kitchen remodeler", "bathroom remodeler"], ["remodel", "renovation", "kitchen and bath"]),

  // Hotels & travel
  t("hotel", "Hotels & motels", "hospitality", [tourism("hotel", "motel")], ["hotel"]),
  t("guest_house", "B&Bs & guest houses", "hospitality", [tourism("guest_house", "bed_and_breakfast", "hostel")], ["bed and breakfast"]),
  t("vacation_rental", "Vacation rentals & campsites", "hospitality", [tourism("apartment", "chalet", "camp_site", "caravan_site")], ["vacation rental"]),
  t("travel_agency", "Travel agencies & tours", "hospitality", [shop("travel_agency"), office("travel_agent"), tourism("information")], ["travel agency", "tour operator"]),

  // Education & childcare
  t("driving_school", "Driving schools", "education", [amenity("driving_school")], ["driving school"]),
  t("language_school", "Language schools", "education", [amenity("language_school")], ["language school"]),
  t("music_school", "Music & art schools", "education", [amenity("music_school", "art_school")], ["music school"]),
  t("tutoring", "Tutoring & test prep", "education", [amenity("prep_school"), office("tutoring")], ["tutoring center"], ["tutor"]),
  t("childcare", "Childcare & preschools", "education", [amenity("childcare", "kindergarten")], ["daycare"]),

  // Pets
  t("pet_store", "Pet stores", "pets", [shop("pet")], ["pet store"]),
  t("pet_grooming", "Pet grooming", "pets", [shop("pet_grooming")], ["dog groomer"], ["groom"]),
  t("pet_boarding", "Pet boarding & training", "pets", [amenity("animal_boarding", "animal_training")], ["dog boarding", "dog trainer"]),

  // Entertainment & events
  t("nightclub", "Nightclubs & lounges", "entertainment", [amenity("nightclub", "stripclub")], ["nightclub"]),
  t("event_venue", "Event venues", "entertainment", [amenity("events_venue", "conference_centre")], ["event venue", "wedding venue"]),
  t("bowling", "Bowling, arcades & escape rooms", "entertainment", [leisure("bowling_alley", "amusement_arcade", "escape_game", "trampoline_park")], [
    "bowling alley",
    "escape room",
  ]),
  t("theatre", "Theatres & music venues", "entertainment", [amenity("theatre", "music_venue")], ["theater"]),
  t("karaoke", "Karaoke & gaming lounges", "entertainment", [amenity("karaoke_box"), leisure("adult_gaming_centre")], ["karaoke bar"]),
];

// Google Places types (https://developers.google.com/maps/documentation/places/web-service/place-types)
// that confirm a place really is this type. Google has no type for many trades (pawn shops, motorcycle
// dealers, landscapers…): those are confirmed by name only, see lib/discovery/match.ts.
const GOOGLE_TYPES: Record<string, string[]> = {
  restaurant: ["restaurant"],
  cafe: ["cafe", "coffee_shop", "tea_house", "cat_cafe"],
  bar: ["bar", "pub", "wine_bar", "cocktail_bar", "sports_bar", "bar_and_grill"],
  fast_food: ["fast_food_restaurant", "meal_takeaway", "sandwich_shop", "hamburger_restaurant", "pizza_restaurant"],
  bakery: ["bakery", "confectionery", "chocolate_shop", "donut_shop", "candy_store"],
  ice_cream: ["ice_cream_shop", "dessert_shop", "dessert_restaurant", "juice_shop"],
  butcher: ["butcher_shop", "deli"],
  grocery: ["grocery_store", "convenience_store", "supermarket", "health_food_store", "asian_grocery_store", "food_store", "market"],
  liquor: ["liquor_store"],
  brewery: ["brewery", "winery", "distillery"],
  caterer: ["catering_service"],
  dentist: ["dentist", "dental_clinic"],
  doctor: ["doctor", "medical_clinic", "medical_center"],
  pharmacy: ["pharmacy", "drugstore"],
  physio: ["physiotherapist"],
  chiropractor: ["chiropractor"],
  veterinary: ["veterinary_care"],
  hair_salon: ["hair_salon", "hair_care"],
  barber: ["barber_shop"],
  beauty_salon: ["beauty_salon"],
  nail_salon: ["nail_salon"],
  spa: ["spa", "massage", "sauna", "wellness_center", "massage_spa"],
  tanning: ["tanning_studio"],
  cosmetics: ["cosmetics_store", "perfume_store"],
  gym: ["gym", "fitness_center"],
  yoga: ["yoga_studio", "pilates_studio"],
  sports_centre: ["sports_club", "sports_complex", "sports_activity_location"],
  golf: ["golf_course"],
  clothing: ["clothing_store", "womens_clothing_store"],
  shoes: ["shoe_store"],
  jewelry: ["jewelry_store"],
  electronics: ["electronics_store", "cell_phone_store"],
  books: ["book_store"],
  gifts: ["gift_shop"],
  toys: ["toy_store"],
  sports_shop: ["sporting_goods_store", "sportswear_store"],
  bicycle: ["bicycle_store"],
  second_hand: ["thrift_store", "flea_market"],
  variety: ["discount_store", "general_store", "department_store", "warehouse_store"],
  furniture: ["furniture_store"],
  interior: ["interior_designer"],
  garden_centre: ["garden_center"],
  florist: ["florist"],
  hardware: ["hardware_store", "home_improvement_store", "building_materials_store"],
  car_dealer: ["car_dealer", "truck_dealer"],
  car_repair: ["car_repair"],
  tyres: ["tire_shop", "auto_parts_store"],
  car_wash: ["car_wash"],
  car_rental: ["car_rental"],
  lawyer: ["lawyer"],
  accountant: ["accounting"],
  real_estate: ["real_estate_agency"],
  insurance: ["insurance_agency"],
  plumber: ["plumber"],
  electrician: ["electrician"],
  roofer: ["roofing_contractor"],
  builder: ["general_contractor"],
  painter: ["painter"],
  locksmith: ["locksmith"],
  cleaning: ["laundry"],
  photographer: ["photographer"],
  hotel: ["hotel", "motel", "resort_hotel", "extended_stay_hotel"],
  guest_house: ["bed_and_breakfast", "guest_house", "hostel", "inn"],
  vacation_rental: ["campground", "rv_park", "cottage", "camping_cabin"],
  travel_agency: ["travel_agency", "tour_agency"],
  childcare: ["child_care_agency", "preschool"],
  pet_store: ["pet_store"],
  pet_boarding: ["pet_boarding_service"],
  nightclub: ["night_club"],
  event_venue: ["event_venue", "wedding_venue", "banquet_hall"],
  bowling: ["bowling_alley", "amusement_center", "video_arcade"],
  theatre: ["performing_arts_theater", "concert_hall"],
  karaoke: ["karaoke"],
};
for (const x of BUSINESS_TYPES) x.gtypes = GOOGLE_TYPES[x.id];

const TYPE_BY_ID = new Map(BUSINESS_TYPES.map((x) => [x.id, x]));
export const typeById = (id: string) => TYPE_BY_ID.get(id);
export const groupLabel = (id: string) => GROUPS.find((g) => g.id === id)?.label ?? id;

// Searches created before the catalog existed used these broad ids.
const LEGACY: Record<string, string> = {
  food: "group:food",
  health: "group:health",
  beauty: "group:beauty",
  fitness: "group:fitness",
  retail: "group:retail",
  fashion: "group:retail",
  home: "group:home",
  professional: "group:professional",
  trades: "group:trades",
  auto: "group:auto",
  hospitality: "group:hospitality",
  education: "group:education",
};

// Name searches are split per key so Overpass can use its tag index (a key-regex filter can't).
const COMMERCIAL_KEYS = ["shop", "amenity", "office", "craft", "healthcare", "leisure", "tourism"];
const nameFilters = (keywords: string[], keys = COMMERCIAL_KEYS) =>
  keys.map((key) => `["${key}"]["name"~"${q(keywords.map(escapeRegex).join("|"))}",i]`);
const KEY_RE = /^[a-z][a-z0-9_:]{0,40}$/i;
const VALUE_RE = /^[a-z0-9 _.\-:]{1,60}$/i;

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function osmFilter(m: OsmMatch): string {
  return m.values?.length ? `["${m.key}"~"^(${m.values.map(escapeRegex).join("|")})$"]` : `["${m.key}"]["${m.key}"!~"^(no|vacant)$"]`;
}

export function typesFor(token: string): BizType[] {
  const tok = LEGACY[token] ?? token;
  if (tok === "all") return BUSINESS_TYPES;
  if (tok.startsWith("group:")) return BUSINESS_TYPES.filter((x) => x.group === tok.slice(6));
  const one = typeById(tok);
  return one ? [one] : [];
}

/** Parse "tag:key=value" / "tag:key". */
export function parseTagToken(token: string): OsmMatch | null {
  const body = token.slice(4).trim();
  const [key, value] = body.split("=").map((s) => s?.trim());
  if (!key || !KEY_RE.test(key)) return null;
  if (value !== undefined && value !== "" && !VALUE_RE.test(value)) return null;
  return value ? { key, values: [value] } : { key };
}

export function isValidToken(token: string): boolean {
  if (token.startsWith("kw:")) {
    const kw = token.slice(3).trim();
    return kw.length >= 2 && kw.length <= 60;
  }
  if (token.startsWith("tag:")) return parseTagToken(token) !== null;
  return typesFor(token).length > 0;
}

/** Overpass tag filters for a selection (deduplicated). */
export function osmFiltersFor(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const token of tokens) {
    if (token.startsWith("kw:")) {
      nameFilters([token.slice(3).trim()]).forEach((f) => out.add(f));
      continue;
    }
    if (token.startsWith("tag:")) {
      const m = parseTagToken(token);
      if (m) out.add(osmFilter(m));
      continue;
    }
    const tok = LEGACY[token] ?? token;
    if (tok === "all") {
      // Every shop, office, craft and healthcare business, plus the catalog's amenity/leisure/tourism/sport types.
      const broad = ["shop", "office", "craft", "healthcare"];
      broad.forEach((key) => out.add(osmFilter({ key })));
      BUSINESS_TYPES.forEach((type) => type.osm.filter((m) => !broad.includes(m.key)).forEach((m) => out.add(osmFilter(m))));
      continue;
    }
    for (const type of typesFor(tok)) {
      type.osm.forEach((m) => out.add(osmFilter(m)));
      // Catalog keywords only need the keys that type's businesses actually use.
      if (type.names?.length) {
        const keys = [...new Set(type.osm.map((m) => m.key).filter((k) => COMMERCIAL_KEYS.includes(k)))];
        nameFilters(type.names, keys.length ? keys : COMMERCIAL_KEYS).forEach((f) => out.add(f));
      }
    }
  }
  return [...out];
}

/** Google Places text queries for a selection. */
/**
 * Google queries for a selection: every English term first, then (in non-English countries) the
 * local-language term for each type. Custom keywords are used as typed.
 */
export function googleQueriesFor(tokens: string[], countryCode: string | null): { text: string; lang: Lang | null; type: string | null }[] {
  const lang = localLang(countryCode);
  const out = new Map<string, { text: string; lang: Lang | null; type: string | null }>();
  // The catalog type each query came from, so leads are filed under what we searched for.
  for (const token of tokens) {
    if (token.startsWith("kw:") || token.startsWith("tag:")) {
      for (const term of googleTermsFor([token])) if (!out.has(term.toLowerCase())) out.set(term.toLowerCase(), { text: term, lang: null, type: null });
      continue;
    }
    for (const type of typesFor(token))
      for (const term of type.google) if (!out.has(term.toLowerCase())) out.set(term.toLowerCase(), { text: term, lang: null, type: type.label });
  }
  if (lang)
    for (const token of tokens)
      for (const type of typesFor(token)) {
        const local = localTerm(type.id, lang);
        if (local && !out.has(local.toLowerCase())) out.set(local.toLowerCase(), { text: local, lang, type: type.label });
      }
  return [...out.values()];
}

export function googleTermsFor(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const token of tokens) {
    if (token.startsWith("kw:")) out.add(token.slice(3).trim());
    else if (token.startsWith("tag:")) {
      const m = parseTagToken(token);
      if (m?.values?.[0]) out.add(m.values[0].replace(/[_-]/g, " "));
    } else for (const type of typesFor(token)) type.google.forEach((g) => out.add(g));
  }
  return [...out];
}

const GENERIC_KEYS = new Set(["shop", "amenity", "craft", "office", "healthcare", "leisure", "tourism"]);
const SPECIFIC_FIRST = [
  ...BUSINESS_TYPES.flatMap((x) => x.osm.filter((m) => !GENERIC_KEYS.has(m.key)).map((m) => [x, m] as const)),
  ...BUSINESS_TYPES.flatMap((x) => x.osm.filter((m) => GENERIC_KEYS.has(m.key)).map((m) => [x, m] as const)),
];

/** Human label for an OSM element's tags, e.g. shop=tobacco → "Smoke shops & tobacconists". */
export function labelForTags(tags: Record<string, string>): string | null {
  const name = tags.name ?? "";
  const nameMatches = (type: BizType) => !!type.names?.length && new RegExp(type.names.map(escapeRegex).join("|"), "i").test(name);
  let match: BizType | null = null;
  for (const [type, m] of SPECIFIC_FIRST) {
    const v = tags[m.key];
    if (v && (!m.values || m.values.includes(v))) {
      match = type;
      break;
    }
  }
  if (match) {
    // Refine within the same industry (a hairdresser named "… Barber" is a barbershop),
    // never across industries ("Smoke BBQ" stays a restaurant).
    const refined = BUSINESS_TYPES.find((x) => x !== match && x.group === match!.group && nameMatches(x));
    return (refined ?? match).label;
  }
  for (const type of BUSINESS_TYPES) if (nameMatches(type)) return type.label;
  for (const key of ["shop", "amenity", "craft", "office", "healthcare", "leisure", "tourism"]) {
    const v = tags[key];
    if (v && v !== "yes") return v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
  return Object.keys(tags).some((k) => GENERIC_KEYS.has(k)) ? "Other business" : null;
}

/** Short description of a selection for search labels and lists. */
export function describeSelection(tokens: string[]): string {
  return tokens
    .map((token) => {
      const tok = LEGACY[token] ?? token;
      if (tok === "all") return "All businesses";
      if (tok.startsWith("group:")) return groupLabel(tok.slice(6));
      if (tok.startsWith("kw:")) return `name contains “${tok.slice(3)}”`;
      if (tok.startsWith("tag:")) return tok.slice(4);
      return typeById(tok)?.label ?? tok;
    })
    .join(", ");
}
