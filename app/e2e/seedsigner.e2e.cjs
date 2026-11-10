// End-to-end: founding with SeedSigner keys (v0.4.0 step 2). Three council members scan their SeedSigner's
// key export at sign-up (the device's recorded frames for card A, key-origin text for B and C); no phone key,
// no 12 words. The setup page shows where each key lives and refuses a card already on the council.
// Then (step 3) a payout waits for funds, is paid in a round signed "on the SeedSigner" (outside the app,
// with cards A and B, trimmed as the device returns it), broadcast, and checked with embit.
const { chromium } = require('playwright');
const { writeDownWords } = require('./words.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');

const URL0 = 'http://localhost:4173/';
const OUT = __dirname + '/out';
const SHOTS = OUT + '/shots-hwfound';
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(OUT + '/funded.json', '{}');
for (const f of fs.readdirSync(OUT)) if (f.startsWith('broadcast-')) fs.unlinkSync(`${OUT}/${f}`);
const RECIPIENT = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const ALL = [];
let failures = 0;
const log = (...a) => console.log('•', ...a);
const check = (cond, what) => {
  console.log(cond ? '  ✓' : '  ✗', what);
  if (!cond) failures++;
};
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const seen = (loc, timeout = 30000) => loc.first().waitFor({ timeout }).then(() => true, () => false);

async function phone(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'it-IT', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  page.on('pageerror', e => console.log(`  [${label}] pageerror`, e.message));
  page.on('dialog', d => d.accept());
  ALL.push({ page, label });
  return { ctx, page, label };
}
const copied = page => page.evaluate(() => navigator.clipboard.readText());
async function open(page, hash) {
  await page.goto(URL0 + hash);
  await page.reload();
}
async function paste(page, code) {
  await page.getByText('La fotocamera non è disponibile').waitFor();
  await page.locator('.scanner textarea').fill(code);
  await page.getByRole('button', { name: 'Usa', exact: true }).click();
}
async function signUp(page, name, council, wrongWords = false) {
  await page.goto(URL0 + '#/founder');
  await page.getByRole('textbox').fill(name);
  if (council) await page.getByLabel('Chiedo un posto nel Consiglio').check();
  await page.getByLabel(/Ho almeno 18 anni/).check();
  await page.getByRole('button', { name: 'Avanti' }).click();
  if (council) await page.getByLabel(/Su questo telefono/).check();
  await page.getByRole('button', { name: 'Crea con impronta o volto' }).click();
  if (council) await writeDownWords(page, { tryWrong: wrongWords });
  await page.getByRole('button', { name: 'Copia il codice' }).click();
  return copied(page);
}


const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
async function councilAction(page, buttonName) {
  await open(page, '#/council');
  const b = page.getByRole('button', { name: buttonName, exact: true });
  await b.waitFor({ timeout: 20000 });
  await b.click();
  await b.waitFor({ state: 'detached', timeout: 20000 });
}


const CARDS = {
  A: `[d3bdd580/48h/1h/0h/2h]tpubDFKVE4hAcCsmYyXX8mURCAE3smjoLhyqGH5CtJjgyhBBQR9VopPxmK24XsjmbG4XTvHoQo73WBRnC2aLuG5mbUPemuyvUBJUEeDMM5nyG8e`,
  B: `[49c2d730/48h/1h/0h/2h]tpubDFUxuLmA93bTzumuAt8nqakLsDcNXk5ZB2mwZv1SxwX7u6THfmvdqBRrrBdkmCeLfQPcs8Rx3kEYsAZFYvQjSeJ6V1Q6dMn7Z7TzJHswBXU`,
  C: `[ec03225a/48h/1h/0h/2h]tpubDFCfvs2SLPX7J8JKkpaRQ6XKH2EksYsLNPAsucb9KDunGYemVrAm8VL4kNJ5Gm6icC3mBUinvirVXF5ZMatoCHuqmpAYKcmKUTLT7pMyXxE`,
};
const { UR, UREncoder } = require('@ngraveio/bc-ur');
const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync } = require('@scure/bip39');
const { Transaction } = require('@scure/btc-signer');
const WORDS = {
  A: 'process wrestle rigid evoke cash ancient adjust minor size meat puzzle glue',
  B: 'tone define nominee garage idea web soul pizza luggage window tent loud',
};
/** What a SeedSigner does with a PSBT and a loaded card: sign, trim, show as animated UR parts. */
function deviceSign(psbtB64, card) {
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(WORDS[card]), { private: 0x04358394, public: 0x043587cf });
  const tx = Transaction.fromPSBT(Buffer.from(psbtB64, 'base64'));
  for (let i = 0; i < tx.inputsLength; i++) tx.signIdx(master, i, [0x01]);
  const trimmed = new Transaction({ allowUnknownOutputs: true });
  for (let i = 0; i < tx.outputsLength; i++) { const o = tx.getOutput(i); trimmed.addOutput({ script: o.script, amount: o.amount }); }
  for (let i = 0; i < tx.inputsLength; i++) { const x = tx.getInput(i); trimmed.addInput({ txid: x.txid, index: x.index, sequence: x.sequence, partialSig: x.partialSig }); }
  const signed = Buffer.from(trimmed.toPSBT(0));
  const enc = new UREncoder(new UR(Buffer.concat([Buffer.from([0x59, signed.length >> 8, signed.length & 255]), signed]), 'crypto-psbt'), 100, 0, 10);
  return Array.from({ length: enc.fragmentsLength + 8 }, () => enc.nextPart()).slice(1).join('\n');
}
async function signOnDevice(page, rid, card, expectOk = true) {
  await open(page, `#/round/${rid}`);
  await page.getByText(/Firma con il SeedSigner/).waitFor({ timeout: 20000 });
  // The PSBT the device would scan from the animated QR (the page also offers it for other wallets).
  await page.getByRole('button', { name: /Firma con un altro wallet/ }).click();
  await page.getByRole('button', { name: 'Copia la PSBT' }).click();
  const psbt = await copied(page);
  await page.getByRole('button', { name: 'Fatto, avanti' }).click();
  await page.getByRole('button', { name: 'Ho firmato sul SeedSigner' }).click();
  await page.getByRole('button', { name: 'Scansiona la transazione firmata' }).click();
  await paste(page, deviceSign(psbt, card));
  if (expectOk) await page.getByText('Hai firmato ✓').waitFor({ timeout: 20000 });
  return psbt;
}
const DEVICE_A = fs.readFileSync(__dirname + '/../src/core/fixtures/seedsigner-0.8.6-xpub-card-a.txt', 'utf8').trim().split('\n').slice(5).join('\n');
async function signUpHw(page, name, scanned) {
  await page.goto(URL0 + '#/founder');
  await page.getByRole('textbox').fill(name);
  await page.getByLabel('Chiedo un posto nel Consiglio').check();
  await page.getByLabel(/Ho almeno 18 anni/).check();
  await page.getByRole('button', { name: 'Avanti' }).click();
  check(await page.getByLabel(/Su un SeedSigner/).isChecked(), `${name}: SeedSigner is the default`);
  check(await page.getByRole('button', { name: 'Crea con impronta o volto' }).isDisabled(), `${name}: no sign-up before the key is scanned`);
  await page.getByRole('button', { name: 'Scansiona la chiave dal SeedSigner' }).click();
  await paste(page, scanned);
  await page.getByText(/48h\/1h\/0h\/2h ✓/).waitFor();
  await page.getByRole('button', { name: 'Crea con impronta o volto' }).click();
  await page.getByRole('button', { name: 'Copia il codice' }).click({ timeout: 15000 });
  check(!(await page.getByText('Scrivi le 12 parole').count()), `${name}: no 12-word step`);
  return copied(page);
}

(async () => {
  const browser = await chromium.launch();
  const [A, B, C, D, F] = await Promise.all(['@anna', '@marco', '@luca', '@dora', '@elena'].map(n => phone(browser, n)));

  log('Council sign-ups with SeedSigner keys');
  const codes = {};
  codes['@anna'] = await signUpHw(A.page, '@anna', DEVICE_A);
  check(JSON.parse(codes['@anna'].slice(codes['@anna'].indexOf('{'))).council.fingerprint === 'd3bdd580', 'the device\'s frames give card A\'s key');
  codes['@marco'] = await signUpHw(B.page, '@marco', CARDS.B);
  codes['@luca'] = await signUpHw(C.page, '@luca', CARDS.C);
  codes['@dora'] = await signUpHw(D.page, '@dora', CARDS.B); // card B again, by mistake
  codes['@elena'] = await signUp(F.page, '@elena', false);
  const a = A.page;
  await a.goto(URL0 + '#/setup');
  await a.getByRole('button', { name: '2 · Consiglio' }).click();
  for (const n of ['@marco', '@luca']) {
    await a.getByRole('button', { name: 'Scansiona un membro del Consiglio' }).click();
    await paste(a, codes[n]);
    await a.getByRole('button', { name: 'Coincide: aggiungi' }).click();
  }
  await a.getByRole('button', { name: 'Scansiona un membro del Consiglio' }).click();
  await paste(a, codes['@dora']);
  check(await seen(a.getByText(/La chiave della tesoreria 49c2d730 è già nel Consiglio/)), 'a card already on the council is refused');
  check(await a.locator('.chip', { hasText: 'SeedSigner' }).count() === 3, 'each council key shown as on a SeedSigner');
  check(!(await a.getByText(/mescola chiavi/).count()), 'no mixed-keys warning');
  check(await seen(a.getByText('2 di 3')), '2 of 3');
  await a.getByRole('button', { name: '3 · Fondatori' }).click();
  await a.getByRole('button', { name: 'Scansiona un fondatore' }).click();
  await paste(a, codes['@elena']);
  await a.getByRole('button', { name: 'Coincide: aggiungi' }).click();
  await a.getByRole('button', { name: '4 · Pubblica' }).click();
  await a.getByRole('button', { name: 'Firma e pubblica' }).click();
  await a.getByText('Pubblicate ✓').waitFor({ timeout: 20000 });
  await open(B.page, '#/founder');
  await B.page.getByRole('button', { name: 'Approva e firma' }).click();
  for (const p of [A, B, C, F]) {
    await open(p.page, '#/founder');
    await p.page.getByRole('button', { name: 'Proteggi la chiave e continua' }).click({ timeout: 20000 });
    await p.page.getByText('Stampa la tua tessera d\'identità').waitFor({ timeout: 20000 });
  }

  log('After founding');
  await open(a, '#/profile');
  check(await seen(a.getByText(/È sul tuo SeedSigner e sulla sua tessera SeedQR \(impronta d3bdd580\)/)), 'profile: the key is on the SeedSigner');
  check(!(await a.getByText(/Scrivi le 12 parole/).count()) && !(await a.getByText(/Questo telefono non ha la tua chiave/).count()), 'profile: no words to write or type');
  await open(a, '#/council');
  await a.getByRole('heading', { name: /Consiglio/ }).first().waitFor();
  check(!(await a.getByText(/Prima di firmare, scrivi le 12 parole/).count()) && !(await a.getByText(/Questo telefono non ha la tua chiave/).count()), 'council page: no words warning');
  await open(F.page, '#/');
  await F.page.locator('.addr').waitFor({ timeout: 30000 });
  const addr0 = (await F.page.locator('.addr').innerText()).replace(/\s+/g, '');
  const fromEmbit = execFileSync('python3', ['-c', `
from embit.descriptor import Descriptor
from embit.networks import NETWORKS
d=Descriptor.from_string("wsh(sortedmulti(2,${CARDS.A}/0/*,${CARDS.B}/0/*,${CARDS.C}/0/*))")
print(d.derive(0).address(NETWORKS["test"]))`]).toString().trim();
  check(addr0 === fromEmbit, `treasury address matches embit's for cards A, B, C (${addr0})`);
  await open(a, '#/profile');
  await a.getByText(/È sul tuo SeedSigner/).waitFor();
  await shot(a, 'profile');

  log('A payout before the treasury holds anything');
  const f = F.page;
  await open(f, '#/new');
  await f.getByLabel('Titolo', { exact: true }).fill('Volantini');
  await f.getByLabel('Testo vincolante').fill('500 volantini per il meetup.');
  await f.getByLabel('Nome del beneficiario').fill('Tipografia');
  await f.getByLabel('Indirizzo bitcoin del beneficiario').fill(DEST);
  await f.getByLabel('Importo in sats').fill('30000');
  await f.getByLabel(/Sono io il beneficiario/).check();
  await f.getByRole('button', { name: 'Firma e pubblica' }).click();
  await f.waitForURL(/#\/p\/[0-9a-f]{64}$/);
  const pid = f.url().split('/p/')[1];
  for (const p of [A, B, C, F]) {
    await open(p.page, `#/p/${pid}`);
    await p.page.getByRole('button', { name: 'Sì', exact: true }).click();
    await p.page.getByText('Il tuo voto: Sì.').waitFor({ timeout: 15000 });
  }
  log('Waiting for the close of the vote (~2 min)');
  await new Promise(r => setTimeout(r, 135000));
  await open(a, '#/council');
  await a.waitForTimeout(3000);
  await open(a, '#/');
  await a.locator('.balance').filter({ hasText: /\d/ }).waitFor({ timeout: 30000 });
  await open(a, '#/council');
  check(await seen(a.getByText(/1 pagamenti approvati aspettano fondi: mancano circa/)), 'council page: waiting for funds, no round offered');
  check(!(await a.getByRole('link', { name: 'Prepara il giro di pagamenti' }).count()), 'no "prepare" while short of funds');
  await open(a, '#/round/new');
  check(await seen(a.getByText(/Fondi insufficienti: in tesoreria ci sono 0 sats/), 30000), 'prepare page says so at once');
  check(await a.getByRole('button', { name: 'Prepara la transazione' }).isDisabled(), 'and builds nothing');

  log('Funded: the round, signed on the SeedSigner with cards A and B');
  fs.writeFileSync(OUT + '/funded.json', JSON.stringify({ [addr0]: { value: 100000, txid: 'cd'.repeat(32) } }));
  await new Promise(r => setTimeout(r, 6000));
  await open(a, '#/round/new');
  await a.getByRole('button', { name: 'Prepara la transazione' }).click({ timeout: 30000 });
  await a.getByText('Riepilogo').waitFor();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  await a.waitForURL(/#\/round\/[0-9a-f]{64}$/);
  const rid = a.url().split('/round/')[1];
  check(await seen(a.getByText('Firme: 0 di 2')), 'no signature yet: nothing signs on the phone');
  await a.getByText(/Firma con il SeedSigner/).waitFor();
  const qrText = await a.locator('svg.qr').first().getAttribute('aria-label');
  check(await seen(a.getByText('Carica il portafoglio della tesoreria')), 'step 1: load the treasury wallet (descriptor QR)');
  await signOnDevice(a, rid, 'A');
  check(await seen(a.getByText('Firme: 1 di 2')), 'card A\'s signature, from the trimmed PSBT, published');
  const mb = B.page;
  const psbtB = await signOnDevice(mb, rid, 'A', false); // @marco's phone, but card A loaded by mistake
  check(await seen(mb.getByText(/Nessuna firma valida della tua chiave \(49c2d730\)/)), 'wrong card: refused, says which key is needed');
  await mb.locator('.scanner').count().then(n => n && mb.locator('.scanner').getByRole('button', { name: 'Annulla' }).click());
  await mb.getByRole('button', { name: 'Scansiona la transazione firmata' }).click();
  await paste(mb, deviceSign(psbtB, 'B'));
  await mb.getByText('Hai firmato ✓').waitFor({ timeout: 20000 });
  check(await seen(mb.getByText('Firme sufficienti ✓')), 'card B: enough signatures');
  await mb.getByRole('button', { name: 'Trasmetti la transazione' }).click();
  check(await seen(mb.getByText(/Sulla rete ✓/)), 'broadcast');
  const bf = fs.readdirSync(OUT).find(x => x.startsWith('broadcast-'));
  const outp = execFileSync('python3', [__dirname + '/embit-check.py', `${OUT}/${bf}`]).toString();
  check(/ALL OK/.test(outp), 'both SeedSigner signatures verify with embit');
  await shot(mb, 'round');

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const { page, label } of ALL) {
    try {
      await page.screenshot({ path: `${SHOTS}/fail-${label.replace(/[^a-z0-9-]/gi, '')}.png`, fullPage: true });
      console.log(`--- ${label}:`, (await page.locator('main').innerText()).slice(0, 700).replace(/\n+/g, ' | '));
    } catch {}
  }
  process.exit(1);
});
