import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import sharp from "sharp";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "shelfie-photo-browser-"));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  try {
    await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import PhotoCapture from "./src/components/photo-capture"; createRoot(document.getElementById("root")).render(<React.StrictMode><PhotoCapture /></React.StrictMode>);', loader: "tsx", resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "esm", outfile: join(directory, "app.js"), tsconfig: "tsconfig.json" });
    const script = await readFile(join(directory, "app.js"));
    const css = await readFile("src/app/globals.css", "utf8");
    server = createServer((request, response) => {
      if (request.url === "/app.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(script); }
      else { response.writeHead(200, { "Content-Type": "text/html" }); response.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main class="intake-shell photo-shell"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>`); }
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Browser test server unavailable");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage({ viewport: { width: 690, height: 829 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const id = randomUUID(); let saved = false; let reads = 0; let barcodeFound = false;
    await page.route("**/api/photos", async route => {
      if (route.request().method() === "POST") saved = true;
      await route.fulfill({ json: { revision: saved ? 1 : 0, draftKey: "a".repeat(64), photos: saved ? [{ id, url: `/api/photos/${id}` }] : [] } });
    });
    const image = await sharp({ create: { width: 1200, height: 1000, channels: 3, background: "white" } }).jpeg().toBuffer();
    await page.route("**/api/photos/*", route => route.fulfill({ contentType: "image/jpeg", body: image }));
    await page.route("**/api/ingredients", async route => { reads++; await route.fulfill({ status: 422, json: { error: "We couldn’t read the whole ingredient list. Try another photo. Your free report hasn’t been used." } }); });
    await page.route("**/api/barcode", async route => {
      const body = route.request().postDataJSON();
      assert.equal(body.action, "lookup");
      await route.fulfill({ json: barcodeFound ? { found: true, lookupId: randomUUID(), product: { barcode: "3560070791460", name: "Fixture cream", brand: "Fixture", ingredientsText: "Aqua, Glycerin", sourceUrl: "https://world.openbeautyfacts.org/product/3560070791460", retrievedAt: new Date().toISOString(), lastModified: null } } : { found: false, message: "Product not found. Photograph the ingredients instead." } });
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "Upload from phone", exact: true }).waitFor();
    await page.locator("#phone-photos").setInputFiles({ name: "label.jpg", mimeType: "image/jpeg", buffer: image });
    await page.getByRole("button", { name: "Save this photo", exact: true }).click();
    await page.getByRole("button", { name: "Show my free report", exact: true }).click();
    await page.getByRole("alert").waitFor(); assert.equal(reads, 1);
    assert.equal(await page.locator(".photo-list li").count(), 1);
    assert.equal(await page.locator("#phone-photos").getAttribute("multiple"), null);
    await page.getByLabel("Or enter the barcode numbers").fill("3560070791460");
    await page.getByRole("button", { name: "Find product", exact: true }).click();
    await page.getByText("Product not found. Photograph the ingredients instead.", { exact: true }).waitFor();
    barcodeFound = true;
    await page.getByRole("button", { name: "Find product", exact: true }).click();
    await page.getByRole("heading", { name: "Fixture cream" }).waitFor();
    const confirm = page.getByRole("button", { name: "Show my free report for this product" });
    assert.equal(await confirm.isDisabled(), true);
    await page.getByRole("checkbox").check(); assert.equal(await confirm.isEnabled(), true);
    for (const width of [390, 690, 1024]) {
      await page.setViewportSize({ width, height: 829 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No horizontal overflow at ${width}`);
    }
    assert.deepEqual(errors, []);
    console.log("PASS: one photo, one read request, retained retry photo, barcode fallback and required confirmation; phone/Fold/desktop widths.");
  } finally { await browser?.close(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
