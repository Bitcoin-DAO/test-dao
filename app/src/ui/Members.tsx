import { useApp } from '../app';
import { fmtDate, t } from '../i18n';
import { formatShortCode, shortCode } from '../core/shortcode';
import { Footer, Header } from './parts';

export function Members() {
  const app = useApp();
  const members = app.dao?.members ?? [];
  const council = members.filter(m => m.council);
  const founders = new Set((app.dao?.rosters[0]?.content.members ?? []).map(m => m.key));
  return (
    <>
      <Header />
      <main>
        <h1>{t('members.title')}</h1>
        <p class="small">{t('members.count', { n: members.length, c: council.length })}</p>
        <p class="small">{t('members.version', { v: app.dao!.rosters[app.dao!.rosters.length - 1].content.version })}{app.dao!.pendingRoster.length ? ` · ${t('members.pending', { n: app.dao!.pendingRoster.length })}` : ''}</p>
        <div class="card list">
          {[...council, ...members.filter(m => !m.council)].map(m => (
            <div class="row" style="align-items:flex-start">
              <div class="stack" style="gap:4px">
                <strong>{m.name}{m.key === app.me?.key ? ` (${t('members.you')})` : ''}</strong>
                <span class="small">
                  {m.council && <span class="chip teal">{t('members.council')}</span>} {founders.has(m.person) && <span class="chip">{t('members.founder')}</span>}{' '}
                  {m.verified === 'remote' ? t('members.remote') : t('members.inPerson')} · {fmtDate(m.since)}
                </span>
              </div>
              <span class="mono small">{formatShortCode(shortCode(m.key))}</span>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
