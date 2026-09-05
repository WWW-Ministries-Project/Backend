import { existsSync, readFileSync } from "fs";
import { join } from "path";

// puppeteer ships ESM-only as of v25 — this file compiles to CommonJS, so a
// static import (even `import type`) produces a `require()` call under
// NodeNext module resolution. Reference the type via an explicit
// resolution-mode assertion and import the module itself dynamically at
// the call site instead.
type PuppeteerModule = import(
  "puppeteer",
  { with: { "resolution-mode": "import" } }
).PuppeteerNode;

import { InternalServerError } from "./custom-error-handlers";

// Load main logo once at startup — gracefully degrade if asset missing on server
let logoBuffer: Buffer | null = null;
let logoMimeType = "image/png";
let logoDataUri = "";

try {
  const logoAssetPath = join(process.cwd(), "src", "assets", "main-logo.png");
  logoBuffer = readFileSync(logoAssetPath);
  logoMimeType = "image/png";
  logoDataUri = `data:image/png;base64,${logoBuffer.toString("base64")}`;
} catch {
  // Asset not found — documents generate without logo
}

export const getChurchLogoBuffer = (): Buffer | null => logoBuffer;
export const getChurchLogoMimeType = (): string => logoMimeType;
export const getChurchLogoDataUri = (): string => logoDataUri;

export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const slugifyFilePart = (
  value: string,
  fallback = "report",
): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;

// Hard cap so a stuck Chromium fails fast with a clear error instead of hanging
// until the reverse proxy returns a 504.
const PDF_RENDER_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS) || 45_000;

// Resolve the Chromium binary. The Alpine `chromium` package name for the
// executable has varied (`/usr/bin/chromium` vs `/usr/bin/chromium-browser`),
// so honor the env override first, then probe known locations, and finally
// fall back to Puppeteer's bundled binary (used locally on macOS).
const resolveChromiumExecutablePath = (): string | undefined => {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/lib/chromium/chromium",
  ].filter((path): path is string => Boolean(path));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Nothing on disk — let Puppeteer use its bundled Chromium (returns undefined).
  return undefined;
};

export const generatePdfBufferFromHtml = async (
  html: string,
): Promise<Buffer> => {
  const executablePath = resolveChromiumExecutablePath();
  const puppeteer: PuppeteerModule = (await import("puppeteer")).default;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      // --disable-dev-shm-usage: containers default /dev/shm to 64MB, which
      //   starves Chromium and makes it hang mid-render. Write to /tmp instead.
      // --disable-gpu: no GPU in a headless container.
      // (Deliberately NOT using --single-process/--no-zygote: they crash
      //  Chromium on start on some Alpine builds, surfacing as a 500.)
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  } catch (error) {
    // Surface the real cause (missing/incompatible Chromium) instead of an
    // opaque 500. Logged by the global handler and returned to the client.
    const detail = error instanceof Error ? error.message : String(error);
    throw new InternalServerError(
      `Failed to launch Chromium for PDF generation (executablePath: ${executablePath ?? "bundled"}). ${detail}`,
    );
  }

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(PDF_RENDER_TIMEOUT_MS);

    // The HTML is fully self-contained (logo is an inline data URI, no external
    // fonts/CSS/scripts), so wait only for the DOM — "networkidle0" would add
    // needless idle-wait and can stall on stray requests.
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: PDF_RENDER_TIMEOUT_MS,
    });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      timeout: PDF_RENDER_TIMEOUT_MS,
      margin: {
        top: "16mm",
        right: "12mm",
        bottom: "16mm",
        left: "12mm",
      },
    });

    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
};
