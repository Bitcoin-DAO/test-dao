// End-to-end: closing a DAO. A funded 2-of-3 treasury on the mock chain; a close proposal passes,
// the closing round sweeps the balance to the destination, the receipt lands, the council signs the
// closing settings version, and every page says the DAO is closed.
const { chromium } = require('playwright');
const { writeDownWords } = require('./words.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');

const URL0 = 'http://localhost:4173/';
const OUT = __dirname + '/out';
const SHOTS = OUT + '/shots-close';
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

  log('Founding a 2-of-3 treasury and funding it');
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
  await open(f, '#/');
  await f.locator('.addr').waitFor({ timeout: 30000 });
  const addr0 = (await f.locator('.addr').innerText()).replace(/\s+/g, '');
  fs.writeFileSync(OUT + '/funded.json', JSON.stringify({ [addr0]: { value: 200000, txid: 'ce'.repeat(32) } }));

  log('A close proposal, voted by everyone');
  await open(f, '#/new');
  await f.getByLabel('Tipo di proposta').selectOption('close');
  await f.getByLabel('Titolo', { exact: true }).fill('Chiusura');
  await f.getByLabel('Testo vincolante').fill('Fine della prova: il saldo torna alla tesoreria di prova.');
  await f.getByLabel('Indirizzo che riceve tutto il saldo').fill(DEST);
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
  await a.waitForTimeout(3000); // the council phone publishes the count
  await open(f, `#/p/${pid}`);
  check(await seen(f.getByText('Approvata ✓')), 'close passed (two-thirds)');

  log('The closing round sweeps the treasury');
  await open(a, '#/council');
  await a.getByRole('link', { name: 'Prepara il giro di pagamenti' }).click();
  await a.getByRole('button', { name: 'Prepara la transazione' }).click();
  await a.getByText('Riepilogo').waitFor();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  await a.waitForURL(/#\/round\/[0-9a-f]{64}$/);
  const rid = a.url().split('/round/')[1];
  await open(B.page, `#/round/${rid}`);
  await B.page.getByRole('button', { name: 'Firma con la chiave di prova' }).click({ timeout: 20000 });
  await B.page.getByText('Firme sufficienti ✓').waitFor({ timeout: 20000 });
  await B.page.getByRole('button', { name: 'Trasmetti la transazione' }).click();
  check(await seen(B.page.getByText(/Sulla rete ✓/)), 'closing round on the network');
  const b = fs.readdirSync(OUT).find(x => x.startsWith('broadcast-'));
  const outs = JSON.parse(execFileSync('python3', ['-c', 'import sys,json\nfrom embit.transaction import Transaction\nfrom embit.networks import NETWORKS\nt=Transaction.parse(bytes.fromhex(json.load(open(sys.argv[1]))["hex"]))\nprint(json.dumps([[o.script_pubkey.address(NETWORKS["test"]), o.value] for o in t.vout]))', `${OUT}/${b}`]).toString());
  check(outs.length === 1 && outs[0][0] === DEST && outs[0][1] > 199000, `one output, the whole balance less the fee, to the destination (${outs.map(o => o.join(' ')).join(', ')})`);

  log('Receipt, then the closing settings version');
  check(await seen(a.getByText(/^Confermata nel blocco \d+\.$/), 90000) || (await open(a, `#/round/${rid}`), await seen(a.getByText(/^Confermata nel blocco \d+\.$/), 60000)), 'receipt after 3 confirmations');
  await councilAction(a, 'Pubblica la versione 2 delle regole');
  await councilAction(B.page, 'Approva la versione 2 delle regole');

  log('Closed everywhere');
  for (const [p, hash] of [[f, '#/'], [f, '#/proposals'], [C.page, '#/rules']]) {
    await open(p, hash);
    check(await seen(p.locator('.closedbar').getByText('UNO è chiusa')), `closed notice at the top of ${hash}`);
  }
  await open(f, '#/');
  await f.locator('.closedbar').waitFor();
  check(!(await f.getByRole('button', { name: 'Nuova proposta' }).count()), 'no new proposals offered');
  check(!(await f.getByText('Finanzia la tesoreria').count()), 'no funding offered');
  await open(f, '#/new');
  check(await seen(f.getByText('Niente più proposte, voti o pagamenti.')), 'the new-proposal page refuses');
  await shot(f, 'closed-home');

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
