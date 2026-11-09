import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';
import { init, useApp } from './app';
import { t } from './i18n';
import { Home } from './ui/Home';
import { Join } from './ui/Join';
import { Founder } from './ui/Founder';
import { Setup } from './ui/Setup';
import { Restore } from './ui/Restore';
import { Profile } from './ui/Profile';
import { Members } from './ui/Members';
import { Rules } from './ui/Rules';
import { Header } from './ui/parts';
import { ProposalDetail, Proposals } from './ui/Proposals';
import { NewProposal } from './ui/NewProposal';
import { Confirm } from './ui/Confirm';
import { Candidate } from './ui/Candidate';
import { Sponsor } from './ui/Sponsor';
import { Council } from './ui/Council';
import { PrepareRound, RoundDetail } from './ui/Round';
import { DiscussionList, NewIdea, ThreadView } from './ui/Discussion';
import { QrTest } from './ui/Hw';

const routes: Record<string, () => preact.JSX.Element> = {
  '/': Home,
  '/join': Join,
  '/founder': Founder,
  '/setup': Setup,
  '/restore': Restore,
  '/profile': Profile,
  '/members': Members,
  '/rules': Rules,
  '/proposals': Proposals,
  '/new': NewProposal,
  '/sponsor': Sponsor,
  '/council': Council,
  '/round/new': PrepareRound,
  '/discussion': DiscussionList,
  '/discussion/new': NewIdea,
  '/qrtest': QrTest,
  '/candidate': () => <Candidate role="candidate" />,
  '/lost': () => <Candidate role="rekey" />,
};

const currentPath = () => location.hash.replace(/^#/, '') || '/';

function App() {
  const app = useApp();
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    document.documentElement.lang = app.lang;
  }, [app.lang]);
  useEffect(() => {
    if (app.site) document.title = app.site.name;
  }, [app.site?.name]);

  if (app.loadError) {
    return (
      <div class="app">
        <Header />
        <main>
          <p class="warnbox">{t('error.load', { msg: app.loadError })}</p>
          <button type="button" class="btn secondary" onClick={() => location.reload()}>{t('retry')}</button>
        </main>
      </div>
    );
  }
  if (app.loading || !app.site) {
    return (
      <div class="app">
        <Header />
        <main><p class="small" aria-busy="true">{t('loading')}</p></main>
      </div>
    );
  }
  const param = path.match(/^\/(p|confirm|round)\/([0-9a-f]{64})$/);
  if (param) {
    const [, kind, id] = param;
    return <div class="app">{kind === 'p' ? <ProposalDetail id={id} /> : kind === 'confirm' ? <Confirm id={id} /> : <RoundDetail id={id} />}</div>;
  }
  const thread = path.match(/^\/d\/([0-9a-f]{64})(\/version)?$/);
  if (thread) return <div class="app">{thread[2] ? <NewProposal draftId={thread[1]} /> : <ThreadView id={thread[1]} />}</div>;
  const Screen = routes[path] ?? Home;
  return <div class="app"><Screen /></div>;
}

render(<App />, document.getElementById('root')!);
void init();
