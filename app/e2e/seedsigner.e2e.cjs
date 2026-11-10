// End-to-end: founding with SeedSigner keys (v0.4.0 step 2). Three council members scan their SeedSigner's
// key export at sign-up (the device's recorded frames for card A, key-origin text for B and C); no phone key,
// no 12 words. The setup page shows where each key lives and refuses a card already on the council.
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
  const { execFileSync } = require('child_process');
  const fromEmbit = execFileSync('python3', ['-c', `
from embit.descriptor import Descriptor
from embit.networks import NETWORKS
d=Descriptor.from_string("wsh(sortedmulti(2,${CARDS.A}/0/*,${CARDS.B}/0/*,${CARDS.C}/0/*))")
print(d.derive(0).address(NETWORKS["test"]))`]).toString().trim();
  check(addr0 === fromEmbit, `treasury address matches embit's for cards A, B, C (${addr0})`);
  await open(a, '#/profile');
  await a.getByText(/È sul tuo SeedSigner/).waitFor();
  await shot(a, 'profile');

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
