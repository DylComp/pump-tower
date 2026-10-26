// Generates two case-insensitive KING wallets. Private material is written only to an
// ignored, mode-0600 environment file; stdout contains public addresses only.
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { cpus } from "node:os";
import bs58 from "bs58";
if (!isMainThread) {
  while (true) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicBytes = publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32);
    const address = bs58.encode(publicBytes);
    if (/^king/i.test(address)) {
      const seed = privateKey
        .export({ format: "der", type: "pkcs8" })
        .subarray(-32);
      parentPort.postMessage({ address, secret: [...seed, ...publicBytes] });
    }
  }
} else {
  const path = ".env.king-wallets.local";
  if (existsSync(path))
    throw Error("Wallet env already exists; refusing replacement");
  const found = [],
    workers = [];
  for (let i = 0; i < Math.min(6, cpus().length); i++) {
    const w = new Worker(new URL(import.meta.url));
    workers.push(w);
    w.on("message", async (m) => {
      if (found.length >= 2 || found.some((x) => x.address === m.address))
        return;
      found.push(m);
      if (found.length === 2) {
        const [launcher, treasury] = found;
        writeFileSync(
          path,
          `KING_LAUNCHER_SECRET_KEY=${JSON.stringify(launcher.secret)}\nKING_TREASURY_SECRET_KEY=${JSON.stringify(treasury.secret)}\nKING_LAUNCHER_WALLET=${launcher.address}\nKING_TREASURY_WALLET=${treasury.address}\n`,
          { mode: 0o600, flag: "wx" },
        );
        await Promise.all(workers.map((w) => w.terminate()));
        console.log(
          JSON.stringify({
            launcher: launcher.address,
            treasury: treasury.address,
            envFile: path,
          }),
        );
      }
    });
  }
}
