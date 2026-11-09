// The camera path: a fake camera showing an identity card QR; restore must read it via jsQR/BarcodeDetector.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
(async () => {
  // 1. Draw the card QR from the founding run into a still image, then a fake camera stream.
  const card = fs.readFileSync(__dirname + '/out/card.txt', 'utf8').trim();
  const qrcode = require('qrcode-generator');
  const qr = qrcode(0, 'M'); qr.addData(card, 'Alphanumeric'); qr.make();
  const n = qr.getModuleCount(), scale = 8, size = (n + 8) * scale;
  const { PNG } = require('pngjs');
  const png = new PNG({ width: 640, height: 480 });
  png.data.fill(255);
  const ox = (640 - size) / 2 | 0, oy = (480 - size) / 2 | 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c))
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = ((oy + (r + 4) * scale + y) * 640 + ox + (c + 4) * scale + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
    }
  fs.writeFileSync(__dirname + '/out/card.png', PNG.sync.write(png));
  execSync(`ffmpeg -y -loglevel error -loop 1 -i ${__dirname}/out/card.png -t 3 -pix_fmt yuv420p ${__dirname}/out/card.y4m`);

  // 2. A new phone whose camera sees the card.
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${__dirname}/out/card.y4m`] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'it-IT', permissions: ['camera'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://localhost:4173/#/restore');
  await page.getByRole('button', { name: 'Scansiona la tessera' }).click();
  const bd = await page.evaluate(() => 'BarcodeDetector' in window);
  await page.getByText('Sei tu?').waitFor({ timeout: 15000 });
  console.log(`  ✓ camera read the card (BarcodeDetector: ${bd})`);
  await browser.close();
})().catch(e => { console.error('  ✗', e.message); process.exit(1); });
