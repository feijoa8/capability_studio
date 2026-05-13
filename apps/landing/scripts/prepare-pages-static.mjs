/**
 * Cloudflare Pages serves paths from the build output root. OpenNext places
 * browser assets under `.open-next/assets/` (e.g. `assets/_next/static/...`),
 * while Next HTML references `/_next/static/...`. Copy those trees to the
 * output root so static CSS/JS resolve without going through the worker.
 */
import { copyFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), ".open-next");
const assets = join(root, "assets");

if (!existsSync(assets)) {
  console.error("prepare-pages-static: missing .open-next/assets (run opennextjs-cloudflare build first)");
  process.exit(1);
}

const nextSrc = join(assets, "_next");
if (!existsSync(nextSrc)) {
  console.error("prepare-pages-static: missing .open-next/assets/_next");
  process.exit(1);
}

const nextDest = join(root, "_next");
const brandDest = join(root, "brand");

if (existsSync(nextDest)) rmSync(nextDest, { recursive: true });
if (existsSync(brandDest)) rmSync(brandDest, { recursive: true });

cpSync(nextSrc, nextDest, { recursive: true });

const brandSrc = join(assets, "brand");
if (existsSync(brandSrc)) {
  cpSync(brandSrc, brandDest, { recursive: true });
}

const headersSrc = join(assets, "_headers");
if (existsSync(headersSrc)) {
  copyFileSync(headersSrc, join(root, "_headers"));
}
