// The docs shown in the "docs" section: what Pump Tower is, then every
// section of the site and its features, in page order. Kept next to the rules so each change
// updates it in the same commit; numbers are read from the rules, not typed in.
import {
  CASH_PER_SOL,
  HOUSE_BOOST,
  HOUSE_SYMBOL,
  MAX_FURNITURE,
  TIERS,
  WALLET_BONUS,
  citizensFor,
  floorRate,
  streakReward,
} from "./game";
import { FEE_TIERS, FEE_TIER_NAMES, SPLIT } from "./launch/model";
import { ALL_QUESTS_BONUS, QUESTS, REFERRED_REWARD, REFERRER_REWARD } from "./quests";

export type DocSection = { id: string; title: string; summary: string; items: [string, string][] };

export const DOCS_INTRO =
  "Pump Tower turns a Solana wallet into a pixel skyscraper. Every coin you hold is a floor. The longer you hold it, the better the floor gets and the more rent it pays in game cash. The launchpad lets anyone launch a pump.fun coin for any pump user, who gets most of its creator fees and a floor for it in their tower.";

export const DOCS: DocSection[] = [
  {
    id: "tower",
    title: "Tower",
    summary: "Your wallet as a building.",
    items: [
      ["Floors", "Every listed coin worth $0.50 or more is one floor. Oldest hold sits on top."],
      ["Home floor", "Signing in adds a free floor, so every tower has at least one."],
      ["Rooms", "Each floor is a themed room. Three rooms per tier; the coin picks which."],
      ["Coin details", "Rooms show the coin's logo, colours and live price. More cash or gold appears as the bag grows."],
      ["Mood", "Windows rain when the coin is down 12% on the day and show fireworks when it is up 12%."],
      ["Token card", "Next to each floor: bag value, 24h move, time held, rent, level and time to the next tier."],
      ["Level", "Grows with bag size times hold time."],
      ["Citizens", `${citizensFor(0)} on bare walls up to ${citizensFor(5)} in a penthouse. They talk about the coin.`],
      ["Visit", "Paste any wallet to see its tower. Share on X, copy the link or save a PNG."],
    ],
  },
  {
    id: "cash",
    title: "Cash",
    summary: "The game currency. Not a token, not withdrawable.",
    items: [
      ["Rent", `Each floor earns per hour by tier: $${floorRate(0, false)} on bare walls up to $${floorRate(5, false)} in a penthouse.`],
      ["Source", "Worked out from on-chain hold time, so it can't be faked."],
      ["Start", `New towers start with $${WALLET_BONUS}.`],
      ["Daily bonus", `Sign in and collect once a day. $${streakReward(1)} on day one, rising to $${streakReward(7)} from day seven. Missing a day resets the streak.`],
      ["Daily quests", `${QUESTS.map((q) => `${q.label} ($${q.reward})`).join(", ")}. Finish all five for $${ALL_QUESTS_BONUS} more. Resets at midnight UTC.`],
      ["Invites", `Copy your invite link from the tower panel. When a new wallet signs in through it and it collects its first daily bonus holding a bag, you get $${REFERRER_REWARD} and they get $${REFERRED_REWARD}.`],
    ],
  },
  {
    id: "city",
    title: "City",
    summary: "Every tower on one skyline.",
    items: [
      ["Buildings", "Each ranked tower, floors lit by tier. Green is $" + HOUSE_SYMBOL + ", gold is a penthouse."],
      ["Order", "Highest rent in the middle. Top three get a lit antenna."],
      ["Coin signs", "A tower with coins launched for its owner hangs a lit sign on its side with the count, flickering like neon."],
      ["Visit", "Hover for the owner and rent, tap to walk in."],
    ],
  },
  {
    id: "skyline",
    title: "Skyline",
    summary: "The leaderboards.",
    items: [
      ["Season", "Weekly. Each daily check-in adds a day of your tower's rent as points."],
      ["All time", "Ranked by rent per hour."],
      ["Achievements", "Ten milestones, from moving in to a 7 day streak."],
    ],
  },
  {
    id: "ladder",
    title: "Ladder",
    summary: "How floors level up.",
    items: [
      ...TIERS.map((t): [string, string] => [t.name, `${t.minDays === 0 ? "Day zero" : `${t.minDays}+ days held`}. $${floorRate(t.id, false)}/hr.`]),
      ["Reset", "Selling the whole bag resets that floor's clock. Partial sells don't."],
    ],
  },
  {
    id: "catalog",
    title: "Catalog",
    summary: "What cash buys.",
    items: [
      ["Furniture", `Up to ${MAX_FURNITURE} pieces per floor, shown inside the room.`],
      ["Pets", "One per floor. Walks around the room."],
      ["Outfits", "One per floor. Every citizen on that floor wears it."],
      ["Unlocks", "Each item needs its floor to reach a tier first."],
      ["Full shop", "Open shop shows every item large, with a floor picker, so you can buy and place without scrolling the tower."],
      ["Saves", "Signed in, purchases are stored on the server and follow you to any device."],
    ],
  },
  {
    id: "coin",
    title: `$${HOUSE_SYMBOL}`,
    summary: "The game's coin, launching on pump.fun.",
    items: [
      ["HQ floor", `Holding $${HOUSE_SYMBOL} adds a Pump HQ floor that earns ${HOUSE_BOOST}x rent.`],
      ["Holder rewards", "pump.fun pays SOL to holders with $20 or more, several times an hour, straight to the wallet."],
      ["In game", `Every SOL received also adds $${CASH_PER_SOL.toLocaleString("en-US")} of game cash. Your SOL stays yours.`],
      ["Buybacks", `${SPLIT.treasuryBps / 100}% of the creator fees from every coin launched on the launchpad go to the treasury, which buys back $${HOUSE_SYMBOL} and burns it.`],
      ["Burn tracker", "Total burned, its share of the 1B supply, SOL spent and each recent burn with its transaction, live below."],
      ["Contract", "Copy it just below on launch day, with a link to buy on pump.fun."],
    ],
  },
  {
    id: "launchpad",
    title: "Launchpad",
    summary: "Launch a pump.fun coin for any pump user, at pumptowers.fun/launch.",
    items: [
      ["Pick a user", "Search a pump.fun username, paste a profile link or a wallet. Their picture, name and wallet show up before you launch."],
      ["Fee split", `${SPLIT.recipientBps / 100}% of the coin's creator fees go to that user's wallet, ${SPLIT.treasuryBps / 100}% to the Pump Tower treasury to buy back $${HOUSE_SYMBOL}. Set and locked in the launch transaction itself; nobody can change it after.`],
      ["One approval", "Coin, fee split and optional dev buy happen in one transaction, so nobody can buy before you. Your wallet and a one-time mint key made in your browser are the only signers."],
      ["Kept", "Bonding curve, graduation to PumpSwap, dev buy, name, ticker, picture, description, X and Telegram links."],
      ["Off", "Custom websites (every coin's site is its page here), and mayhem mode, cashback and holder rewards mode, which would take the creator fees away from the split."],
      ["Payouts", "Fees collect on pump.fun until someone pays them out. Anyone can press pay out on the coin's page; it costs only the network fee."],
      ["Tokens page", "Every coin launched here with its fees and market cap, plus totals for all coins combined."],
      ["Pump profiles", "A tab on the tokens page listing every pump user coins were launched for: how many coins, total fees, what they have earned, combined market cap and their top coin."],
      ["Coin page", "Chart, links, who it pays, fees so far and its floor milestone, at pumptowers.fun/t/ plus the coin's address."],
      ["Share card", "Every coin page has its own share image with the logo, ticker, who it pays, fees and market cap, shown when the link is posted on X or Telegram."],
      ["Profiles", "pumptowers.fun/u/ plus a wallet shows a pump user's coins, what they've earned and a link to their tower."],
    ],
  },
  {
    id: "launch-floors",
    title: "Launch floors",
    summary: "Coins launched for you live in your tower.",
    items: [
      ["Their tower", "Launching a coin for a pump user puts up their Pump Tower in the city right away, even if they've never visited."],
      ["Floor", "Every coin launched for a wallet becomes a floor in its tower, held or not. It ages from launch day like any bag."],
      ["Milestones", FEE_TIER_NAMES.map((n, i) => `${n} at ${FEE_TIERS[i]} SOL`).join(", ") + " of lifetime creator fees. Each one lifts the floor a room tier at once."],
      ["Cash", `Your share of fees paid out adds $${CASH_PER_SOL.toLocaleString("en-US")} of game cash per SOL, on top of the SOL itself.`],
    ],
  },
  {
    id: "safety",
    title: "Safety",
    summary: "What the site can and can't do.",
    items: [
      ["Read only", "The game only reads balances and history. The launchpad and fee payouts are the only things that ask for a transaction, and your wallet shows exactly what each one does before you approve."],
      ["Sign in", "A free message signature to prove the wallet is yours. It can't move tokens."],
      ["Wallets", "Phantom, Solflare and Backpack. On a phone, connect opens Pump Tower inside the Phantom or Solflare app."],
      ["Source", "The full code is on GitHub, linked in the menu and footer."],
      ["Fair use", "Each connection gets a set number of requests a minute, so bots can't flood sign-in or the shop. Hit it and you wait a minute."],
    ],
  },
];
