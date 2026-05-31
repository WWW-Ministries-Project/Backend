import puppeteer from "puppeteer";
import { readFileSync } from "fs";
import { join } from "path";

// Read and cache all logo assets at module init time (sync)
const assetDir = join(process.cwd(), "src", "assets");

const mainLogoB64 = `data:image/svg+xml;base64,${readFileSync(
  join(assetDir, "main-logo.svg")
).toString("base64")}`;

const hillcityLogoB64 = `data:image/png;base64,${readFileSync(
  join(assetDir, "hillcity-logo.png")
).toString("base64")}`;

// churchName.svg and ministries.svg are inlined as SVG strings (currentColor-aware)
// so we embed them as base64 SVG data URIs
const churchNameB64 = `data:image/svg+xml;base64,${readFileSync(
  join(assetDir, "churchName.svg")
).toString("base64")}`;

const ministriesB64 = `data:image/svg+xml;base64,${readFileSync(
  join(assetDir, "ministries.svg")
).toString("base64")}`;

export interface CertificateData {
  recipientFullName: string;
  programTitle: string;
  completionDate: string;
  issueDate: string;
  certificateNumber: string;
  verificationUrl: string;
  qrCodeDataUrl: string;
}

function buildHtml(data: CertificateData): string {
  const description = `In recognition of active participation and successful engagement in ${
    data.programTitle ? `${data.programTitle} program` : "the program"
  }. This certificate is awarded to acknowledge your commitment, learning, and meaningful contribution throughout the duration of the program.`;

  const issueDate = new Date(data.issueDate).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Matches CertificateLogos → ChurchLogo (show=true) + separator + hillcity logo
  // ChurchLogo renders: main-logo img + churchName SVG + ministries SVG (stacked in a flex col)
  // CertificateLogos wraps ChurchLogo with [&_img]:h-14 gap-2.5, plus the hillcity logo h-14 w-14
  const logoHtml = `
    <div class="flex items-center justify-center gap-4 text-primary">
      <!-- ChurchLogo with show=true -->
      <div class="flex items-center gap-2.5">
        <div>
          <img src="${mainLogoB64}" alt="Worldwide Word Ministries logo" style="height:56px;width:auto;">
        </div>
        <div class="flex flex-col gap-1.5 text-primary" style="color:rgb(8,13,45);">
          <span class="leading-none">
            <img src="${churchNameB64}" alt="Worldwide Word" style="display:block;height:11px;width:auto;filter:brightness(0) saturate(100%) invert(8%) sepia(58%) saturate(834%) hue-rotate(203deg) brightness(98%) contrast(106%);">
          </span>
          <span class="leading-none">
            <img src="${ministriesB64}" alt="Ministries" style="display:block;height:6px;width:auto;filter:brightness(0) saturate(100%) invert(8%) sepia(58%) saturate(834%) hue-rotate(203deg) brightness(98%) contrast(106%);">
          </span>
        </div>
      </div>
      <!-- Separator -->
      <span style="font-weight:300;color:rgba(8,13,45,0.4);font-size:1.125rem;">|</span>
      <!-- Hillcity logo -->
      <img src="${hillcityLogoB64}" alt="Hillcity logo" style="height:56px;width:56px;object-fit:contain;">
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@300;400;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: 'rgb(8 13 45)',
        secondary: 'rgb(154 93 26)',
        lightGray: 'rgb(216 218 229)',
        primaryGray: 'rgb(75 85 99)',
        lightest: 'rgb(44 56 119)',
        lighter: 'rgb(26 34 85)',
      },
      fontFamily: { sans: ['"Work Sans"', 'sans-serif'] }
    }
  }
}
</script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 1123px; height: 794px; font-family: "Work Sans", sans-serif; }
</style>
</head>
<body>
<div class="relative bg-white shadow-2xl overflow-hidden drop-shadow-sm" style="width:1123px;height:794px;">
  <div class="absolute inset-6 border-2 border-primary bg-white">
    <div class="relative w-full h-full">

      <!-- Left decorative circles -->
      <div class="absolute overflow-hidden" style="left:-40px;top:-32px;height:100%;width:192px;">
        <div class="absolute rounded-[6vw] bg-gradient-to-br from-lightGray to-secondary drop-shadow-xl shadow-xl border-2"
             style="transform:translateX(-80px) rotate(-45deg);left:-96px;top:80px;width:288px;height:288px;border-color:rgb(216 218 229);"></div>
        <div class="absolute rounded-[6vw] bg-gradient-to-bl from-lightest to-primary drop-shadow-xl shadow-xl border-2 border-white"
             style="transform:translateX(-36px) rotate(-45deg);left:-144px;top:0;width:288px;height:288px;"></div>
      </div>

      <!-- Right decorative circles -->
      <div class="absolute overflow-hidden" style="right:-40px;top:-32px;height:100%;width:192px;">
        <div class="absolute rounded-[6vw] bg-gradient-to-tl from-lightGray to-secondary drop-shadow-xl shadow-xl border-2"
             style="transform:translateX(80px) rotate(-45deg);right:-96px;top:80px;width:288px;height:288px;border-color:rgb(216 218 229);"></div>
        <div class="absolute rounded-[6vw] bg-gradient-to-tl from-lightest to-primary drop-shadow-xl shadow-xl border-2 border-white"
             style="transform:translateX(36px) rotate(45deg);right:-144px;top:0;width:288px;height:288px;"></div>
      </div>

      <!-- Main content -->
      <div class="relative z-50 flex flex-col items-center justify-center h-full px-16 py-16">

        <!-- Logo + title section -->
        <div class="text-center mb-6">
          <div class="rounded-full flex items-center justify-center mb-4">
            ${logoHtml}
          </div>

          <div class="text-5xl tracking-[0.3em] text-primary mb-2 pb-2" style="font-family:serif;">CERTIFICATE</div>

          <div class="flex items-center justify-center gap-4 my-6 pb-6">
            <div class="h-px w-24 bg-lightGray"></div>
            <div class="text-sm tracking-[0.2em] text-primaryGray uppercase">OF Participation</div>
            <div class="h-px w-24 bg-lightGray"></div>
          </div>

          <p class="text-xs tracking-wider text-primaryGray">THIS CERTIFICATE IS PROUDLY PRESENTED TO</p>
        </div>

        <!-- Recipient name -->
        <div class="mb-6">
          <h2 class="text-4xl text-center text-primary" style="font-family:serif;">${escapeHtml(data.recipientFullName)}</h2>
        </div>

        <!-- Description -->
        <div class="max-w-2xl mb-10">
          <p class="text-center text-sm leading-relaxed text-primaryGray">${escapeHtml(description)}</p>
        </div>

        <!-- Signatures row -->
        <div class="w-full max-w-2xl flex justify-between items-end mt-auto mb-6 pt-6">
          <div class="flex flex-col items-center">
            <div class="min-w-40 border-b border-lightGray mb-2 pb-2 text-center">Prophet John Anokye</div>
            <p class="text-sm tracking-wider text-primaryGray">Prelate</p>
          </div>

          <div class="relative">
            <div class="w-16 h-16 rounded-full bg-gradient-to-br from-lightest to-lighter flex items-center justify-center shadow-lg"></div>
          </div>

          <div class="flex flex-col items-center">
            <div class="min-w-40 border-b border-lightGray mb-2 pb-2 text-center">${escapeHtml(issueDate)}</div>
            <p class="text-sm tracking-wider text-primaryGray">Date issued</p>
          </div>
        </div>

        <!-- Bottom row -->
        <div class="w-full flex items-center justify-between gap-6">
          <div class="text-left">
            <p class="text-[11px] tracking-[0.2em] text-primaryGray uppercase">Certificate Number</p>
            <p class="mt-2 text-sm font-semibold text-primary">${escapeHtml(data.certificateNumber)}</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="rounded-xl bg-white p-2 shadow-sm" style="border:1px solid rgba(216,218,229,0.7);">
              <img src="${data.qrCodeDataUrl}" alt="QR code for certificate ${escapeHtml(data.certificateNumber)}" style="height:64px;width:64px;">
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function generateCertificatePdf(
  data: CertificateData
): Promise<Buffer> {
  const html = buildHtml(data);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 850 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Wait for all fonts to finish loading
    await page.evaluateHandle("document.fonts.ready");

    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
