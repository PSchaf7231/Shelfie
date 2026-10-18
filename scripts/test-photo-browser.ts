import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import sharp from "sharp";
import { MAX_PHOTOS, MAX_PREPARED_PHOTO_BYTES, MAX_UPLOAD_BYTES } from "../src/lib/photo-limits";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "shelfie-photo-browser-"));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
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
    const label = Buffer.from('<svg width="2800" height="2100" xmlns="http://www.w3.org/2000/svg"><rect width="2800" height="2100" fill="white"/><g fill="black" font-size="80"><text x="100" y="200">INGREDIENT LABEL FIXTURE</text><text x="100" y="500">Ingredients: Aqua, Glycerin,</text><text x="100" y="700">Cetyl Alcohol, Sodium Chloride.</text><text x="100" y="1000">End of ingredient list.</text></g></svg>');
    const jpeg = await sharp(label).withExif({ IFD0: { Artist: "Synthetic browser fixture" } }).jpeg({ quality: 98 }).toBuffer();
    // Valid JPEG with trailing padding: two originals exceed the hosting limit.
    const large = Buffer.concat([jpeg, Buffer.alloc(3_000_000)]);
    assert.ok(large.length * 2 > 4_500_000);
    const file = (name = "label.jpg") => ({ name, mimeType: "image/jpeg", buffer: large });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    let scope = "a".repeat(64), revision = 0, saved: { id: string; url: string }[] = [];
    let mode: "oversize" | "html" | "quality" | "success" = "oversize";
    let verified = true;
    let loadError = false;
    const bodies: { size: number; count: number }[] = [];
    await page.route("**/api/photos/*", route => route.fulfill({ status: 200, contentType: "image/jpeg", body: jpeg }));
    await page.route("**/api/photos", async route => {
      if (!verified) { await route.fulfill({ status: 401, json: { error: "Verify your email before adding photos." } }); return; }
      if (route.request().method() === "GET") {
        if (loadError) await route.fulfill({ status: 503, contentType: "text/html", body: "<html>Temporarily unavailable</html>" });
        else await route.fulfill({ json: { revision, draftKey: scope, photos: saved } });
        return;
      }
      const bytes = route.request().postDataBuffer()!;
      assert.ok(bytes.length < MAX_UPLOAD_BYTES);
      const request = new Request(origin + "/api/photos", { method: "POST", headers: { "Content-Type": route.request().headers()["content-type"] }, body: new Uint8Array(bytes) });
      const form = await request.formData();
      const files = form.getAll("photos") as File[];
      for (const uploaded of files) {
        assert.equal(uploaded.type, "image/jpeg"); assert.ok(uploaded.size <= MAX_PREPARED_PHOTO_BYTES);
        const metadata = await sharp(Buffer.from(await uploaded.arrayBuffer())).metadata();
        assert.ok(Math.max(metadata.width!, metadata.height!) <= 2400);
        assert.equal(metadata.exif, undefined);
      }
      bodies.push({ size: bytes.length, count: files.length });
      if (mode === "oversize") { await route.fulfill({ status: 413, contentType: "text/plain", body: "Request Entity Too Large" }); return; }
      if (mode === "html") { await route.fulfill({ status: 504, contentType: "text/html", body: "<html>Gateway timeout</html>" }); return; }
      if (mode === "quality") { await route.fulfill({ status: 422, json: { error: "We couldn’t confirm these photos show the same product. Keep one product’s photos together, or choose Start a different product." } }); return; }
      const retained: string[] = JSON.parse(String(form.get("existingIds")));
      saved = [...saved.filter(photo => retained.includes(photo.id)), ...files.map(() => { const id = randomUUID(); return { id, url: `/api/photos/${id}` }; })];
      revision++;
      await route.fulfill({ json: { revision, draftKey: scope, photos: saved, message: "Your label photos are checked and saved. Your free report is still available." } });
    });
    async function ready(target: Page = page) { await target.waitForFunction(() => { const button = document.querySelector<HTMLButtonElement>(".capture-actions button"); return button && !button.disabled; }); }
    async function count(value: number) { await page.waitForFunction(expected => document.querySelectorAll(".photo-list li").length === expected && !document.querySelector(".capture-actions")?.textContent?.includes("Adding"), value); }
    async function checkPhotos() { await page.getByRole("button", { name: /^Check (this|these)/ }).click(); }
    const sources = () => page.locator(".photo-list img").evaluateAll(images => images.map(image => image.getAttribute("src")));

    await page.goto(origin); await ready();
    await page.locator("#camera-photo").setInputFiles(file("first-angle.jpg")); await count(1); await ready();
    const first = (await sources())[0];
    await page.locator("#camera-photo").setInputFiles(file("second-angle.jpg")); await count(2); await ready();
    assert.equal((await sources())[0], first);
    console.log("PASS: taking a second photo appends it without replacing the first");

    await page.reload(); await count(2); await ready();
    assert.match(await page.locator(".photo-success").innerText(), /unfinished photos are back/);
    console.log("PASS: both pending photos survive a camera-style page reload");
    const beforeRetake = await sources();
    const cancelled = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Retake photo 1", exact: true }).click();
    await (await cancelled).setFiles([]);
    assert.deepEqual(await sources(), beforeRetake);
    const retake = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Retake photo 1", exact: true }).click();
    await (await retake).setFiles(file("retaken-angle.jpg"));
    await page.waitForFunction(() => document.querySelector(".photo-success")?.textContent?.includes("Retake added"));
    await ready();
    const afterRetake = await sources();
    assert.notEqual(afterRetake[0], beforeRetake[0]); assert.equal(afterRetake[1], beforeRetake[1]);
    console.log("PASS: canceling a retake keeps both photos; completing it replaces only the selected photo");

    await checkPhotos();
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("too large to send together"));
    assert.equal(await page.locator(".photo-list li").count(), 2);
    assert.doesNotMatch(await page.locator('[role="alert"]').innerText(), /Unexpected token|JSON/);
    await page.reload(); await count(2); await ready();
    mode = "html"; await checkPhotos();
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("Your photos are still here"));
    assert.equal(await page.locator(".photo-list li").count(), 2);
    console.log("PASS: plaintext 413 and HTML timeout replies show plain English and preserve the photos");

    await ready();
    await page.locator("#phone-photos").setInputFiles(Array.from({ length: 4 }, (_, index) => file(`angle-${index + 3}.jpg`)));
    await count(6);
    mode = "quality"; await checkPhotos();
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("same product"));
    assert.equal(bodies.at(-1)?.count, MAX_PHOTOS);
    assert.equal(await page.locator(".photo-list li").count(), MAX_PHOTOS);
    assert.equal(await page.getByRole("button", { name: "Show my free report" }).count(), 0);
    await page.locator("#phone-photos").setInputFiles(file("one-too-many.jpg"));
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("six photos"));
    assert.equal(await page.locator(".photo-list li").count(), MAX_PHOTOS);
    console.log("PASS: six prepared photos fit the wire limit; quality rejection never discards them or unlocks a report");

    await page.getByRole("button", { name: "Remove photo 6", exact: true }).click(); await count(5); await ready();
    await page.locator("#phone-photos").setInputFiles({ name: "unreadable.heic", mimeType: "image/heic", buffer: Buffer.from("unreadable fixture") });
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("couldn’t open"));
    assert.equal(await page.locator(".photo-list li").count(), 5);
    await ready(); await page.locator("#phone-photos").setInputFiles(file()); await count(6);
    mode = "success"; await checkPhotos();
    await page.getByRole("button", { name: "Show my free report" }).waitFor();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>(".photo-list button")?.disabled);
    assert.equal((await sources()).every(url => url?.startsWith("/api/photos/")), true);
    await page.reload();
    await page.getByRole("button", { name: "Show my free report" }).waitFor();
    assert.equal(await page.locator(".photo-list li").count(), 6);
    console.log("PASS: unsupported files preserve other photos; a successful check clears the pending draft and restores saved photos");

    await page.getByRole("button", { name: "Start a different product" }).click(); await count(0); await ready();
    await page.reload(); await ready();
    assert.equal(await page.locator(".photo-list li").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Show my free report" }).count(), 0);
    await page.locator("#camera-photo").setInputFiles(file()); await count(1); await ready();
    scope = "b".repeat(64); revision = 0; saved = [];
    await page.reload(); await ready();
    assert.equal(await page.locator(".photo-list li").count(), 0);
    console.log("PASS: starting another product stays cleared after reload; another verified session cannot see the earlier draft");

    await page.locator("#camera-photo").setInputFiles(file()); await count(1); await ready();
    revision = 1; const freshId = randomUUID(); saved = [{ id: freshId, url: `/api/photos/${freshId}` }];
    await page.reload(); await ready();
    assert.deepEqual(await sources(), [`/api/photos/${freshId}`]);
    const panorama = await sharp({ create: { width: 8000, height: 600, channels: 3, background: "white" } }).jpeg().toBuffer();
    await page.locator("#phone-photos").setInputFiles({ name: "panorama.jpg", mimeType: "image/jpeg", buffer: panorama });
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("one section"));
    assert.deepEqual(await sources(), [`/api/photos/${freshId}`]);
    verified = false; await page.reload();
    await page.getByRole("link", { name: "Return to email verification" }).waitFor();
    assert.equal(await page.locator(".photo-list li").count(), 0);
    verified = true; loadError = true; await page.reload();
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("load your saved photos"));
    assert.equal(await page.locator(".capture-actions button").first().isDisabled(), true);
    assert.equal(await page.locator(".photo-list li").count(), 0);
    assert.deepEqual(pageErrors, []);
    console.log("PASS: stale drafts never replace newer server photos; unverified sessions cannot restore private drafts");
    console.log("PASS: extreme panoramas keep existing photos; failed initial loads block edits until refresh");
    console.log(`Photo browser checks passed. Largest tested request: ${Math.max(...bodies.map(body => body.size))} bytes. No email or vision calls were made.`);
  } finally {
    await browser.close();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
