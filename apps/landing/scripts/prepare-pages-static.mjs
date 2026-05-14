/**
 * Cloudflare Pages + OpenNext:
 *
 * 1) OpenNext puts browser assets under `.open-next/assets/` (e.g. `assets/_next/static/...`)
 *    while HTML references `/_next/static/...`. Copy those trees to the output root.
 *
 * 2) When a project has a Pages Function / `_worker.js`, Cloudflare invokes the worker on
 *    **all** routes by default. Static files under `/_next/static/*` would never be served
 *    unless those paths are listed in `_routes.json` `exclude`. See:
 *    https://developers.cloudflare.com/pages/functions/routing/
 */
import { copyFileSync, cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

const buildIdSrc = join(assets, "BUILD_ID");
if (existsSync(buildIdSrc)) {
  copyFileSync(buildIdSrc, join(root, "BUILD_ID"));
}

const routesPath = join(root, "_routes.json");
const routes = {
  version: 1,
  include: ["/*"],
  exclude: [
    "/_next/static/*",
    "/brand/*",
  ],
};
writeFileSync(routesPath, `${JSON.stringify(routes, null, 2)}\n`, "utf8");

const staticRoot = join(nextDest, "static");
if (!existsSync(staticRoot)) {
  console.error("prepare-pages-static: missing .open-next/_next/static after copy");
  process.exit(1);
}

const cssDir = join(staticRoot, "css");
if (!existsSync(cssDir) || readdirSync(cssDir).filter((f) => f.endsWith(".css")).length === 0) {
  console.error("prepare-pages-static: expected at least one .css under .open-next/_next/static/css");
  process.exit(1);
}

if (!existsSync(join(root, "_worker.js")) && !existsSync(join(root, "worker.js"))) {
  console.error("prepare-pages-static: missing worker bundle (.open-next/_worker.js or worker.js)");
  process.exit(1);
}

console.log(
  "prepare-pages-static: OK — hoisted _next + brand, wrote _routes.json, verified _next/static/css",
);
