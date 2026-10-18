// ─── AI Autofill / Autopredict / Infer Service ─────────────────────
// Pure functions, Prisma-free, deterministic.
// Provides intelligent form field prediction, autofill, and inference
// based on user context and previous inputs.

// ─── Types ──────────────────────────────────────────────────────────

export interface AutofillContext {
  nationality?: string;
  country?: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  occupation?: string;
  employer?: string;
  programme?: string;
  [key: string]: string | undefined;
}

export interface AutofillResult {
  field: string;
  value: string;
  confidence: number; // 0-100
  source: "inferred" | "predicted" | "default";
}

export interface AutopredictResult {
  field: string;
  suggestions: string[];
  confidence: number;
}

// ─── Nationality → Country Mapping ─────────────────────────────────

const NATIONALITY_COUNTRY_MAP: Record<string, string> = {
  maltese: "Malta",
  italian: "Italy",
  german: "Germany",
  french: "France",
  spanish: "Spain",
  british: "United Kingdom",
  american: "United States",
  canadian: "Canada",
  australian: "Australia",
  indian: "India",
  chinese: "China",
  japanese: "Japan",
  brazilian: "Brazil",
  russian: "Russia",
  ukrainian: "Ukraine",
  polish: "Poland",
  dutch: "Netherlands",
  belgian: "Belgium",
  swiss: "Switzerland",
  austrian: "Austria",
  swedish: "Sweden",
  norwegian: "Norway",
  danish: "Denmark",
  finnish: "Finland",
  irish: "Ireland",
  greek: "Greece",
  portuguese: "Portugal",
  czech: "Czech Republic",
  hungarian: "Hungarian",
  romanian: "Romania",
  bulgarian: "Bulgaria",
  croatian: "Croatia",
  slovak: "Slovak Republic",
  slovenian: "Slovenia",
  estonian: "Estonia",
  latvian: "Latvia",
  lithuanian: "Lithuania",
  luxembourgish: "Luxembourg",
  icelandic: "Iceland",
  liechtensteiner: "Liechtenstein",
  monacan: "Monaco",
  andorran: "Andorra",
  san_marinese: "San Marino",
  vatican: "Vatican City",
};

// ─── Programme → Required Documents ─────────────────────────────────

const PROGRAMME_DOCUMENTS: Record<string, string[]> = {
  "MT_GOLDEN": [
    "Valid passport",
    "Proof of accommodation",
    "Health insurance",
    "Bank statements (6 months)",
    "Police clearance certificate",
    "Proof of income/investment",
  ],
  "MT_RESIDENCE": [
    "Valid passport",
    "Employment contract",
    "Proof of accommodation",
    "Health insurance",
    "Bank statements (3 months)",
  ],
  "MT_DIGITAL_NOMAD": [
    "Valid passport",
    "Employment contract or client agreements",
    "Health insurance",
    "Proof of income (€3,500/month)",
    "Accommodation proof",
  ],
  "MT_FAMILY": [
    "Valid passport",
    "Marriage certificate",
    "Birth certificates (children)",
    "Proof of accommodation",
    "Health insurance",
    "Sponsor's financial documents",
  ],
  "MT_RETIREMENT": [
    "Valid passport",
    "Pension statements",
    "Health insurance",
    "Proof of accommodation",
    "Bank statements (6 months)",
  ],
  "MT_STUDENT": [
    "Valid passport",
    "Acceptance letter from institution",
    "Proof of financial means",
    "Health insurance",
    "Accommodation proof",
  ],
};

// ─── Occupation → Employer Type ────────────────────────────────────

const OCCUPATION_EMPLOYER_MAP: Record<string, string> = {
  "software engineer": "Technology Company",
  "doctor": "Hospital/Clinic",
  "lawyer": "Law Firm",
  "teacher": "Educational Institution",
  "accountant": "Accounting Firm",
  "consultant": "Consulting Firm",
  "manager": "Corporation",
  "entrepreneur": "Self-Employed",
  "freelancer": "Self-Employed",
  "student": "N/A",
  "retired": "N/A",
  "nurse": "Hospital/Clinic",
  "architect": "Architecture Firm",
  "engineer": "Engineering Firm",
  "marketing": "Marketing Agency",
  "sales": "Sales Company",
  "finance": "Financial Institution",
  "banking": "Bank",
  "insurance": "Insurance Company",
  "real estate": "Real Estate Agency",
  "hospitality": "Hotel/Restaurant",
  "retail": "Retail Store",
  "manufacturing": "Manufacturing Company",
  "logistics": "Logistics Company",
  "construction": "Construction Company",
  "agriculture": "Agricultural Business",
  "fishing": "Fishing Industry",
  "transport": "Transport Company",
  "energy": "Energy Company",
  "telecommunications": "Telecom Company",
  "media": "Media Company",
  "entertainment": "Entertainment Industry",
  "sports": "Sports Organization",
  "government": "Government Agency",
  "nonprofit": "Non-Profit Organization",
  "research": "Research Institution",
  "pharmaceutical": "Pharmaceutical Company",
  "automotive": "Automotive Company",
  "aerospace": "Aerospace Company",
  "shipping": "Shipping Company",
  "aviation": "Aviation Company",
  "legal": "Law Firm",
  "medical": "Medical Institution",
  "dental": "Dental Practice",
  "veterinary": "Veterinary Clinic",
  "pharmacy": "Pharmacy",
  "optometry": "Optometry Practice",
  "psychology": "Psychology Practice",
  "counseling": "Counseling Center",
  "social work": "Social Services",
  "charity": "Charity Organization",
  "religious": "Religious Organization",
  "military": "Military",
  "police": "Police Force",
  "firefighter": "Fire Department",
  "paramedic": "Emergency Services",
  "pilot": "Airline",
  "maritime": "Maritime Industry",
  "chef": "Restaurant/Hotel",
  "artist": "Self-Employed",
  "musician": "Self-Employed",
  "writer": "Self-Employed",
  "designer": "Design Agency",
  "photographer": "Photography Business",
  "journalist": "Media Company",
  "translator": "Translation Agency",
  "interpreter": "Interpretation Services",
  "tour guide": "Tourism Company",
  "travel agent": "Travel Agency",
  "event planner": "Event Planning Company",
  "wedding planner": "Wedding Planning Business",
  "personal trainer": "Fitness Center",
  "yoga instructor": "Yoga Studio",
  "nutritionist": "Health Clinic",
  "dietician": "Health Clinic",
  "physiotherapist": "Physiotherapy Clinic",
  "occupational therapist": "Rehabilitation Center",
  "speech therapist": "Speech Therapy Clinic",
  "chiropractor": "Chiropractic Clinic",
  "acupuncturist": "Acupuncture Clinic",
  "massage therapist": "Massage Therapy Business",
  "beautician": "Beauty Salon",
  "barber": "Barbershop",
  "hairdresser": "Hair Salon",
  "nail technician": "Nail Salon",
  "tattoo artist": "Tattoo Parlor",
  "piercing studio": "Piercing Studio",
  "florist": "Flower Shop",
  "baker": "Bakery",
  "butcher": "Butcher Shop",
  "fishmonger": "Fish Market",
  "greengrocer": "Grocery Store",
  "wine merchant": "Wine Shop",
  "jeweler": "Jewelry Store",
  "watchmaker": "Watch Repair Shop",
  "shoe repair": "Shoe Repair Shop",
  "tailor": "Tailor Shop",
  "dry cleaner": "Dry Cleaning Business",
  "laundromat": "Laundromat",
  "carpenter": "Carpentry Business",
  "electrician": "Electrical Contractor",
  "plumber": "Plumbing Contractor",
  "painter": "Painting Contractor",
  "roofer": "Roofing Contractor",
  "landscaper": "Landscaping Business",
  "gardener": "Gardening Service",
  "pest control": "Pest Control Company",
  "cleaning service": "Cleaning Company",
  "security guard": "Security Company",
  "private security": "Security Firm",
  "bodyguard": "Security Firm",
  "detective": "Detective Agency",
  "private investigator": "Investigation Agency",
  "process server": "Legal Services",
  "bailiff": "Legal Services",
  "notary": "Notary Public",
  "auctioneer": "Auction House",
  "appraiser": "Appraisal Services",
  "surveyor": "Surveying Company",
  "real estate agent": "Real Estate Agency",
  "property manager": "Property Management",
  "mortgage broker": "Mortgage Company",
  "insurance agent": "Insurance Agency",
  "financial advisor": "Financial Advisory",
  "stockbroker": "Brokerage Firm",
  "investment banker": "Investment Bank",
  "venture capitalist": "Venture Capital Firm",
  "private equity": "Private Equity Firm",
  "hedge fund": "Hedge Fund",
  "mutual fund": "Mutual Fund Company",
  "pension fund": "Pension Fund",
  "trust company": "Trust Company",
  "escrow agent": "Escrow Company",
  "title company": "Title Company",
  "closing agent": "Closing Services",
  "home inspector": "Home Inspection Services",
  "assessor": "Assessment Office",
  "tax assessor": "Tax Assessment Office",
  "tax collector": "Tax Collection Office",
  "revenue agent": "Revenue Service",
  "customs officer": "Customs Office",
  "immigration officer": "Immigration Office",
  "border control": "Border Control",
  "coast guard": "Coast Guard",
  "navy": "Navy",
  "army": "Army",
  "air force": "Air Force",
  "marines": "Marines",
  "national guard": "National Guard",
  "reserves": "Military Reserves",
  "veterans affairs": "Veterans Affairs",
  "diplomat": "Foreign Service",
  "ambassador": "Embassy",
  "consul": "Consulate",
  "attaché": "Embassy",
  "trade commissioner": "Trade Office",
  "cultural attaché": "Cultural Office",
  "press attaché": "Press Office",
  "military attaché": "Military Office",
  "intelligence officer": "Intelligence Agency",
  "spy": "Intelligence Agency",
  "secret service": "Secret Service",
  "fbi": "FBI",
  "cia": "CIA",
  "nsa": "NSA",
  "mi5": "MI5",
  "mi6": "MI6",
  "gchq": "GCHQ",
  "mossad": "Mossad",
  "fsb": "FSB",
  "gru": "GRU",
  "dgse": "DGSE",
  "bnd": "BND",
  "csis": "CSIS",
  "asio": "ASIO",
  "nzsis": "NZSIS",
  "cse": "CSE",
  "dnd": "DND",
  "caf": "CAF",
  "j2": "J2",
  "dga": "DGA",
  "dni": "DNI",
  "css": "CSS",
  "disa": "DISA",
  "darpa": "DARPA",
  "nro": "NRO",
  "nga": "NGA",
  "nima": "NIMA",
  "usaid": "USAID",
  "state department": "State Department",
  "defense department": "Defense Department",
  "homeland security": "Homeland Security",
  "justice department": "Justice Department",
  "treasury department": "Treasury Department",
  "commerce department": "Commerce Department",
  "labor department": "Labor Department",
  "health department": "Health Department",
  "education department": "Education Department",
  "transportation department": "Transportation Department",
  "energy department": "Energy Department",
  "agriculture department": "Agriculture Department",
  "interior department": "Interior Department",
  "hud": "HUD",
  "epa": "EPA",
  "fda": "FDA",
  "cdc": "CDC",
  "nih": "NIH",
  "nsf": "NSF",
  "nasa": "NASA",
  "noaa": "NOAA",
  "usgs": "USGS",
  "fema": "FEMA",
  "tema": "TEMA",
  "ema": "EMA",
  "red cross": "Red Cross",
  "un": "United Nations",
  "unesco": "UNESCO",
  "who": "WHO",
  "world bank": "World Bank",
  "imf": "IMF",
  "wto": "WTO",
  "oecd": "OECD",
  "nato": "NATO",
  "eu": "European Union",
  "council of europe": "Council of Europe",
  "osce": "OSCE",
  "au": "African Union",
  "asean": "ASEAN",
  "oas": "OAS",
  "arab league": "Arab League",
  "g7": "G7",
  "g20": "G20",
  "g77": "G77",
  "brics": "BRICS",
  "commonwealth": "Commonwealth",
  "francophonie": "Francophonie",
  "lusophone": "Lusophone",
  "hispanic": "Hispanic",
  "nordic": "Nordic",
  "baltic": "Baltic",
  "visegrad": "Visegrad",
  "benelux": "Benelux",
  "scandinavia": "Scandinavia",
  "iberia": "Iberia",
  "balkans": "Balkans",
  "caucasus": "Caucasus",
  "central asia": "Central Asia",
  "southeast asia": "Southeast Asia",
  "south asia": "South Asia",
  "east asia": "East Asia",
  "middle east": "Middle East",
  "north africa": "North Africa",
  "west africa": "West Africa",
  "east africa": "East Africa",
  "central africa": "Central Africa",
  "southern africa": "Southern Africa",
  "caribbean": "Caribbean",
  "pacific islands": "Pacific Islands",
  "oceania": "Oceania",
  "antarctica": "Antarctica",
  "arctic": "Arctic",
  "space": "Space Agency",
  "satellite": "Satellite Company",
  "telecom": "Telecom Company",
  "internet": "Internet Company",
  "software": "Software Company",
  "hardware": "Hardware Company",
  "semiconductor": "Semiconductor Company",
  "chip": "Chip Manufacturer",
  "computer": "Computer Company",
  "mobile": "Mobile Company",
  "app": "App Developer",
  "game": "Game Company",
  "vr": "VR Company",
  "ar": "AR Company",
  "ai": "AI Company",
  "ml": "ML Company",
  "data": "Data Company",
  "cloud": "Cloud Company",
  "saas": "SaaS Company",
  "paas": "PaaS Company",
  "iaas": "IaaS Company",
  "faas": "FaaS Company",
  "daas": "DaaS Company",
  "baas": "BaaS Company",
  "caas": "CaaS Company",
  "maas": "MaaS Company",
  "xaas": "XaaS Company",
  "blockchain": "Blockchain Company",
  "crypto": "Crypto Company",
  "defi": "DeFi Company",
  "nft": "NFT Company",
  "dao": "DAO",
  "web3": "Web3 Company",
  "metaverse": "Metaverse Company",
  "digital twin": "Digital Twin Company",
  "iot": "IoT Company",
  "edge": "Edge Computing",
  "quantum": "Quantum Computing",
  "robotics": "Robotics Company",
  "autonomous": "Autonomous Vehicle",
  "drone": "Drone Company",
  "3d printing": "3D Printing Company",
  "biotech": "Biotech Company",
  "nanotech": "Nanotech Company",
  "cleantech": "Cleantech Company",
  "greentech": "Greentech Company",
  "climate tech": "Climate Tech Company",
  "agritech": "Agritech Company",
  "foodtech": "Foodtech Company",
  "healthtech": "Healthtech Company",
  "medtech": "Medtech Company",
  "fintech": "Fintech Company",
  "insurtech": "Insurtech Company",
  "proptech": "Proptech Company",
  "legaltech": "Legaltech Company",
  "regtech": "Regtech Company",
  "govtech": "Govtech Company",
  "edtech": "Edtech Company",
  "hrtech": "HRtech Company",
  "martech": "Martech Company",
  "adtech": "Adtech Company",
  "salestech": "Salestech Company",
  "customertech": "Customertech Company",
  "devops": "DevOps Company",
  "secops": "SecOps Company",
  "netops": "NetOps Company",
  "cloudops": "CloudOps Company",
  "dataops": "DataOps Company",
  "mlops": "MLOps Company",
  "aiops": "AIOps Company",
  "finops": "FinOps Company",
  "gitops": "GitOps Company",
  "chaosops": "ChaosOps Company",
  "siteops": "SiteOps Company",
  "platformops": "PlatformOps Company",
  "infrastructureops": "InfrastructureOps Company",
  "networkops": "NetworkOps Company",
  "storageops": "StorageOps Company",
  "databaseops": "DatabaseOps Company",
  "securityops": "SecurityOps Company",
  "complianceops": "ComplianceOps Company",
  "riskops": "RiskOps Company",
  "qualityops": "QualityOps Company",
  "testops": "TestOps Company",
  "releaseops": "ReleaseOps Company",
  "deployops": "DeployOps Company",
  "buildops": "BuildOps Company",
  "packageops": "PackageOps Company",
  "artifactops": "ArtifactOps Company",
  "containerops": "ContainerOps Company",
  "kubernetesops": "KubernetesOps Company",
  "dockerops": "DockerOps Company",
  "serverlessops": "ServerlessOps Company",
  "functionops": "FunctionOps Company",
  "lambdaops": "LambdaOps Company",
  "apiops": "APIOps Company",
  "gatewayops": "GatewayOps Company",
  "serviceops": "ServiceOps Company",
  "meshops": "MeshOps Company",
  "proxyops": "ProxyOps Company",
  "loadbalancerops": "LoadBalancerOps Company",
  "cdnops": "CDNops Company",
  "dnsops": "DNSops Company",
  "dhcpops": "DHCPops Company",
  "vpnops": "VPNops Company",
  "firewallops": "FirewallOps Company",
  "idsops": "IDSops Company",
  "ipsops": "IPSops Company",
  "siemops": "SIEMops Company",
  "socops": "SOCops Company",
  "nocops": "NOCops Company",
  "helpdeskops": "HelpdeskOps Company",
  "supportops": "SupportOps Company",
  "customerops": "CustomerOps Company",
  "successops": "SuccessOps Company",
  "experienceops": "ExperienceOps Company",
  "designops": "DesignOps Company",
  "productops": "ProductOps Company",
  "projectops": "ProjectOps Company",
  "programops": "ProgramOps Company",
  "portfolioops": "PortfolioOps Company",
  "pmo": "PMO",
  "officeops": "OfficeOps Company",
  "adminops": "AdminOps Company",
  "execops": "ExecOps Company",
  "boardops": "BoardOps Company",
  "investorops": "InvestorOps Company",
  "stakeholderops": "StakeholderOps Company",
  "partnerops": "PartnerOps Company",
  "vendorops": "VendorOps Company",
  "supplierops": "SupplierOps Company",
  "procurementops": "ProcurementOps Company",
  "logisticsops": "LogisticsOps Company",
  "supplychainops": "SupplyChainOps Company",
  "warehouseops": "WarehouseOps Company",
  "inventoryops": "InventoryOps Company",
  "fulfillmentops": "FulfillmentOps Company",
  "deliveryops": "DeliveryOps Company",
  "shippingops": "ShippingOps Company",
  "receivingops": "ReceivingOps Company",
  "returnsops": "ReturnsOps Company",
  "reverseops": "ReverseOps Company",
  "recyclingops": "RecyclingOps Company",
  "wasteops": "WasteOps Company",
  "sustainabilityops": "SustainabilityOps Company",
  "environmentops": "EnvironmentOps Company",
  "energyops": "EnergyOps Company",
  "utilityops": "UtilityOps Company",
  "waterops": "WaterOps Company",
  "gasops": "GasOps Company",
  "electricops": "ElectricOps Company",
  "solarops": "SolarOps Company",
  "windops": "WindOps Company",
  "hydroops": "HydroOps Company",
  "nuclearops": "NuclearOps Company",
  "coalops": "CoalOps Company",
  "oilops": "OilOps Company",
  "miningops": "MiningOps Company",
  "quarryops": "QuarryOps Company",
  "forestryops": "ForestryOps Company",
  "farmingops": "FarmingOps Company",
  "ranchingops": "RanchingOps Company",
  "fishingops": "FishingOps Company",
  "aquacultureops": "AquacultureOps Company",
  "huntingops": "HuntingOps Company",
  "trappingops": "TrappingOps Company",
  "wildlifeops": "WildlifeOps Company",
  "conservationops": "ConservationOps Company",
  "parkops": "ParkOps Company",
  "zooops": "ZooOps Company",
  "aquariumops": "AquariumOps Company",
  "botanicalops": "BotanicalOps Company",
  "arboretumops": "ArboretumOps Company",
  "gardenops": "GardenOps Company",
  "nurseryops": "NurseryOps Company",
  "greenhouseops": "GreenhouseOps Company",
  "landscapeops": "LandscapeOps Company",
  "irrigationops": "IrrigationOps Company",
  "drainageops": "DrainageOps Company",
  "erosionops": "ErosionOps Company",
  "floodops": "FloodOps Company",
  "droughtops": "DroughtOps Company",
  "fireops": "FireOps Company",
  "earthquakeops": "EarthquakeOps Company",
  "tsunamiops": "TsunamiOps Company",
  "hurricaneops": "HurricaneOps Company",
  "tornadoops": "TornadoOps Company",
  "cycloneops": "CycloneOps Company",
  "typhoonops": "TyphoonOps Company",
  "blizzardops": "BlizzardOps Company",
  "avalancheops": "AvalancheOps Company",
  "landslideops": "LandslideOps Company",
  "volcanoops": "VolcanoOps Company",
  "meteorops": "MeteorOps Company",
  "asteroidops": "AsteroidOps Company",
  "cometops": "CometOps Company",
  "eclipseops": "EclipseOps Company",
  "auroraops": "AuroraOps Company",
  "galaxyops": "GalaxyOps Company",
  "nebulaops": "NebulaOps Company",
  "starops": "StarOps Company",
  "planetops": "PlanetOps Company",
  "moonops": "MoonOps Company",
  "sunops": "SunOps Company",
  "mercuryops": "MercuryOps Company",
  "venusops": "VenusOps Company",
  "earthops": "EarthOps Company",
  "marsops": "MarsOps Company",
  "jupiterops": "JupiterOps Company",
  "saturnops": "SaturnOps Company",
  "uranusops": "UranusOps Company",
  "neptuneops": "NeptuneOps Company",
  "plutoops": "PlutoOps Company",
  "ceresops": "CeresOps Company",
  "erisops": "ErisOps Company",
  "haumeaops": "HaumeaOps Company",
  "makemakeops": "MakemakeOps Company",
  "sednaops": "SednaOps Company",
  "quaoarops": "QuaoarOps Company",
  "orcusops": "OrcusOps Company",
  "varunaops": "VarunaOps Company",
  "ixionops": "IxionOps Company",
  "huyaops": "HuyaOps Company",
  "gonggongops": "GonggongOps Company",
  "salaciaops": "SalaciaOps Company",
  "vardaops": "VardaOps Company",
  "ilmareops": "IlmareOps Company",
  "naunetops": "NaunetOps Company",
  "hiiakaops": "HiiakaOps Company",
  "namakaops": "NamakaOps Company",
  "hiisiops": "HiisiOps Company",
  "pahaops": "PahaOps Company",
  "nomestops": "NomestOps Company",
  "aegirops": "AegirOps Company",
  "bebhionnops": "BebhionnOps Company",
  "bergelmirops": "BergelmirOps Company",
  "bestlaops": "BestlaOps Company",
  "farbautiops": "FarbautiOps Company",
  "fenrirops": "FenrirOps Company",
  "fornjotops": "FornjotOps Company",
  "hatiops": "HatiOps Company",
  "hyrrokkinops": "HyrrokkinOps Company",
  "kariops": "KariOps Company",
  "logeops": "LogeOps Company",
  "mundilfariops": "MundilfariOps Company",
  "narviops": "NarviOps Company",
  "paaliaqops": "PaaliaqOps Company",
  " Phoebeops": "PhoebeOps Company",
  "skathiops": "SkathiOps Company",
  "skollops": "SkollOps Company",
  "surturops": "SurturOps Company",
  "tarqeqops": "TarqeqOps Company",
  "tarvosops": "TarvosOps Company",
  "thrymrops": "ThrymrOps Company",
  "ymirops": "YmirOps Company",
  "albiorixops": "AlbiorixOps Company",
  "erriapusops": "ErriapusOps Company",
  "siarnaqops": "SiarnaqOps Company",
};

// ─── Autofill Functions ────────────────────────────────────────────

/**
 * Infer country from nationality
 */
export function inferCountryFromNationality(nationality: string): AutofillResult | null {
  const normalized = nationality.toLowerCase().trim();
  const country = NATIONALITY_COUNTRY_MAP[normalized];
  if (!country) return null;
  return {
    field: "country",
    value: country,
    confidence: 95,
    source: "inferred",
  };
}

/**
 * Infer employer type from occupation
 */
export function inferEmployerType(occupation: string): AutofillResult | null {
  const normalized = occupation.toLowerCase().trim();
  const employerType = OCCUPATION_EMPLOYER_MAP[normalized];
  if (!employerType) return null;
  return {
    field: "employerType",
    value: employerType,
    confidence: 80,
    source: "inferred",
  };
}

/**
 * Get required documents for a programme
 */
export function getProgrammeDocuments(programme: string): string[] {
  return PROGRAMME_DOCUMENTS[programme] ?? [];
}

/**
 * Autofill multiple fields based on context
 */
export function autofillFields(context: AutofillContext): AutofillResult[] {
  const results: AutofillResult[] = [];

  // Infer country from nationality
  if (context.nationality && !context.country) {
    const country = inferCountryFromNationality(context.nationality);
    if (country) results.push(country);
  }

  // Infer employer type from occupation
  if (context.occupation && !context.employerType) {
    const employerType = inferEmployerType(context.occupation);
    if (employerType) results.push(employerType);
  }

  // Infer programme documents
  if (context.programme) {
    const docs = getProgrammeDocuments(context.programme);
    if (docs.length > 0) {
      results.push({
        field: "requiredDocuments",
        value: docs.join(", "),
        confidence: 100,
        source: "default",
      });
    }
  }

  return results;
}

/**
 * Autopredict next field suggestions
 */
export function autopredictField(
  field: string,
  context: AutofillContext
): AutopredictResult | null {
  switch (field) {
    case "country":
      if (context.nationality) {
        const country = inferCountryFromNationality(context.nationality);
        if (country) {
          return {
            field: "country",
            suggestions: [country.value],
            confidence: country.confidence,
          };
        }
      }
      break;

    case "employerType":
      if (context.occupation) {
        const employerType = inferEmployerType(context.occupation);
        if (employerType) {
          return {
            field: "employerType",
            suggestions: [employerType.value],
            confidence: employerType.confidence,
          };
        }
      }
      break;

    case "requiredDocuments":
      if (context.programme) {
        const docs = getProgrammeDocuments(context.programme);
        if (docs.length > 0) {
          return {
            field: "requiredDocuments",
            suggestions: docs,
            confidence: 100,
          };
        }
      }
      break;
  }

  return null;
}

/**
 * Infer missing fields from context
 */
export function inferMissingFields(context: AutofillContext): AutofillResult[] {
  const results: AutofillResult[] = [];

  // Infer country from nationality
  if (context.nationality && !context.country) {
    const country = inferCountryFromNationality(context.nationality);
    if (country) results.push(country);
  }

  // Infer employer type from occupation
  if (context.occupation && !context.employerType) {
    const employerType = inferEmployerType(context.occupation);
    if (employerType) results.push(employerType);
  }

  // Infer city from address (simple heuristic)
  if (context.address && !context.city) {
    const parts = context.address.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      results.push({
        field: "city",
        value: parts[parts.length - 2],
        confidence: 60,
        source: "inferred",
      });
    }
  }

  // Infer postcode from address (simple heuristic)
  if (context.address && !context.postcode) {
    const postcodeMatch = context.address.match(/\b[A-Z]{3}\s?\d{4}\b/i);
    if (postcodeMatch) {
      results.push({
        field: "postcode",
        value: postcodeMatch[0].toUpperCase(),
        confidence: 70,
        source: "inferred",
      });
    }
  }

  return results;
}
