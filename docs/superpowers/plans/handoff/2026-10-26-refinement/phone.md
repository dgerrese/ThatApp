# Milestone: Phone

## #53 The phone layout is designed and specified, but no ticket builds it

**Still valid?** Yes. Below `md` the shell is only the desktop layout stacked: `web/index.html:54` is `grid-cols-1 md:grid-cols-[216px_...]`, the rail (`:69`) just sits on top, and `index.html:158,179` hold the only nav links inside it. There is no tab bar, header block or phone entry sheet in `web/src` or `index.html`. The `.dc.html` drawings still exist in `docs/superpowers/canvas/2026-08-20-visual-directions/` (Mobile.dc.html, MobileSheet.dc.html). Spec: `2026-08-20-visual-design-language.md:349-362`. Three of the ticket's open questions are settled: #7 shipped (sheet belongs here), #89 closed (Settings is now a cog in the rail header, `index.html:76`, not a nav destination), #94/#95 closed (breakpoint ladder is Tailwind defaults + `3xl`). Some phone work already exists: e2e tests at 390x844 in `.claude/e2e/tests/{smoke,today,settings,week}.spec.ts`, and that-table already restacks rows for narrow width (per the comment at `web/src/week-grid.ts:220`). That is the part to verify, not rebuild.

**Problem.** Below `md` the app is the desktop layout in one column, not the designed phone layout. Every view built since keeps being written against it. The tab bar's destination count was blocked on #89, which is now answered: Today and Week are the only nav links, Settings is a cog. The ticket is unrefined: the body is a problem statement with no approach or criteria.

**Approach.** One ticket, one PR, four visible changes below `md` only, desktop untouched:
1. Rail becomes a dark header block (readout, timer, Push stay; nav links leave it).
2. Fixed bottom tab bar with Today and Week, `pb-[env(safe-area-inset-bottom)]`, 44px targets. Content gets bottom padding so nothing hides behind it.
3. Verify/finish row restacking (summary first, key and status beneath) against Mobile.dc.html; fix only gaps.
4. Entry dialog anchored to the bottom edge with 46px controls and the safe-area inset (same markup, CSS only, per spec `:360`).
Implement as a markup-once, CSS-switch design: one `<nav>` element that is in the rail at `md:` and fixed-bottom below it, so `index.html` does not grow with a second nav. `index.html` is 10.5 kB today against the 14 kB budget, so a duplicated nav is affordable but unnecessary. Check `viewport-fit=cover` is added to the viewport meta (needed for `env(safe-area-inset-*)` to be non-zero; currently `index.html:5` lacks it) and `theme-color` for the header tone.
Alternative: split into two tickets (header block + tab bar; entry sheet). Cost: two PRs touching the same shell CSS and two design verifications; benefit: smaller reviews. Recommend one ticket since the pieces are small and share tokens.

**Acceptance criteria**
- [ ] At 390x844 the rail is a header block in the rail tone with the readout, timer and Push; Settings cog is still reachable.
- [ ] At 390x844 a bottom tab bar shows Today and Week, marks the current one (`aria-current`), and is keyboard-operable and labelled as navigation.
- [ ] The tab bar and the entry dialog clear the gesture bar: `viewport-fit=cover` in the meta and `env(safe-area-inset-bottom)` applied; asserted by a computed-style e2e check (emulate inset via a CSS var override, since Playwright cannot set a real inset).
- [ ] Nothing on Today or Week is hidden behind the tab bar when scrolled to the end.
- [ ] Every interactive control in the shell, rows and tab bar is at least 44px tall; the entry dialog's controls 46px. Asserted by e2e at 390 wide in both Firefox and Chromium.
- [ ] Ticket rows restack summary first, key and status beneath, with no horizontal page scroll at 390 wide (e2e asserts `scrollWidth <= clientWidth`).
- [ ] The entry dialog is anchored to the bottom edge below `md` and centred at `md` and above, from the same markup.
- [ ] At and above `md` the layout is unchanged (existing desktop e2e and screenshots pass).
- [ ] Verified against Mobile.dc.html and MobileSheet.dc.html, report lists what was compared and any forced difference (so the design can be updated).
- [ ] Screenshots in light and dark, desktop and 390px, attached to the PR via `.claude/tools/pr-attach.sh`.
- [ ] `index.html` initial response stays under 14 kB (check size after the change).
- [ ] `make verify` and `make test-e2e` green.

**Out of scope.** Using it from a real phone (needs #13). Redesigning the desktop. Landscape and tablet widths beyond what `md` already gives. Gestures (swipe), pull-to-refresh. WebKit/iOS.

**Questions for the owner**
1. Do Push and the timer stay in the header block, or do they move to a floating or tab-bar position where the thumb reaches? Recommend: follow the drawing as is (header block). Only ask if Mobile.dc.html does not draw them; I counted drawn Timer/Push labels in it but did not render it, so confirm during the verify step.
2. Is #53 worth doing before #13 given the phone is unreachable until #13 ships? Recommend yes: the retrofit cost grows with every view, and a desktop browser at 390px covers almost all of it.
3. none other.

**Design session needed?** No, provided the drawings cover the header block, tab bar and sheet (spec `:349-362` and the two .dc.html files do). Settings-as-cog on the phone header is the one thing drawn before #89 and must be checked against it; if the drawing predates the cog, that single control is a forced difference to report, not a session.

**Type label.** enhancement (new capability on phone). Currently none; add `enhancement`.

**Size.** M. Shell markup, one CSS switch for nav, dialog CSS, and e2e at phone width; no logic or API.

**Dependencies.** None blocking (#89, #94, #95, #7 all closed). Not blocked by #13 for development; #13 is needed only for real-device use. Should land before more views are built.

---

## #13 Ticket 13: LAN access over HTTPS — phone support (deferred)

**Still valid?** Partly. The need is real and unchanged (the design of record `2026-08-04-thatapp-design.md:394` and PWA spec `2026-08-24-pwa-shell-design.md:234` both defer to it), but the ticket is marked "Do not pick this up without Dion saying so" and has no criteria. Facts since it was written: the PWA shell shipped (`web/manifest.json`, `web/src/sw.ts`, registration guarded at `web/src/main.ts:34`) and `/mcp` shipped, which makes the exposure worse than the body states. Today ThatApp has no authentication at all; `README.md:60-62` and `:179` tell the owner to keep `-p 127.0.0.1:8080:8080` precisely because of that. `/mcp` only refuses requests carrying an `Origin` header (`internal/server/mcp.go:75-77`), which is a DNS-rebinding defence, not auth. So making the app LAN-reachable puts the Jira tokens' use (the app can push worklogs and read issues with sealed tokens) and `/mcp` behind nothing. Auth is therefore not optional for this ticket. This ticket is the explicit exception to the README's 127.0.0.1 binding, so it must change the README guidance, not silently contradict it.

**Problem.** The phone cannot load the app: the release image is bound to 127.0.0.1 on the owner's machine, and Android browsers only register a service worker and offer PWA install in a secure context (HTTPS, or localhost), so a plain `http://<lan-ip>` would load the page but give no install and no offline. LAN exposure also needs login, because anything on the network could otherwise reach the app and `/mcp`.

**Approach.** Recommended (smallest that meets the constraint): keep the Go app plain-HTTP and unauthenticated-in-process for the loopback case, and add a TLS-terminating reverse proxy in the compose/run setup (Caddy with `tls internal`, or caddy/mkcert-issued cert) listening on the LAN, with HTTP basic or forward auth at the proxy, while the app stays bound to 127.0.0.1 behind it. That keeps auth and TLS out of the Go code and the approved dependency list. Owner installs the proxy's root CA on the phone once (Android: Settings, Security, Install a certificate, CA certificate). Document in README as an opt-in second step, with `/mcp` explicitly not exposed on the LAN listener (proxy route denies it) or protected by the same auth.
Alternative: the Go server serves TLS and a session login itself (`crypto/tls` stdlib, `THAT_*` cert/user/password variables, middleware in `internal/server/`). Trade-off: no extra container and one binary, but adds a public-API surface (new `THAT_*` variables, per CLAUDE.md), a cert-rotation story, and login UI that the design has never drawn.
Note on PWA install over a self-signed/private CA: Chromium on Android treats a user-installed CA as trusted for service workers and install; Firefox on Android has its own certificate store and must be set to trust user CAs (Settings, Advanced, "Use third party CA certificates" in Nightly/some builds only). This is a real risk since Firefox is the owner's primary browser; verify on the device before committing to the approach.
A no-certificate alternative worth a mention: Tailscale or similar gives a real HTTPS name via `tailscale serve`, but it is a third-party service and may fall outside "local network". Raise only if the owner asks for options.

**Acceptance criteria** (proposed for the owner's confirmation; ticket says criteria are written at pick-up)
- [ ] From the owner's Android phone on the home network, `https://<name>` loads the app with no certificate warning after the one-time CA install, in Chromium (and Firefox if the owner confirms it must work there).
- [ ] The service worker registers and the app offers Install; the installed PWA opens Today offline (existing #12 behaviour, reproduced on the phone).
- [ ] Every request from the LAN without credentials is refused (401/redirect), including `/api/*`, `/mcp` and the static shell; a test proves it (Go test for middleware if in-app; a scripted `curl` smoke if proxy-level).
- [ ] The app container is still published only on 127.0.0.1; only the proxy listens on the LAN interface.
- [ ] The existing `/mcp` Origin refusal still holds behind the proxy, and local MCP use from the owner's machine still works without the login.
- [ ] Credentials and cert material are never committed or baked into the image; any new `THAT_*` variable is in `.env.example` and README.
- [ ] README gains an opt-in "Reach it from your phone" section: how to enable, how to install the CA on Android, and an updated warning that explains the 127.0.0.1 rule and what the proxy changes.
- [ ] Default setup (no proxy) behaves exactly as today; `make verify` and `make test-e2e` green.
- [ ] No test contacts a real Jira instance (standing rule); no WebKit/iOS steps.

**Out of scope.** Hosting outside the local network (per the ticket). Multi-user accounts. Password reset flows. iOS/Safari. The phone layout (#53). Push notifications.

**Questions for the owner**
1. Should this ticket be started at all now, given "Do not pick this up without Dion saying so"? It sits in the Phone milestone, which suggests yes; recommend: confirm explicitly that refinement is wanted before anything is built, and treat the milestone assignment as intent to schedule after #53.
2. Where does TLS and auth live: a reverse proxy in front (recommended, no new Go code or dependency) or in the Go server? Recommend proxy.
3. Is Firefox on the phone required, or is Chromium on Android acceptable for the phone (CLAUDE.md says the phone is Android; Firefox is primary on desktop)? Recommend Chromium for the phone, because Firefox Android's handling of user-installed CAs is the main risk. This answer changes whether the ticket is a small config job or a research problem.

**Design session needed?** Only if auth is in-app: a login screen is not drawn anywhere in the visual language or prototype, so that would need a design session. With proxy-level basic auth there is no new UI. Recommended approach: no.

**Type label.** enhancement (new capability). Currently none; add `enhancement` when refined. The body's "delivers no new app features" is true of the app UI, but this is not a defect.

**Size.** L. Infra, secure-context and PWA verification on a real device, auth design, README, and a security-relevant test; the ticket itself calls it the largest chunk of infrastructure in the project. Shrinks to M with the proxy approach.

**Dependencies.** None hard. Practically: do #53 first (a layout a phone can use) or in parallel, since #13 is only verifiable on the device. If auth is in-app, depends on a login design. Touches README's 127.0.0.1 warning (`README.md:60-62`, `:179`) and the MCP exposure from the `/mcp` ticket.
