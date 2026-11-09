// Come back with the identity card (protocol 1.7).
import { useState } from 'preact/hooks';
import { restoreFromCard, useApp } from '../app';
import { fmtDate, t } from '../i18n';
import { parseCard, pubkeyOf } from '../core/identity';
import type { Member } from '../core/state';
import { Header, PrintCard, ScanModal, ShortCode, errText, go } from './parts';

type Step = 'address' | 'scan' | 'who' | 'passkey' | 'done';

export function Restore() {
  const app = useApp();
  const site = app.site!;
  const dao = site.name;
  const [step, setStep] = useState<Step>('address');
  const [secret, setSecret] = useState<string>();
  const [member, setMember] = useState<Member>();
  const [msg, setMsg] = useState<string>();
  const [local, setLocal] = useState(false);
  const [busy, setBusy] = useState(false);

  const here = location.origin + location.pathname.replace(/\/(index\.html)?$/, '');
  const onSite = here === site.site.replace(/\/$/, '');

  const scanned = (text: string) => {
    const r = parseCard(text, app.daoId);
    if (!r.ok) {
      setStep('address');
      setMsg(r.reason === 'other-dao' ? t('restore.wrongDao') : t('restore.badCard'));
      return;
    }
    const m = app.dao?.members.find(x => x.key === pubkeyOf(r.secret));
    if (!m) {
      setStep('address');
      setMsg(t('restore.notMember', { dao }));
      return;
    }
    setSecret(r.secret);
    setMember(m);
    setStep('who');
  };

  const makePasskey = async () => {
    setMsg(undefined);
    setBusy(true);
    try {
      const r = await restoreFromCard(secret!, member!.name);
      setLocal(r === 'local');
      setStep('done');
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header sub={t('restore.title')} />
      <main>
        {(step === 'address' || step === 'scan') && (
          <>
            <h1>{t('restore.title')}</h1>
            <p class="lead">{t('restore.intro')}</p>
            <div class="card">
              <h3>{t('restore.address', { dao })}</h3>
              {onSite ? <p class="ok">{t('restore.addrOk', { dao })}</p> : <p class="warn">{t('restore.addrWarn', { dao, site: site.site })}</p>}
              <p class="mono">{site.site.replace(/^https:\/\//, '')}</p>
              <p class="small">{t('restore.only')}</p>
            </div>
            {msg && <p class="warnbox">{msg}</p>}
            <button type="button" class="btn primary" disabled={!app.daoId} onClick={() => (setMsg(undefined), setStep('scan'))}>{t('restore.scan')}</button>
            <p class="small">{t('restore.noCard')}</p>
          </>
        )}
        {step === 'scan' && <ScanModal parse={x => x} onResult={scanned} onCancel={() => setStep('address')} />}
        {step === 'who' && member && (
          <>
            <h1>{t('restore.whoTitle')}</h1>
            <div class="card" style="align-items:center">
              <h2>{member.name}</h2>
              <span class="small">{t('restore.since', { date: fmtDate(member.since) })}</span>
              <ShortCode pubkey={member.key} />
            </div>
            <p class="small">{t('restore.checkCode')}</p>
            <button type="button" class="btn primary" onClick={() => setStep('passkey')}>{t('restore.yes')}</button>
            <button type="button" class="btn secondary" onClick={() => (setSecret(undefined), setMember(undefined), setStep('address'))}>{t('restore.no')}</button>
          </>
        )}
        {step === 'passkey' && (
          <>
            <h1>{t('restore.passkeyTitle')}</h1>
            <p class="lead">{t('restore.passkeyText')}</p>
            <p class="note">{t('restore.reserve')}</p>
            <button type="button" class="btn primary" disabled={busy} onClick={makePasskey}>{t('fs.create')}</button>
            {msg && <p class="warnbox">{msg}</p>}
          </>
        )}
        {step === 'done' && member && (
          <>
            <h1>{t('restore.doneTitle', { name: member.name })}</h1>
            <p class="lead">{t('restore.doneText')}</p>
            {local && <p class="warnbox">{t('restore.local')}</p>}
            <button type="button" class="btn primary" onClick={() => go('/')}>{t('nav.home')} →</button>
            <PrintCard council={member.council} />
          </>
        )}
      </main>
    </>
  );
}
