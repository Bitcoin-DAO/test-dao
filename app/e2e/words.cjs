// Council sign-up on a trial network: write down the treasury key's 12 words and type three back.
async function writeDownWords(page, { tryWrong = false } = {}) {
  await page.getByText('Scrivi le 12 parole della tua chiave della tesoreria').waitFor({ timeout: 15000 });
  const words = (await page.locator('ol.words li').allInnerTexts()).map(w => w.trim());
  await page.getByRole('button', { name: 'Le ho scritte' }).click();
  const labels = await page.locator('label.field').allInnerTexts();
  const positions = labels.map(l => Number((l.match(/Parola n\. (\d+)/) || [])[1])).filter(Boolean);
  const inputs = page.locator('label.field input');
  if (tryWrong) {
    for (let i = 0; i < positions.length; i++) await inputs.nth(i).fill('zebra');
    await page.getByRole('button', { name: 'Controlla' }).click();
    await page.getByText('Non corrispondono').waitFor();
  }
  for (let i = 0; i < positions.length; i++) await inputs.nth(i).fill(words[positions[i] - 1]);
  await page.getByRole('button', { name: 'Controlla' }).click();
  return { words, positions };
}
module.exports = { writeDownWords };
