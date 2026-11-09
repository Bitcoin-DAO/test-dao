import { useState } from 'preact/hooks';
import { signIn, useApp } from '../app';
import { t } from '../i18n';
import { passkeysAvailable } from '../lib/passkey';
import { Footer, Header, errText, go } from './parts';

export function Join() {
  const app = useApp();
  const dao = app.site!.name;
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!app.daoId) {
    const pending = app.pending;
    return (
      <>
        <Header />
        <main>
          <h1>{t('join.title', { dao })}</h1>
          <p class="lead">{t('join.intro')}</p>
          <div class="note"><strong>{t('fs.mode')}</strong> {t('join.notFounded', { dao })}</div>
          <button type="button" class="btn primary" onClick={() => go('/founder')}>{t('join.founderSignup')}</button>
          {pending?.council && <button type="button" class="btn secondary" onClick={() => go('/setup')}>{t('join.setup')}</button>}
        </main>
      </>
    );
  }

  const doSignIn = async () => {
    setMsg(undefined);
    if (!passkeysAvailable()) return setMsg(t('error.noPasskeys'));
    setBusy(true);
    try {
      const r = await signIn();
      if (r === 'ok') go('/');
      else setMsg(r === 'no-prf' ? t('signin.noPrf') : t('signin.notFound', { dao }));
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header />
      <main>
        <h1>{t('join.title', { dao })}</h1>
        {app.pending && app.pending.role !== 'founder' && (
          // A sign-up or key replacement is under way on this phone: its page is where it finishes, not Sign in.
          <a class="note" href={app.pending.role === 'rekey' ? '#/lost' : '#/candidate'}>
            <strong>{t(app.pending.role === 'rekey' ? 'join.pendingRekey' : 'join.pendingCand', { name: app.pending.name })}</strong> {t('join.pendingGo')}
          </a>
        )}
        <p class="lead">{t('join.intro')}</p>
        <div class="note"><strong>{t('join.howTitle')}</strong> {t('join.how')}</div>
        <button type="button" class="btn primary" onClick={() => go('/candidate')}>{t('join.become')}</button>
        <button type="button" class="btn secondary" disabled={busy} onClick={doSignIn}>{t('join.signin')}</button>
        {msg && <p class="warnbox">{msg}</p>}
        <button type="button" class="btn link" onClick={() => go('/restore')}>{t('join.restore')}</button>
        <button type="button" class="btn link" onClick={() => go('/lost')}>{t('join.lost')}</button>
        <button type="button" class="btn link" onClick={() => go('/')}>{t('join.view')}</button>
      </main>
      <Footer />
    </>
  );
}
