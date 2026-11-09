# Changelog

Each release is a git tag (`v0.1.1`). A DAO's copy runs one tagged release and records it in its README; a release moves to a DAO's next stage only after passing the one before ([guide, section 8](docs/guide.md#8-the-three-stages-practice-testnet-mainnet)).

## v0.3.1 · 9 November 2026

Found trying Discussion on TEST DAO.

- **A withdrawn draft is closed to new posts.** Its thread stays readable, with a line saying it is closed; posts dated after the withdrawal are ignored by every phone (protocol 4.5.3).

## v0.3.0 · 9 November 2026

The issues carried over from UNO's two runs (`docs/runs/`), and **Discussion**. Hardware keys move to v0.4.0 (`NEXT-RELEASE.md`).

**Discussion** (protocol 4.5, `docs/guide.md` 6.2.1)
- A **Discussion** page lists drafts and proposals by last activity, with what is new since this phone's last visit (a dot in the footer, a count per thread).
- **New idea:** a title and a line or two; the thread opens at once.
- **Versions:** the author posts v2, v3… with the proposal's fields; the newest is pinned at the top, the timeline below interleaves versions and posts.
- **Posts:** members only, plain text, links clickable; no editing or deleting. Anyone can read a thread from its shared link.
- **Submit:** the author submits a complete version as a proposal. Voting opens, the versions freeze, the thread carries on. The proposal page shows its **Discussion** and **Version**, and warns if the proposal differs from the version it names.
- **Withdraw:** the author can withdraw an unsubmitted draft; it stays visible, closed.
- New kinds 3587 (draft version), 3588 (post), 3589 (withdraw). The relay accepts them from any key, as it does every DAO kind; phones keep only members' posts, and the relay limits discussion events to 10 a minute per key.

**Treasury keys**
- **Council members write down the trial treasury key's 12 words at sign-up**, and type three of them back before the sign-up code is shown. Phones that already hold a key are asked on the profile, and signing waits for it.
- **A lost treasury key can be reported to the council** ("Tell the council my key is lost", new kind 3590). The Council page then shows the keys left against the threshold (spare, no spare, stuck), and the home page counts them. Typing the words back in clears it.

**Broadcasts and the chain**
- **A second broadcast by itself:** a minute after a broadcast, the app sends the transaction once more to the sources that do not know it yet; a council phone that sees an unconfirmed round does the same.
- **"Try again"** on the treasury reading waits 20 seconds after the last attempt.
- **`broadcastPages`** (optional config): the pages offered for "Send it by hand", which the app never reads.

**Tests**
- New end-to-end tests: **discussion**, and **closing a DAO** (close vote, the sweeping round checked independently, receipt, closing version, closed pages).
- Unit tests for discussion validation and key status; the 12-word step and the lost-key report in the payouts test.

**Deploying:** the relay must be redeployed for the new kinds (the "Deploy relay" workflow); until then phones cannot publish discussion events or key reports to the DAO's own relay.

## v0.2.8 · 9 November 2026

- **A closed DAO offers no new proposals.** The home page and the Proposals page no longer show "New proposal" or an empty "Open proposals" section once the DAO is closed; the home page links to the full record instead.

## v0.2.7 · 9 November 2026

Found when UNO DAO closed.

- **A closed DAO says so at the top of every page**, larger, under the header and the practice-mode banner, instead of a small box on the home page.
- **A closed DAO no longer invites funding**: the "Fund the treasury" card is gone once it is closed.

## v0.2.6 · 9 November 2026

Found when a council member of UNO DAO lost both the phone's data and the treasury key's 12 words.

- **Lost treasury words: the profile says what that means.** Under "type the 12 words", a council member now reads whether the treasury still works without their key (and that no spare is left), or that it is stuck, and that a council change gives them a new treasury key.

## v0.2.5 · 9 November 2026

Found during UNO DAO's rules change.

- **A passed rules or membership change says whether it is in force.** It takes effect only when the council signs the new version; the proposal now says "Approved, but not in force yet", with a link to the Council page, and later "In force ✓" with the version.
- **The software version shown on the Rules page is right again** (it still said 0.1.5).

## v0.2.4 · 9 November 2026

Found during UNO DAO's first payout round.

- **The gateway's broadcast report reads cleanly.** The gateway listed its services with " · ", which browsers read as "Â·" in a header; it now uses " | ", and the app reads both.
- **The gateway's two paths are told apart.** "Accepted by" and "Known to" named the gateway twice; they now say `(Blockbook)` and `(Esplora)` when two sources share one server.

## v0.2.3 · 9 November 2026

Found during UNO DAO's first payout proposal.

- **A disabled "Sign and publish" says what is missing** (for example the recipient's name), instead of staying grey without a reason.

## v0.2.2 · 9 November 2026

Found during UNO DAO's founding.

- **A missing sign-up passkey no longer blocks the last step.** If the phone says it has no passkey for the site when protecting the key (the passkey was deleted, or saved to another account), the app offers **Make a new passkey**: the key is still on the phone, in the sign-up, so it is protected with a new passkey instead. Applies to founders, new members and replaced keys.

## v0.2.1 · 9 November 2026

Found at the start of UNO DAO's 2-of-3 run.

- **Founding: the council size is the council you add.** The setup page showed "3 of 5" from the site file's five placeholder seats, though the council is whoever is added on the page. It now shows the real size, and the signatures needed follow it (2 of 3, 3 of 5) until changed by hand with − and +. At least 2 council members are needed to publish.

## v0.2.0 · 8 November 2026

The findings from UNO's practice run (6–8 November 2026, `docs/runs/2026-11-uno-practice.md`): 25 of 28 built, the rest noted in `MAINNET-READINESS.md`.

**Fees**
- A new rule, **round fees**: **fast** (the default) aims for the next block with a quarter more as headroom for the time signatures take, never under 2 sat/vB; **economical** aims for about an hour. Members change it by a rule-change vote.
- When the network asks more than the DAO's cap, the round goes at the cap with a warning, instead of being blocked.
- The round shows its fee as a share of what it pays, with its aim; the round page warns if the next-block fee has risen above the round's while signatures were collected.

**Broadcasts and confirmations**
- A broadcast goes to every chain source at once, and the round page lists which accepted, which refused and why, plus what a chain gateway reported for the services behind it. "Already known" counts as accepted.
- "On the network ✓" says which sources know the transaction.
- **Receipts wait for depth:** a council phone publishes the receipt only after 3 confirmations (`receiptConfirmations` in the config), so a reorg cannot leave a false receipt.
- Everyone's round page shows the confirmations as they grow ("Confirmed in block … (1 of 3)") and says when the receipt is waiting for a council member. It checks every 20 seconds.
- The Council page checks the chain: a round already on the network is no longer offered for broadcast or counted as a to-do.

**Treasury reading**
- The reading names its source ("Read from the blockchain: 15:24 · via blockbook.tbtc.zelcore.io · btc-dao-gateway").
- Open pages of the same site share one reading instead of each asking the chain.

**Chain gateway**
- Lets the app read which service answered and each broadcast's results; logs every broadcast's answers to the Worker's logs; answers the chain tip; keeps a shallow transaction's answer only briefly, so its confirmations can grow.

**Founding**
- On testnet4 the founders choose the vote length: **practice** (10-minute votes) or **live** (the site file's, 3 days by default). Members switch later by a rule-change vote; the DAO and its record carry on. A **practice mode** banner shows while votes are shorter than a day.
- A warning when the threshold equals the council size: one lost key would lock the treasury and block key replacement.
- After publishing the founding settings: who has approved, who has not yet, and what happens next.
- The first donation card is a **Fund the treasury** step, naming the BTC DAO Testnet Treasury on testnet.

**Members and keys**
- Key replacements that can never complete (the new key already in use, or a later one won) are hidden; a second replacement for a key already under way is stopped; replacing a council member's key when the others cannot reach the threshold is explained, not left waiting.
- The waiting pages say when an approved member or new key is waiting for the council to publish the member list; Sign in points a phone with a sign-up or replacement under way back to its page.
- After clearing a browser's data, the sign-in message explains that the passkey no longer has a key to open and points to the card or "I lost my key and card". Passkeys are named with the date they were made.
- A former member's profile shows only their record and **Join again**.
- Council pages opened while signed out offer Sign in and Come back with your card.

**Wording and pages**
- Browser translation is off (it rewrote "UNO" and proposals' binding text); the page's language is set before the first paint.
- "Remote" everywhere instead of "video call".
- Voting periods read in minutes, hours or days; vote-length changes are offered as 10 minutes, 1, 3 or 7 days.
- The home page says a round can be prepared as soon as payments are approved.
- Payout proposals: **Share** the recipient's confirmation link, with the DAO, proposal, amount and link in one message.
- The app's own confirmation dialogs, in its language, instead of the browser's.
- The identity card prints alone, on one page, without the browser's header and footer.

**Docs**
- Guide: own Google or Apple account per founder; practice or live votes; a spare key on the council.

**Tests**
- Unit (64): fee policy, depth from the chain tip, sources that know a transaction, broadcasting to every source, source names, vote length at founding. Gateway (18).
- End-to-end, Esplora, Blockbook and through the gateway: fast fee suggested, fee share and aim, sources named, depth shown to a member before the receipt, receipt after 3 confirmations; the card prints on one page; the header shows the member right after a restore; a former member is offered no member actions. The mock chain keeps mining so confirmations grow.

## v0.1.10 · 8 November 2026

Found in UNO's closing round: one of mempool.space's servers still reported the transaction while no miner had it, so the round page showed "On the network ✓" and offered no way to send it again.

**Broadcast again while unconfirmed**
- Until the round is confirmed, the round page keeps **Broadcast again** (sending twice is harmless), with a line saying when to use it.
- The signed transaction to copy and each source's broadcast page stay available under **Send it by hand**.

**Tests**
- End-to-end payout round through the chain gateway.

## v0.1.9 · 8 November 2026

Found in UNO's closing round: with mempool.space down, the app had no chain source it could read, although Zelcore's Blockbook was in sync throughout. It only refuses web pages.

**New: the chain gateway** (`gateway/`, design in `docs/chain-gateway.md`)
- A Cloudflare Worker per DAO, next to the relay, on the free plan. It reads the public chain services on the app's behalf and lets the DAO's site read the answers, so Zelcore's Blockbook becomes usable.
- Asks its sources in order, reuses answers briefly so open pages share one reading, refuses other sites' pages, and limits requests per visitor.
- Sends every broadcast to all its sources; "already known" counts as accepted.
- Answers in Blockbook's and Esplora's formats, so the app needs no change: the DAO's `chainApi` lists the gateway first.
- Holds no keys and cannot move coins.

**Tests**
- Gateway unit tests (15): reading, falling back, caching, "not found", allowed requests, origins, the limit, broadcasting to every source, transaction ids, redirects.
- End-to-end: the full payout round with the app reading the mock chain only through the gateway (`CHAIN=gateway bash app/e2e/run.sh payouts`).

## v0.1.8 · 8 November 2026

Found in UNO's closing round: the treasury could not be read ("/address/…: Failed to fetch"), while Blockbook answered in the browser. The message gave only the last failure, so nobody could tell which source failed or why.

**Chain errors name every source**
- When no source answers, the message lists each one with its own reason, for example "mempool.space: no answer in 30 s · blockbook.tbtc.zelcore.io: answers, but does not let this site read it".
- "Failed to fetch" is split in two: a source that cannot be reached, and one that answers but does not let web pages read the answer (no CORS header, often on a "too many requests" page).
- A 429 answer says "too many requests".

**Tests**
- Unit test: two failing sources are both named, each with its reason.

## v0.1.7 · 7 November 2026

Found before UNO's lost-key test: the identity card restores the identity key only, so a council member who restored from the card could vote but no longer sign rounds. In a 2-of-2 practice DAO that would have locked the treasury.

**Trial treasury key: type the 12 words back in**
- Profile → Treasury key: a council member whose phone has no trial treasury key gets a box for the 12 words.
- The words must give exactly the treasury key recorded for that member on the council (same fingerprint and xpub). Words of any other key are refused, so a typo cannot install the wrong key. Capitals and extra spaces are ignored.
- The round page and the Council page say when the key is missing, with a link to the box.
- Test networks only. On mainnet the treasury key stays on the SeedSigner and never touches the phone.

**Tests**
- End-to-end: a council phone loses its trial key, the round page flags it, another key's words are refused, its own words are accepted, and it signs the round.

## v0.1.6 · 6 November 2026

Found in UNO's practice run: the first payout round showed "Broadcast ✓", but neither mempool.space nor Blockbook had the transaction.

**A broadcast counts only when the network has it**
- A source has accepted a transaction only when it answers with that transaction's id. An unstable service can answer "OK" with a holding page, and that read as success.
- A transaction counts as on the network only when a source returns a real status for it. An error answer (Blockbook's "not found") or anything else means "not known".
- After a broadcast the round page names the source that took it ("Accepted by blockbook.tbtc.zelcore.io") and shows "On the network ✓" only once a source reports the transaction. It checks again every minute until the payment confirms.
- Until then the round page keeps **Broadcast again** (sending it twice is harmless) and the signed transaction to copy, with each source's broadcast page for doing it by hand.
- Council phones broadcast a ready round again by themselves if no source has seen it 10 minutes after they last sent it.

**Tests**
- Unit tests: an unknown transaction, an error answer and a holding page are not a status; a broadcast is accepted only with the transaction's id.
- End-to-end (Esplora and Blockbook): the round page names the accepting source, then shows the transaction on the network.

## v0.1.5 · 6 November 2026

Found in UNO's practice run: mempool.space's testnet4 indexer was unstable for most of the day, and it was the only source.

**A second chain source: Blockbook**
- `chainApi` entries can now be Blockbook servers, written `blockbook:<address>`, next to Esplora APIs. The app asks in Esplora's terms and translates Blockbook's answers for all six requests: address activity, transactions, unspent coins, transaction status, fee estimate and broadcast.
- Sources are asked in order; a source that fails is asked last for the next five minutes, so one slow source does not slow every request.
- The site's current `chainApi` is used first, then the one recorded at founding, so a founded DAO can add a source without a vote. A source shows data but never moves coins: every payment is checked against the treasury's descriptor.
- Explorer links and the manual broadcast page follow the first source (Blockbook: `/tx/<txid>` and `/sendtx`).
- Example config: Zelcore's testnet4 Blockbook (`blockbook:https://blockbook.tbtc.zelcore.io`) as the second source.

**Tests**
- Unit tests read UNO's practice treasury from Blockbook answers and fall back from a silent Esplora source.
- The end-to-end mock chain also answers as Blockbook (`CHAIN=blockbook bash e2e/run.sh payouts`): a full payout round, broadcast included, with Blockbook as the only source.

## v0.1.4 · 6 November 2026

Found in UNO's practice run: with mempool.space unstable, the treasury page kept loading or showed only an error.

**The treasury page shows what it last knew**
- Each phone remembers the last treasury reading and shows it at once, with the time it was read ("Read from the blockchain: 6 Nov, 13:48"), then refreshes in the background ("updating…"). A failed refresh shows "not updated, the blockchain is not answering" and keeps the balance.
- The funding address shows while the treasury is loading too.
- One reading at a time; a reading is refreshed after 5 minutes, at once after a payout round moves, and retried by itself at most every 2 minutes after a failure.
- A whole reading gives up after 2 minutes, and errors say what failed ("/address/…: no answer in 30 s").

**Payout rounds use only live coins**
- Preparing a round waits for a fresh reading of the treasury's coins and never builds from the remembered one.

## v0.1.3 · 6 November 2026

Found in UNO's practice run: with mempool.space working again, the treasury still timed out.

**Treasury page asks far less of the blockchain service**
- The treasury check looks 5 unused addresses past the last used one, not 20. The app only ever shows the first unused address and takes change in order, so used addresses stay contiguous. A new treasury now needs about 10 requests instead of 40.
- Requests go one at a time with a short pause, and each may take up to 30 seconds. mempool.space slows bursts down rather than refusing them, so later requests in a burst ran past the old 15-second limit.

**Docs**
- Testnet treasury log: 10,000 sats to UNO's practice.

## v0.1.2 · 6 November 2026

Found in UNO's practice run (2 of 2, two phones).

**Treasury page survives the blockchain service**
- Reading the treasury no longer sends bursts: two addresses at a time with a short pause, each request retried twice and given up after 15 seconds. mempool.space refused the old bursts, which reached the page only as "Failed to fetch", and a stalled request could leave the page loading for ever.
- When the blockchain cannot be read, the page still shows the treasury's funding address, worked out on the phone from the descriptor.

## v0.1.1 · 5 November 2026

**Remote founding without a call**
- Founder sign-up, code page: a **Share** button sends one message (DAO, role, pseudonym, short code and full code) through the phone's share sheet, or copies it where sharing is not available.
- The message names the role, **Council** or **Founder**, so a mistaken council request shows in the group.
- The code page's wording covers founding **in person** and **remote**.
- The setup page's paste box accepts the whole shared message, not only the bare code.
- The council box reads **I request a council seat**.

**Starting again**
- The code page has a **Start again** link.
- Starting the sign-up again also discards the setup draft, which belonged to the old identity.

**DAO-owned files**
- New `site/` folder: the DAO's own static pages and files, copied next to the app at build. Like `config/`, it belongs to the DAO and is never touched by updating btc-dao.

**Docs**
- BTC DAO Testnet Treasury: new dedicated wallet (`2N5SK7BFXGzefmMs9AHui2Y71fUh3uVVn2S`) and the first log entry.
- Guide: the remote route through the DAO's group at founding.

## v0.1.0

The testnet4 prototype: founding, passkey sign-in, identity cards, treasury, proposals and votes, membership, key replacement and payout rounds signed by the council. Tagged afterwards, at the commit the UNO stages were set up from.
