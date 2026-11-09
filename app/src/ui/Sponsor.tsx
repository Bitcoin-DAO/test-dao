// A member introduces a candidate: scan their code, wait for the council's check, publish add_member.
import { useEffect, useState } from 'preact/hooks';
import { signAndPublish, sync, useApp } from '../app';
import { t } from '../i18n';
import { KIND } from '../core/events';
import { parseFounderCode, type FounderCode } from '../core/identity';
import { parseJson } from '../core/util';
import { Footer, Header, ScanModal, ShortCode, errText, go } from './parts';

export function Sponsor() {
  const app = useApp();
  const s = app.dao!;
  const dao = app.site!.name;
  const [cand, setCand] = useState<FounderCode>();
  const [scan, setScan] = useState(false);
  const [summary, setSummary] = useState('');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cand) return;
    const id = setInterval(() => void sync(), 8000);
    return () => clearInterval(id);
  }, [cand?.key]);

  if (!app.me || !app.secret) {
    return (
      <>
        <Header />
        <main>
          <p class="lead">{t('np.signIn')}</p>
          <button type="button" class="btn primary" onClick={() => go('/join')}>{t('nav.signin')}</button>
        </main>
      </>
    );
  }

  const verifies = cand ? s.verifies.filter(v => parseJson<any>(v.content).candidate_key === cand.key) : [];
  const inPerson = verifies.filter(v => parseJson<any>(v.content).mode === 'in_person');
  const remoteBy = new Map(verifies.filter(v => parseJson<any>(v.content).mode === 'remote').map(v => [s.personOf(v.pubkey), v]));
  const verifyIds = inPerson.length ? [inPerson[0].id] : remoteBy.size >= 2 ? [...remoteBy.values()].slice(0, 2).map(v => v.id) : undefined;
  const already = cand && s.members.some(m => m.person === s.personOf(cand.key));

  const publish = async () => {
    if (!cand || !verifyIds) return;
    setMsg(undefined);
    setBusy(true);
    try {
      const { event } = await signAndPublish(KIND.proposal, {
        type: 'add_member',
        title: `${t('type.add_member')}: ${cand.name}`.slice(0, 80),
        summary: (summary.trim() || t('sp.summary', { name: cand.name, dao })).slice(0, 500),
        lang: app.lang,
        payload: { candidate_key: cand.key, name: cand.name, verify: verifyIds },
      });
      go(`/p/${event.id}`);
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
        <h1>{t('sp.title')}</h1>
        {!cand ? (
          <>
            <p class="lead">{t('sp.intro')}</p>
            <button type="button" class="btn primary" onClick={() => setScan(true)}>{t('sp.scan')}</button>
          </>
        ) : (
          <>
            <div class="card" style="align-items:center">
              <h2>{cand.name}</h2>
              <ShortCode pubkey={cand.key} />
              <span class="small">{t('fs.shortCodeLabel')}</span>
            </div>
            {already ? (
              <p class="warnbox">{t('sp.already')}</p>
            ) : verifyIds ? (
              <>
                <p class="ok">{t('sp.verifiedOk')}</p>
                <label class="field">
                  {t('np.summary')}
                  <textarea maxLength={500} style="font-family:inherit;font-size:16px" value={summary || t('sp.summary', { name: cand.name, dao })} onInput={e => setSummary((e.target as HTMLTextAreaElement).value)} />
                </label>
                <button type="button" class="btn primary" disabled={busy} onClick={publish}>{t('sp.publish')}</button>
              </>
            ) : (
              <>
                <p class="note">{t('sp.waitVerify')}</p>
                <p class="small">{t('cand.verifyNeed')} · {t('cand.verified')}: {verifies.length}</p>
                <p class="small">{t('fs.autoRefresh')}</p>
              </>
            )}
          </>
        )}
        {msg && <p class="warnbox">{msg}</p>}
      </main>
      {scan && <ScanModal parse={parseFounderCode} onResult={c => (setScan(false), setCand(c))} onCancel={() => setScan(false)} title={t('sp.scan')} />}
      <Footer />
    </>
  );
}
