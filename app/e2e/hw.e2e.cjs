// End-to-end: the SeedSigner QR test page. A real SeedSigner's key export (recorded frames) is read,
// the test wallet and PSBT are shown, and a PSBT signed outside the app (as the SeedSigner would, with
// test card A) comes back as UR parts and is recognised as card A's signature.
const { chromium } = require('playwright');
const fs = require('fs');
const { UR, UREncoder } = require('@ngraveio/bc-ur');
const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync } = require('@scure/bip39');
const { Transaction } = require('@scure/btc-signer');

const URL0 = 'http://localhost:4173/';
const OUT = __dirname + '/out';
const SHOTS = OUT + '/shots-hw';
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const check = (c, what) => { console.log(c ? '  ✓' : '  ✗', what); if (!c) failures++; };
const seen = (loc, timeout = 15000) => loc.first().waitFor({ timeout }).then(() => true, () => false);
const CARD_A_WORDS = 'process wrestle rigid evoke cash ancient adjust minor size meat puzzle glue';
const device = fs.readFileSync(__dirname + '/../src/core/fixtures/seedsigner-0.8.6-xpub-card-a.txt', 'utf8').trim();

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  pageerror', e.message));
  await p.goto(URL0 + '#/qrtest');
  await p.getByRole('heading', { name: 'SeedSigner QR test' }).waitFor({ timeout: 20000 });

  console.log('• A real SeedSigner key export (recorded frames, pasted)');
  await p.getByRole('button', { name: 'Scan a key' }).click();
  await p.getByText('The camera is not available').waitFor();
  await p.locator('.scanner textarea').fill(device.split('\n').slice(20).join('\n'));
  await p.locator('.scanner').getByRole('button', { name: 'Use' }).click();
  check(await seen(p.getByText('d3bdd580 · 48h/1h/0h/2h')), 'card A read from the device\'s frames');
  check(await seen(p.getByText('Card A')), 'named as card A');

  console.log('• Test wallet and PSBT');
  await p.getByRole('button', { name: 'Use the printed keys of test cards A, B, C' }).click();
  check(await seen(p.getByText(/^wsh\(sortedmulti\(2,\[d3bdd580/)), 'descriptor shown');
  await p.getByRole('button', { name: '/0/*' }).click();
  check(await seen(p.getByText(/\/0\/\*\)\)#[a-z0-9]{8}$/)), 'receive-only form with its checksum');
  const frames = new Set();
  for (let i = 0; i < 12; i++) { frames.add(await p.locator('section', { hasText: 'Transaction to sign' }).locator('span.mono').first().innerText()); await p.waitForTimeout(260); }
  check(frames.size >= 6, `PSBT QR animates (${[...frames].slice(0, 4).join(', ')}…)`);
  await p.screenshot({ path: `${SHOTS}/qrtest.png`, fullPage: true });

  console.log('• The signed PSBT comes back');
  const psbtB64 = await p.evaluate(() => (window).__lastTestPsbt);
  check(!!psbtB64, 'test PSBT available to the test');
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(CARD_A_WORDS), { private: 0x04358394, public: 0x043587cf });
  const tx = Transaction.fromPSBT(Buffer.from(psbtB64, 'base64'));
  for (let i = 0; i < tx.inputsLength; i++) tx.signIdx(master, i, [0x01]);
  // Trimmed as a SeedSigner returns it: the bare transaction and the signatures only.
  const trimmed = new Transaction({ allowUnknownOutputs: true });
  for (let i = 0; i < tx.outputsLength; i++) { const o = tx.getOutput(i); trimmed.addOutput({ script: o.script, amount: o.amount }); }
  for (let i = 0; i < tx.inputsLength; i++) { const x = tx.getInput(i); trimmed.addInput({ txid: x.txid, index: x.index, sequence: x.sequence, partialSig: x.partialSig }); }
  const signed = Buffer.from(trimmed.toPSBT(0));
  const cborBytes = Buffer.concat([Buffer.from([0x59, signed.length >> 8, signed.length & 255]), signed]);
  const enc = new UREncoder(new UR(cborBytes, 'crypto-psbt'), 100, 0, 10);
  const parts = Array.from({ length: enc.fragmentsLength + 8 }, () => enc.nextPart()).slice(2); // a couple missed, as a camera would
  await p.getByRole('button', { name: 'Scan the signed transaction' }).click();
  await p.getByText('The camera is not available').waitFor();
  await p.locator('.scanner textarea').fill(parts.join('\n'));
  await p.locator('.scanner').getByRole('button', { name: 'Use' }).click();
  const okSig = await seen(p.getByText('Valid signature from: A ✓'));
  if (!okSig) console.log('   page says:', (await p.locator('main').innerText()).slice(-400).replace(/\n+/g, ' | '), '| modal:', await p.locator('.scanner').count() ? (await p.locator('.scanner').innerText()).replace(/\n+/g, ' | ') : '-');
  check(okSig, 'card A\'s signature recognised');

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
