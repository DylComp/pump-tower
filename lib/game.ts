// Pure game rules: hold-time tiers, citizens, cash and the item catalog.
// Shared by the server route, the canvas renderer and the tests.

/** $PTWR's official mint, live on pump.fun. */
export const HOUSE_MINT: string | null = "5ChT61vPfByx2NApxSNT4iPMTRCV39m5z88bXYcppump";
export const HOUSE_SYMBOL = "PTWR";
export const isHouseMint = (mint: string) => HOUSE_MINT != null && mint === HOUSE_MINT;

/**
 * The Pump Tower treasury: 20% of every launchpad coin's creator fees go here for $PTWR
 * buybacks. Launching also requires the dev wallet to create its address lookup table.
 */
export const TREASURY_WALLET: string | null = "kiNGXkmkJSMPQoFEdUZs68nANK16C1AjyQD2jVPY46C";
/** dlao's vanity dev wallet. Only it can set up the launchpad's address lookup table. */
export const DEV_WALLET: string | null = "KiNgDiSzoX9Z69LoRZh73QkBhJNLqxDbJKgQ2bHmon7";
export const CASH_PER_SOL = 10_000;
/** Launch fee payouts land in the game too: every SOL a pump user is paid is worth this much cash. */
export const rewardCash = (sol: number) => Math.floor(Math.max(0, sol) * CASH_PER_SOL);
/** Every signed-in resident gets a free floor whose clock starts the day they move in. */
export const LOBBY_MINT = "lobby";

const DAY = 86_400_000;

export type TierId = 0 | 1 | 2 | 3 | 4 | 5;

export const TIERS: { id: TierId; key: string; name: string; minDays: number; blurb: string }[] = [
  { id: 0, key: "bare", name: "bare walls", minDays: 0, blurb: "concrete, one bulb, a mattress if you are lucky" },
  { id: 1, key: "studio", name: "studio", minDays: 1, blurb: "paint on the walls and a window that opens" },
  { id: 2, key: "apartment", name: "apartment", minDays: 3, blurb: "wallpaper, a rug, a view of the street" },
  { id: 3, key: "loft", name: "loft", minDays: 7, blurb: "brick, tall glass, plants that survive" },
  { id: 4, key: "suite", name: "suite", minDays: 14, blurb: "dark wood, green neon, carpet you sink into" },
  { id: 5, key: "penthouse", name: "penthouse", minDays: 30, blurb: "glass all round, gold trim, the whole city below" },
];

export function tierFor(heldSince: number | null, now = Date.now()): TierId {
  if (heldSince == null) return 0;
  const days = (now - heldSince) / DAY;
  let t: TierId = 0;
  for (const tier of TIERS) if (days >= tier.minDays) t = tier.id;
  return t;
}

export function daysHeld(heldSince: number | null, now = Date.now()): number {
  return heldSince == null ? 0 : Math.max(0, (now - heldSince) / DAY);
}

/** Milliseconds until the next tier, or null at the penthouse. */
export function msToNextTier(heldSince: number | null, now = Date.now()): number | null {
  const t = tierFor(heldSince, now);
  if (t === 5) return null;
  const start = heldSince ?? now;
  return start + TIERS[t + 1].minDays * DAY - now;
}

export const citizensFor = (tier: TierId) => tier + 1;

/** Floor level: bag size times hold time, so both a big bag and a long hold climb. */
export function floorLevel(usd: number | null | undefined, heldSince: number | null, now = Date.now()): number {
  const days = daysHeld(heldSince, now);
  return Math.max(1, Math.min(99, Math.floor(1 + Math.sqrt(days) * (1 + Math.log10(1 + Math.max(0, usd ?? 0))))));
}

const TIER_RATE = [1, 1.5, 2, 3, 4, 6];
export const BASE_RATE = 2; // cash per citizen per hour on bare walls; a penthouse throne takes days, not minutes
export const HOUSE_BOOST = 3; // the house coin floor earns triple
/** Rent starts on launch day; holds older than this earn from here. */
export const GAME_EPOCH = Date.UTC(2026, 9, 18);

export function floorRate(tier: TierId, isHouse: boolean): number {
  return citizensFor(tier) * BASE_RATE * TIER_RATE[tier] * (isHouse ? HOUSE_BOOST : 1);
}

/**
 * Cash a floor has earned, worked out purely from its hold time: each hour is
 * paid at the rate of the tier the floor was in at that hour. Nothing to store,
 * nothing to fake.
 */
export function floorEarned(heldSince: number | null, isHouse: boolean, now = Date.now(), epoch = GAME_EPOCH): number {
  if (heldSince == null) return 0;
  let total = 0;
  for (const t of TIERS) {
    const segStart = Math.max(heldSince + t.minDays * DAY, epoch);
    const next = TIERS[t.id + 1];
    const segEnd = Math.min(next ? heldSince + next.minDays * DAY : Infinity, now);
    if (segEnd > segStart) total += (floorRate(t.id, isHouse) * (segEnd - segStart)) / 3_600_000;
  }
  return total;
}

export type Floor = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  amount: number;
  usd: number | null;
  heldSince: number | null;
  isHouse: boolean;
  /** 24h price change in percent, from DexScreener. Drives the floor's mood. */
  change24?: number | null;
  mcap?: number | null;
};

export function towerRate(floors: Floor[], now = Date.now()): number {
  return floors.reduce((sum, f) => sum + floorRate(tierFor(f.heldSince, now), f.isHouse), 0);
}

export function towerEarned(floors: Floor[], now = Date.now(), epoch = GAME_EPOCH): number {
  return floors.reduce((sum, f) => sum + floorEarned(f.heldSince, f.isHouse, now, epoch), 0);
}

/** Wallet cash: everything the tower has earned, minus everything bought. */
export function cashOf(floors: Floor[], owned: string[], bonus = 0, now = Date.now(), epoch = GAME_EPOCH): number {
  const spent = owned.reduce((n, id) => n + (itemById(id)?.price ?? 0), 0);
  return Math.max(0, towerEarned(floors, now, epoch) + bonus - spent);
}

export type ItemKind = "furniture" | "pet" | "outfit";
export type Item = { id: string; kind: ItemKind; name: string; price: number; minTier: TierId };

/** Every buyable item, listed cheapest unlock first; ids are permanent (saves keep them). */
export const ITEMS: Item[] = (
  [
  { id: "crate", kind: "furniture", name: "milk crate", price: 20, minTier: 0 },
  { id: "lamp", kind: "furniture", name: "lava lamp", price: 70, minTier: 1 },
  { id: "beanbag", kind: "furniture", name: "beanbag", price: 120, minTier: 1 },
  { id: "plant", kind: "furniture", name: "monstera", price: 180, minTier: 2 },
  { id: "couch", kind: "furniture", name: "green couch", price: 260, minTier: 2 },
  { id: "arcade", kind: "furniture", name: "arcade cabinet", price: 700, minTier: 3 },
  { id: "tank", kind: "furniture", name: "fish tank", price: 900, minTier: 3 },
  { id: "chart", kind: "furniture", name: "candle chart tv", price: 1800, minTier: 4 },
  { id: "piano", kind: "furniture", name: "grand piano", price: 2600, minTier: 4 },
  { id: "throne", kind: "furniture", name: "gold throne", price: 7500, minTier: 5 },
  { id: "chandelier", kind: "furniture", name: "chandelier", price: 12000, minTier: 5 },
  { id: "airdrop", kind: "furniture", name: "airdrop crate", price: 35, minTier: 0 },
  { id: "piggy", kind: "furniture", name: "pump piggy bank", price: 60, minTier: 0 },
  { id: "rugpull", kind: "furniture", name: "pulled rug", price: 90, minTier: 1 },
  { id: "pilllamp", kind: "furniture", name: "pill lamp", price: 150, minTier: 1 },
  { id: "candlecake", kind: "furniture", name: "green candle cake", price: 200, minTier: 1 },
  { id: "curve", kind: "furniture", name: "bonding curve sign", price: 420, minTier: 2 },
  { id: "frogstatue", kind: "furniture", name: "meme frog statue", price: 520, minTier: 2 },
  { id: "portrait", kind: "furniture", name: "laser eyes portrait", price: 650, minTier: 2 },
  { id: "rocket", kind: "furniture", name: "moon rocket", price: 1400, minTier: 3 },
  { id: "safe", kind: "furniture", name: "hodl safe", price: 1100, minTier: 3 },
  { id: "slots", kind: "furniture", name: "degen slots", price: 3200, minTier: 4 },
  { id: "fountain", kind: "furniture", name: "whale fountain", price: 4500, minTier: 4 },
  { id: "diamondcase", kind: "furniture", name: "diamond hands case", price: 16000, minTier: 5 },
  { id: "lambo", kind: "furniture", name: "the lambo", price: 25000, minTier: 5 },

  { id: "rat", kind: "pet", name: "sewer rat", price: 40, minTier: 0 },
  { id: "cat", kind: "pet", name: "alley cat", price: 160, minTier: 1 },
  { id: "dog", kind: "pet", name: "shiba", price: 450, minTier: 2 },
  { id: "frog", kind: "pet", name: "swamp frog", price: 1100, minTier: 3 },
  { id: "ape", kind: "pet", name: "bored ape", price: 3000, minTier: 4 },
  { id: "bull", kind: "pet", name: "golden bull", price: 10000, minTier: 5 },
  { id: "pill", kind: "pet", name: "pump pill", price: 80, minTier: 0 },
  { id: "hamster", kind: "pet", name: "degen hamster", price: 220, minTier: 1 },
  { id: "penguin", kind: "pet", name: "chubby penguin", price: 650, minTier: 2 },
  { id: "spacecat", kind: "pet", name: "space cat", price: 1600, minTier: 3 },
  { id: "whale", kind: "pet", name: "baby whale", price: 5000, minTier: 4 },
  { id: "phoenix", kind: "pet", name: "golden phoenix", price: 20000, minTier: 5 },

  { id: "hoodie", kind: "outfit", name: "grey hoodie", price: 30, minTier: 0 },
  { id: "pumptee", kind: "outfit", name: "pump green tee", price: 110, minTier: 1 },
  { id: "cap", kind: "outfit", name: "degen cap", price: 300, minTier: 2 },
  { id: "suit", kind: "outfit", name: "black suit", price: 900, minTier: 3 },
  { id: "chain", kind: "outfit", name: "gold chain", price: 2400, minTier: 4 },
  { id: "crown", kind: "outfit", name: "crown", price: 9000, minTier: 5 },
  { id: "diamondtee", kind: "outfit", name: "diamond hands tee", price: 180, minTier: 1 },
  { id: "backpack", kind: "outfit", name: "bag holder pack", price: 140, minTier: 1 },
  { id: "lasers", kind: "outfit", name: "laser eyes", price: 700, minTier: 2 },
  { id: "frogsuit", kind: "outfit", name: "frog hoodie", price: 520, minTier: 2 },
  { id: "moonsuit", kind: "outfit", name: "moon suit", price: 3800, minTier: 4 },
  { id: "goldsuit", kind: "outfit", name: "gold suit", price: 15000, minTier: 5 },
  ] as Item[]
).sort((a, b) => a.minTier - b.minTier || a.price - b.price);

export const itemById = (id: string) => ITEMS.find((i) => i.id === id);
export const MAX_FURNITURE = 4;

export type Placement = { furniture: string[]; pet: string | null; outfit: string | null };
/** What the browser keeps: only what was bought and where it went. Cash is always derived. */
export type Save = {
  owned: string[];
  placed: Record<string, Placement>;
};

export const emptySave = (): Save => ({ owned: [], placed: {} });
export const emptyPlacement = (): Placement => ({ furniture: [], pet: null, outfit: null });

export type BuyResult = { ok: true; save: Save } | { ok: false; reason: string };

/** Buy an item and place it on a floor. Items unlock per floor by that floor's tier. */
export function buyAndPlace(save: Save, item: Item, mint: string, floorTier: TierId, cash: number): BuyResult {
  if (floorTier < item.minTier) return { ok: false, reason: `needs ${TIERS[item.minTier].name} (${TIERS[item.minTier].minDays}d hold)` };
  const p = { ...(save.placed[mint] ?? emptyPlacement()) };
  const owned = save.owned.includes(item.id);
  if (item.kind === "furniture") {
    if (p.furniture.includes(item.id)) return { ok: false, reason: "already on this floor" };
    if (p.furniture.length >= MAX_FURNITURE) return { ok: false, reason: "floor is full" };
  }
  if (!owned && cash < item.price) return { ok: false, reason: "not enough cash" };
  if (item.kind === "furniture") p.furniture = [...p.furniture, item.id];
  if (item.kind === "pet") p.pet = item.id;
  if (item.kind === "outfit") p.outfit = item.id;
  return {
    ok: true,
    save: {
      ...save,
      owned: owned ? save.owned : [...save.owned, item.id],
      placed: { ...save.placed, [mint]: p },
    },
  };
}

export function removeFurniture(save: Save, mint: string, id: string): Save {
  const p = save.placed[mint];
  if (!p) return save;
  return { ...save, placed: { ...save.placed, [mint]: { ...p, furniture: p.furniture.filter((f) => f !== id) } } };
}

export const fmtCash = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}m` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : Math.floor(n).toLocaleString("en-US");

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Every real tower starts with enough for a crate and a rat; the demo gets more to play with. */
export const WALLET_BONUS = 100;
export const DEMO_BONUS = 1500;

/** Compact tower summary kept for the skyline leaderboard; rent is recomputed at read time. */
export type Resident = { w: string; top: string; f: [number | null, 0 | 1][] };

export function residentOf(owner: string, floors: Floor[]): Resident {
  const byAge = [...floors].sort((a, b) => (a.heldSince ?? Infinity) - (b.heldSince ?? Infinity));
  return { w: owner, top: byAge[0]?.symbol ?? "", f: byAge.map((f) => [f.heldSince, f.isHouse ? 1 : 0]) };
}

export type SkylineRow = { wallet: string; top: string; floors: number; citizens: number; rate: number; longest: number; house: boolean };

export function skylineRow(r: Resident, now = Date.now()): SkylineRow {
  let rate = 0;
  let citizens = 0;
  for (const [since, house] of r.f) {
    const t = tierFor(since, now);
    rate += floorRate(t, house === 1);
    citizens += citizensFor(t);
  }
  return {
    wallet: r.w,
    top: r.top,
    floors: r.f.length,
    citizens,
    rate,
    longest: r.f.length ? daysHeld(r.f[0][0], now) : 0,
    house: r.f.some(([, h]) => h === 1),
  };
}

export function lobbyFloor(joinedAt: number): Floor {
  return { mint: LOBBY_MINT, symbol: "RESIDENT", name: "your first floor", image: null, amount: 0, usd: null, heldSince: joinedAt, isHouse: false };
}

/** A tower counts as "empty" when the only floor is the free resident floor. */
export const tokenFloors = (floors: Floor[]) => floors.filter((f) => f.mint !== LOBBY_MINT);

// ---- daily rent streak -------------------------------------------------------

export type Streak = { last: number | null; n: number; best: number; total: number };
export const emptyStreak = (): Streak => ({ last: null, n: 0, best: 0, total: 0 });
export const STREAK_STEP = 25;
export const STREAK_CAP = 7;

export const dayIndex = (now = Date.now()) => Math.floor(now / DAY);
export const streakReward = (n: number) => STREAK_STEP * Math.min(n, STREAK_CAP);
export const canCollect = (s: Streak, now = Date.now()) => s.last !== dayIndex(now);
/** Ms until the next UTC day, when the next bonus opens. */
export const msToNextCollect = (now = Date.now()) => (dayIndex(now) + 1) * DAY - now;
/** The streak a wallet would be on if it collected now (missing a day resets it). */
export const nextStreakDay = (s: Streak, now = Date.now()) => (s.last === dayIndex(now) - 1 ? s.n + 1 : 1);

export function collect(s: Streak, now = Date.now()): { ok: true; streak: Streak; reward: number } | { ok: false } {
  if (!canCollect(s, now)) return { ok: false };
  const n = nextStreakDay(s, now);
  const reward = streakReward(n);
  return { ok: true, reward, streak: { last: dayIndex(now), n, best: Math.max(s.best, n), total: s.total + reward } };
}

/** Streak is broken (for display) once a full day has been skipped. */
export const liveStreak = (s: Streak, now = Date.now()) => (s.last != null && dayIndex(now) - s.last <= 1 ? s.n : 0);

// ---- weekly seasons ----------------------------------------------------------

const WEEK = 7 * DAY;
export const seasonOf = (now = Date.now()) => Math.max(1, Math.floor((now - GAME_EPOCH) / WEEK) + 1);
export const seasonEnds = (season: number) => GAME_EPOCH + season * WEEK;
/** Season points banked by one daily check-in: a full day of the tower's rent. */
export const checkInPoints = (floors: Floor[], now = Date.now()) => Math.round(towerRate(floors, now) * 24);

// ---- achievements ------------------------------------------------------------

export type Achievement = { id: string; name: string; hint: string };
export const ACHIEVEMENTS: Achievement[] = [
  { id: "resident", name: "resident", hint: "sign in and move in" },
  { id: "first-buy", name: "first purchase", hint: "buy anything" },
  { id: "house", name: "house money", hint: "hold $PTWR" },
  { id: "loft", name: "loft life", hint: "a floor held 7+ days" },
  { id: "penthouse", name: "penthouse", hint: "a floor held 30+ days" },
  { id: "skyscraper", name: "skyscraper", hint: "10+ floors" },
  { id: "decorator", name: "decorator", hint: "own 8+ items" },
  { id: "zoo", name: "zookeeper", hint: "3 floors with pets" },
  { id: "streak3", name: "regular", hint: "3 day check-in streak" },
  { id: "streak7", name: "landlord", hint: "7 day check-in streak" },
];

export function achievementsOf(floors: Floor[], save: Save, streak: Streak, signedIn: boolean, now = Date.now()): Set<string> {
  const got = new Set<string>();
  const tiers = floors.map((f) => tierFor(f.heldSince, now));
  if (signedIn) got.add("resident");
  if (save.owned.length) got.add("first-buy");
  if (floors.some((f) => f.isHouse)) got.add("house");
  if (tiers.some((t) => t >= 3)) got.add("loft");
  if (tiers.some((t) => t >= 5)) got.add("penthouse");
  if (tokenFloors(floors).length >= 10) got.add("skyscraper");
  if (save.owned.length >= 8) got.add("decorator");
  if (Object.values(save.placed).filter((p) => p.pet).length >= 3) got.add("zoo");
  if (streak.best >= 3) got.add("streak3");
  if (streak.best >= 7) got.add("streak7");
  return got;
}
