# UNO practice run · 6–8 November 2026

**DAO:** UNO, practice stage (`uno-practice`), testnet4, 2-of-2 council on two Android phones, 10-minute votes.
**Releases:** v0.1.2 → v0.1.10 during the run.
**Result:** the whole life of a DAO completed on a real network, from founding to closing. 10,000 test sats lent; 5,000 paid out; 4,541 returned; 459 in fees.

## What was tested, and what passed

| Step | Result | Notes |
| --- | --- | --- |
| Founding, 2 of 2, short codes checked | Passed | 6 Nov, v0.1.1–v0.1.5 |
| Funding from the BTC DAO Testnet Treasury | Passed | 10,000 sats, then the treasury page needed four releases to read it reliably |
| Payout with recipient confirmation | Passed | UNO-0001, 5,000 sats, round 2026-11, block 159459 |
| Rejected proposal | Passed | UNO-0002, 0 yes / 2 no |
| Rule change, confirmed by the council | Passed | UNO-0003, payouts monthly → weekly, rules version 2 |
| Card restore on a cleared phone | Passed | @founder1, new passkey, same identity |
| Trial treasury key re-entered from its 12 words | Passed | v0.1.7, same fingerprint; signed the closing round |
| New member, remote checks by both council members | Passed | @member1, member list version 2 |
| Key replacement without the card, remote | Passed | twice in a row (a new key was lost mid-test), member list versions 3–4 |
| Member leaves | Passed | member list version 5 |
| Closing, two-thirds vote, balance returned | Passed | UNO-0005, round 2026-W45, block 159889 |

## What the network did to us

testnet4 showed most of what can go wrong between an app and a blockchain, in three days:

- **mempool.space's testnet4 service** stopped answering for hours at a time, throttled bursts, and its servers disagreed about which transactions they held.
- **Zelcore's Blockbook** was in sync throughout but refuses to be read by web pages (no CORS), so the app could never use it directly.
- **A broadcast that went nowhere:** mempool.space accepted both payout transactions but did not pass them to miners; each confirmed only after reaching Blockbook's node.
- **Empty blocks** from miners chasing the easy-difficulty rule, so "15 new blocks" meant nothing for a waiting transaction.
- **A reorg:** the first payout was mined, its block dropped, and it went back to the mempool.

## What changed because of it

| Release | Change |
| --- | --- |
| v0.1.2–v0.1.4 | Treasury reading survives a slow service: fewer requests, one at a time, retries, a remembered reading shown with its time, rounds built only from live coins |
| v0.1.5 | Blockbook as a second chain source (turned out unusable from web pages, see v0.1.9) |
| v0.1.6 | A broadcast counts only when a source answers with the transaction's id; "On the network" only when a source reports it |
| v0.1.7 | Trial treasury key can be typed back in from its 12 words after a card restore |
| v0.1.8 | Chain errors name every source and its reason, and tell "unreachable" from "refuses web pages" |
| v0.1.9 | **The chain gateway**: a Worker per DAO that reads public services server-side, caches, rate-limits and broadcasts to all of them |
| v0.1.10 | Broadcast again while a round is unconfirmed |

With the gateway, treasury readings and round preparation became noticeably faster, and the closing round could be prepared while mempool.space was down.

## Findings for v0.2.0

28 items, listed at the end of `MAINNET-READINESS.md`. In groups:

- **Chain and payments:** fee setting (fast by default, economical by vote); receipts after 3 confirmations, so a reorg cannot leave a false receipt; "confirmed, receipt waiting" shown to everyone; "already known" counts as accepted; broadcast results per source shown in the app and logged by the gateway; less load from open pages; separate broadcast pages in the config.
- **Governance safety:** warn at founding when the threshold equals the council size; explain blocked key replacements; hide duplicate replacements; the Council page checks the chain before offering a broadcast.
- **Wording and flow:** browser translation off; "remote" wording everywhere; waiting-page messages; the passkey message after clearing site data; the former member's profile; the app's own confirm dialogs; short voting periods in minutes; the header after a restore; council pages when signed out.
- **Small additions:** Share for the recipient's confirmation link; one-page card printing; "Fund the treasury" and "what happens next" after founding.
- **Structure:** one testnet4 site per DAO; vote length chosen at founding (practice or live) and changed by vote; moving from phone test keys to SeedSigners as a council change.

## Lessons

1. **Only real networks find chain problems.** The automated tests passed throughout; every chain issue came from testnet4.
2. **Public testnet4 services are fragile and not built for web apps.** The gateway fixes access; gateway v2 (an own pruned node behind it) is the answer before mainnet.
3. **A council needs a spare.** With 2 of 2, a lost council key blocks both the treasury and key replacement. Mainnet DAOs: 3 of 5 or 2 of 3.
4. **Two phones are a hard test bench.** Three identities across two phones and three browsers produced some of the edge cases (a lost new key, a duplicate replacement), which real members may also hit.

## Next

1. v0.2.0: the 28 findings, tested end to end.
2. UNO: merge `uno-practice` into `uno-testnet` as "UNO DAO" on v0.2.0, founded in practice mode; later, live votes and a council change onto SeedSigners.
3. The Sandbox DAO on the same build, with Club Orange members (3 of 5, all remote).
4. Gateway v2: own pruned node, before mainnet.
