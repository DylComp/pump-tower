// The docs shown in the "docs" section: what Pump Tower is, then every
// section of the site and its features, in page order. Kept next to the rules so each change
// updates it in the same commit; numbers are read from the rules, not typed in.
import {
  CASH_PER_SOL,
  HOUSE_BOOST,
  HOUSE_SYMBOL,
  MAX_FURNITURE,
  TREASURY_WALLET,
  TIERS,
  WALLET_BONUS,
  citizensFor,
  floorRate,
  streakReward,
} from "./game";
import { FEE_TIERS, FEE_TIER_NAMES, SPLIT } from "./launch/model";
import { HOLDERS_BPS, MAX_MEMBERS, MAX_PAYEES, MIN_PAYOUT_LAMPORTS, POT_BPS } from "./king/model";
import { ALL_QUESTS_BONUS, QUESTS, REFERRED_REWARD, REFERRER_REWARD } from "./quests";

export type DocSection = { id: string; title: string; summary: string; items: [string, string][] };

export const DOCS_INTRO =
  "Pump Tower turns a Solana wallet into a pixel skyscraper. Every coin you hold is a floor. The longer you hold it, the better the floor gets and the more rent it pays in game cash. The launchpad lets anyone launch a pump.fun coin for any pump user, who gets most of its creator fees and a tower of their own. The rest buys back $PTWR and burns it, live on the activity page.";

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
      ["Bag details", "Every coin you hold shows up on its floor: a sack stamped with its logo that grows with the bag (spilling coins, then gold bars), its ticker on a flag after a day, a plush of the coin at a week, a diamond hands trophy at a month, a rocket with the 24h move on green days and a HODL sign on red ones."],
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
      ["Pump names", "A tower whose owner has a pump.fun profile shows their pump name and picture in the city, skyline and tower view instead of a short wallet address."],
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
    summary: "The game's coin, backed by buybacks, burns and perks in the game.",
    items: [
      ["HQ floor", `Holding $${HOUSE_SYMBOL} adds a neon Pump HQ floor that earns ${HOUSE_BOOST}x the rent of any other bag.`],
      ["In game", "That triple rent is game cash, so $" + HOUSE_SYMBOL + " holders unlock furniture, pets and outfits fastest."],
      ["Buybacks", `${SPLIT.treasuryBps / 100}% of the creator fees from every coin launched on the launchpad go to the buy & burn wallet, which buys $${HOUSE_SYMBOL} on the market.`],
      ["Burns", `Every $${HOUSE_SYMBOL} bought back is burned in the same transaction, so the supply only goes down.`],
      ["Burn tracker", "Total burned, its share of the 1B supply, SOL spent and each recent burn with its transaction, live below and on the activity page."],
      ["Contract", "Copy it just below, or from the CA button in the menu on any page, then buy it on pump.fun."],
    ],
  },
  {
    id: "launchpad",
    title: "Launchpad",
    summary: "Launch a pump.fun coin for any pump user, at pumptowers.fun/launch.",
    items: [
      ["Pick a user", "Search a pump.fun username, paste a profile link or a wallet. Their picture, name and wallet show up before you launch."],
      ["Fee split", `${SPLIT.recipientBps / 100}% of the coin's creator fees go to that user's wallet, ${SPLIT.treasuryBps / 100}% to the Pump Tower treasury to buy back $${HOUSE_SYMBOL}. Set and locked in the launch transaction itself; nobody can change it after.`],
      ["One approval", "Coin, fee split and optional dev buy happen in one transaction, so nobody can buy before you. Your wallet and a one-time mint key made in your browser are the only signers. No setup: launching is open to every wallet."],
      ["Kept", "Bonding curve, graduation to PumpSwap, dev buy, name, ticker, picture, description, X and Telegram links."],
      ["Off", "Custom websites (every coin's site is its page here), and mayhem mode, cashback and holder rewards mode, which would take the creator fees away from the split."],
      ["Payouts", "Fees collect on pump.fun and are paid out automatically, 80/20, to the pump profile and the treasury. Nobody has to press anything."],
      ["Tokens page", "Every coin launched here with its logo, fee tier, creator fees, market cap and 24h volume, plus totals across all coins: coins, pump profiles, creator fees, volume and market cap."],
      ["Fees routed", `A tracker on the activity page following every creator fee: ${SPLIT.recipientBps / 100}% to pump profiles, ${SPLIT.treasuryBps / 100}% to the treasury, then bought back and burned as $${HOUSE_SYMBOL}.`],
      ["Pump profiles", "A tab on the tokens page listing every pump user coins were launched for: how many coins, total fees, what they have earned, combined market cap and 24h volume, their latest launch and top coin."],
      ["Coin page", "Chart, links, who it pays, fees so far and its floor milestone, at pumptowers.fun/t/ plus the coin's address."],
      ["Share card", "Every coin page has its own share image with the logo, ticker, who it pays, fees and market cap, shown when the link is posted on X or Telegram."],
      ["Profiles", "pumptowers.fun/u/ plus a wallet shows a pump user's coins, what they've earned and a link to their tower."],
    ],
  },
  {
    id: "king",
    title: "King of the Hill",
    summary: "A fan coin for every squad in pump.fun's Squad Invitational, at pumptowers.fun/king.",
    items: [
      ["Squad coins", "Each of the top 100 squads in pump.fun's Squad Invitational gets an unofficial pump.fun fan coin named after it. Not affiliated with the squad or pump.fun. Coins launch automatically, best-ranked squads first. Squads whose names contain slurs don't get one."],
      ["Fee split", `${POT_BPS / 100}% of each coin's creator fees go to the King pot (the treasury). The other ${100 - POT_BPS / 100}% is split equally across up to ${MAX_MEMBERS} of the squad's members, owner first. Locked in the launch transaction, admin revoked.`],
      ["The crown", "Every hour, the squad with a coin whose members banked the most SOL is King. Banked SOL is read straight from every member's wallet on chain: SOL out of their trades minus SOL into them, wrapped SOL and network fees included, and sells into USDC or USDT counted at SOL's price. Plain transfers and airdrops don't count, and neither does paper profit. Struck squads can't win."],
      ["The pot", `The treasury's share of every squad coin's fees earned that hour, plus anything rolled over. ${HOLDERS_BPS / 100}% goes to holders of the King's coin, ${100 - HOLDERS_BPS / 100}% buys back and burns $${HOUSE_SYMBOL}.`],
      ["Getting paid", `Hold the King's coin. Holders are counted at a secret minute each hour, so buying right before the crown doesn't work. Paid in SOL, pro rata to your bag, top ${MAX_PAYEES} holders. Payouts under ${Number(MIN_PAYOUT_LAMPORTS) / 1e9} SOL roll into the next hour.`],
      ["Left out", "Program accounts (the bonding curve, the PumpSwap pool), the treasury and the launch wallet never get holder payouts."],
      ["Public list", "Each hour's King, pot and every payout is published at /api/king/payouts, and the treasury workers send exactly that list."],
      ["Data", "Squads and their members come from pump.fun's board, read once when the cup locked membership. A squad's wallets are watched from the moment its coin launches, every five minutes. Our crown is our own on-chain count, not pump.fun's ranking. The cup runs until Nov 9, 14:00 UTC."],
      ["Intro", "The first King page you open each browser session plays a short intro while the board loads: the crowned pill climbs the hill as real squad names drift past, then the screen breaks away in pixel blocks. After that, King pages open instantly."],
    ],
  },
  {
    id: "activity",
    title: "Activity",
    summary: "Live buybacks, burns and fees, at pumptowers.fun/activity.",
    items: [
      ["Totals", `Total creator fees collected, $${HOUSE_SYMBOL} burned and its share of the supply, SOL spent on buybacks and what pump profiles have been paid.`],
      ["Fee flow", "The same fees-routed tracker as the tokens page, step by step from creator fees to burned tokens."],
      ["Wallet feed", `The buy & burn wallet${TREASURY_WALLET ? ` (${TREASURY_WALLET.slice(0, 4)}…${TREASURY_WALLET.slice(-4)})` : ""}'s latest transactions, each labelled fees in, buy & burn or sent, with a link to Solscan.`],
      ["Buybacks", `Each recent buyback: SOL spent, $${HOUSE_SYMBOL} burned and its transaction.`],
      ["Live", "Everything refreshes every 30 seconds while the page is open."],
    ],
  },
  {
    id: "launch-floors",
    title: "Launch floors",
    summary: "Coins launched for you live in your tower.",
    items: [
      ["Their tower", "Launching a coin for a pump user puts up their Pump Tower in the city and skyline right away, even if they've never visited. The launch page shows it before you launch, with the fee milestone for each floor upgrade."],
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
      ["Read only", "The game only reads balances and history. The launchpad is the only thing that asks for a transaction, and your wallet shows exactly what each one does before you approve."],
      ["Sign in", "A free message signature to prove the wallet is yours. It can't move tokens."],
      ["Wallets", "Phantom, Solflare and Backpack. On a phone, connect opens Pump Tower inside the Phantom or Solflare app."],
      ["Treasury", "The buy & burn wallet is public. Every transaction it makes is listed on the activity page and checkable on Solscan."],
      ["Source", "The full code is on GitHub, linked in the menu and footer."],
      ["Fair use", "Request caps sit far above normal play and only stop bot floods. Pump profiles and pictures are cached and keep working even if pump.fun is briefly down, and a busy moment is retried for you."],
    ],
  },
];
