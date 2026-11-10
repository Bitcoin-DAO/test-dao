// End-to-end: discussion. An idea opens a thread, the author posts versions, members post, the author
// submits a version as a proposal, voting opens and the thread carries on. A second draft is withdrawn.
const { chromium } = require('playwright');
const { writeDownWords } = require('./words.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');

const URL0 = 'http://localhost:4173/';
const OUT = __dirname + '/out';
const SHOTS = OUT + '/shots-disc';
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

(async () => {
  const browser = await chromium.launch();
  const [A, B, C, F] = await Promise.all(['@anna', '@marco', '@luca', '@elena'].map(n => phone(browser, n)));

  log('Founding a 2-of-3 DAO');
  const codes = {};
  for (const [p, n, c] of [[A, '@anna', 1], [B, '@marco', 1], [C, '@luca', 1], [F, '@elena', 0]]) codes[n] = await signUp(p.page, n, !!c);
  const a = A.page;
  await a.goto(URL0 + '#/setup');
  await a.getByRole('button', { name: '2 · Consiglio' }).click();
  for (const n of ['@marco', '@luca']) {
    await a.getByRole('button', { name: 'Scansiona un membro del Consiglio' }).click();
    await paste(a, codes[n]);
    await a.getByRole('button', { name: 'Coincide: aggiungi' }).click();
  }
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
  const f = F.page;
  const b = B.page;

  log('An idea opens a thread at once');
  await open(f, '#/discussion');
  await f.getByRole('button', { name: 'Nuova idea' }).click();
  await f.getByLabel('Titolo', { exact: true }).fill('Volantini per il meetup');
  await f.getByLabel('Di che si tratta (facoltativo)').fill('Stampiamo dei volantini?');
  await f.getByRole('button', { name: 'Apri la discussione' }).click();
  await f.waitForURL(/#\/d\/[0-9a-f]{64}$/);
  const did = f.url().split('/d/')[1];
  check(await seen(f.getByText('Idea', { exact: true })), 'thread shows the idea');
  check(await seen(f.getByText(/Per presentarla come proposta servono tutti i campi/)), 'an idea cannot be submitted yet');

  log('Members post; the list shows what is new');
  await open(b, '#/');
  check(await seen(b.locator('.footer .dot')), 'footer shows unread discussion');
  await open(b, '#/discussion');
  check(await seen(b.getByText('novità: 1')), 'list shows the new thread');
  await b.getByText('Volantini per il meetup').click();
  await b.getByLabel('Il tuo messaggio').fill('Sì, 500 in A5. Preventivo: https://example.com/preventivo');
  await b.getByRole('button', { name: 'Pubblica il messaggio' }).click();
  check(await seen(b.locator('.post').getByText(/500 in A5/)), 'post shown in the timeline');
  check(await seen(b.locator('.post a[href="https://example.com/preventivo"]')), 'links in posts are clickable');
  check(!(await b.getByRole('button', { name: /Nuova versione/ }).count()), 'only the author adds versions');

  log('The author posts v2 with the proposal fields');
  await open(f, `#/d/${did}`);
  await f.getByRole('button', { name: 'Nuova versione (v2)' }).click();
  await f.getByLabel('Tipo di proposta').selectOption('payout');
  check(await f.getByLabel('Titolo', { exact: true }).inputValue() === 'Volantini per il meetup', 'v2 starts from v1');
  await f.getByLabel('Testo vincolante').fill('500 volantini A5 per il meetup.');
  await f.getByLabel('Nome del beneficiario').fill('Tipografia');
  await f.getByLabel('Indirizzo bitcoin del beneficiario').fill(DEST);
  await f.getByLabel('Importo in sats').fill('30000');
  await f.getByRole('button', { name: 'Pubblica la versione 2' }).click();
  await f.waitForURL(new RegExp(`#/d/${did}$`));
  check(await seen(f.locator('.version.pinned').getByText('v2')), 'v2 pinned as the current version');
  check(await seen(f.getByText(/Versione 1 pubblicata|Volantini per il meetup/)), 'v1 stays in the timeline');

  log('Submit v2: voting opens, versions freeze, the thread carries on');
  await f.getByRole('button', { name: 'Presenta la v2 come proposta' }).first().click();
  await f.locator('.dialog').getByRole('button', { name: 'Presenta' }).click();
  await f.waitForURL(/#\/p\/[0-9a-f]{64}$/);
  const pid = f.url().split('/p/')[1];
  check(await seen(f.getByText('v2', { exact: true })), 'proposal page names the version');
  check(await seen(f.getByRole('link', { name: '1 messaggi →' })), 'proposal page links the discussion');
  await f.getByRole('button', { name: 'Sì', exact: true }).click();
  await f.getByText('Il tuo voto: Sì.').waitFor({ timeout: 15000 });
  await f.getByRole('button', { name: 'Sì', exact: true }).click(); // the same choice again: nothing new is published
  await f.getByRole('button', { name: 'Astenuto', exact: true }).click();
  await f.getByText('Il tuo voto: Astenuto.').waitFor({ timeout: 15000 });
  await f.getByRole('button', { name: 'Sì', exact: true }).click();
  await f.getByText('Il tuo voto: Sì.').waitFor({ timeout: 15000 });
  await f.locator('details.card summary').click();
  check(await f.locator('details.card .list > div').filter({ hasText: /^Voto/ }).count() === 3, 'tapping the same choice again records nothing');
  check(await seen(f.getByText(/sostituito da un voto successivo, non contato/)), 'the record marks replaced votes as not counted');
  await open(f, `#/d/${did}`);
  check(await seen(f.getByText(/Presentata come proposta \(versione 2\)/)), 'thread says it was submitted');
  check(!(await f.getByRole('button', { name: /Nuova versione/ }).count()), 'no new versions after submission');
  await open(b, `#/d/${did}`);
  await b.getByLabel('Il tuo messaggio').fill('Votato sì.');
  await b.getByRole('button', { name: 'Pubblica il messaggio' }).click();
  check(await seen(b.locator('.post').getByText('Votato sì.')), 'posts continue during the vote');
  await open(f, `#/p/${pid}`);
  check(await seen(f.getByRole('link', { name: '2 messaggi →' })), 'proposal page counts the new post');

  log('A second draft is withdrawn and stays visible');
  await open(a, '#/discussion/new');
  await a.getByLabel('Titolo', { exact: true }).fill('Cambiare il quorum');
  await a.getByRole('button', { name: 'Apri la discussione' }).click();
  await a.waitForURL(/#\/d\/[0-9a-f]{64}$/);
  await a.getByRole('button', { name: 'Ritira la bozza' }).click();
  await a.locator('.dialog').getByRole('button', { name: 'Ritira la bozza' }).click();
  check(await seen(a.getByText(/Ritirata dall'autore/)), 'withdrawn draft says so');
  check(await seen(a.getByText('La bozza è ritirata: la discussione è chiusa e resta leggibile.')) && !(await a.getByLabel('Il tuo messaggio').count()), 'a withdrawn draft takes no new posts');
  await open(a, '#/discussion');
  check(await seen(a.getByText('Ritirata', { exact: true })), 'withdrawn draft stays in the list');

  log('Read-only for anyone with the link');
  await f.context().clearCookies();
  const viewer = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'it-IT' });
  const vp = await viewer.newPage();
  await vp.goto(URL0 + `#/d/${did}`);
  check(await seen(vp.locator('.post').getByText('Votato sì.')), 'a visitor reads the thread');
  check(await seen(vp.getByText('Solo i membri scrivono qui; tutti possono leggere.')), 'a visitor cannot post');
  await open(b, `#/d/${did}`);
  await b.locator('.post').first().waitFor();
  await shot(b, 'thread');
  await open(b, '#/discussion');
  await b.getByText('Ritirata', { exact: true }).waitFor();
  await shot(b, 'list');

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
