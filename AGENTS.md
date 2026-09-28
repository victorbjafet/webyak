# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Every commit bumps the version

The version is `APP_VERSION` in [src/constants/version.ts](src/constants/version.ts),
shown at the top of Settings. It is `yyyy.mm.dd.v`: the date of the commit, then
`v`, which counts that day's commits from 0. **Every commit changes it, in that
same commit**, with no exceptions for docs-only or small commits:

- The version's date is today: add one to `v`. `2026.09.27.0` becomes `2026.09.27.1`.
- It is any earlier day: today's date, `v` back to 0. `2026.09.27.3` becomes `2026.09.28.0`.

Month and day are always two digits. Get today from `date +%Y.%m.%d` (local
time) instead of assuming it. Leave `version` in package.json and app.json at
1.0.0: npm expects semver there, and iOS allows at most three numbers.

# Committing

**Commit; never push.** Commit locally once `npx tsc --noEmit`, `npm run lint`,
the secret scan in [CLAUDE.md](CLAUDE.md) and the version bump are done. The
owner pushes, and a push to `main` deploys the live site.

**One commit per feature.** A long run that takes on several things commits
each one when it is done, with its own docs and its own version bump. Don't
save them all for one commit at the end: a commit that does one thing can be
reviewed, reverted or held back from a push on its own.

**Check UI changes against a stand-in, not the account.** The quick way is a
stand-in tab in the Playwright browser: run
[scripts/playwright/stand-in-tab.js](scripts/playwright/stand-in-tab.js) with
`browser_run_code_unsafe`. It opens webyak from the same dev server at
`http://127.0.0.1:8081`. That origin's storage is separate from the signed-in
`localhost:8081`, so the tab gets a made-up session, and a route set on that
tab alone answers every `api.sidechat.lol` request from fixtures. Its state is
on the browser context as `__harness`: `data` holds the fixtures (and an
`override` hook), and `log` records each request, so a write can be checked
without it happening. Switch tabs with `browser_tabs` and check which one is
current before every click: the other tab is the real account.

The Worker in [worker/](worker/) has its own tests: `cd worker && npm test`
runs every route in Node against stubbed upstreams. To exercise it from the
app, build a scratch copy with `EXPO_PUBLIC_WORKER_URL` pointing at a local
copy of the Worker; never point a signed-in tab at a Worker that reaches
Sidechat unless the owner has asked for it.

Some bugs only show in a built bundle, where the React Compiler has compiled
away code that ran fine in dev. For those, build a scratch copy of the repo
(`npx expo export --platform web`) with `fetch` patched the same way.

# The Playwright browser is signed in to the owner's real account

The Playwright MCP browser runs webyak from the owner's dev server,
`http://localhost:8081`, signed in to the owner's real Yik Yak account. Agents
use it to drive the app and run the probes on `/diagnostics` themselves. It has
its own browser profile, separate from the owner's everyday one, but the login
in it is real:

- **Never read, print or copy the token or anything else in localStorage.**
  That covers `browser_evaluate`, request headers (`Authorization` carries the
  bearer) and screenshots of the account screens. Docs and commits get what a
  probe *proved*, never what it returned (CLAUDE.md).
- **Ask the owner before anything that writes to the account**: posting,
  commenting, voting, messaging, joining, editing the profile, deleting, the
  length probes. Some writes happen on the way to something else. Opening a
  chat marks it read, and the official app shows it read too. Tapping an
  alert marks it seen. So does *Mark all read*. The full list is in
  [docs/API.md](docs/API.md#probes-what-is-still-asked-and-what-was-retired).
  Everything else (feeds, posts, profiles, Explore, the read-only probes) only
  reads.
- **Never clear that browser's site data or storage**, and never sign out. It
  would end the session, and the archive in that browser lives in the same
  storage.
- **The login-file picker doesn't open in that browser.** Playwright takes
  every file chooser for itself, so *Use a login file instead* does nothing for
  the person at the window. Each click leaves a pending chooser that blocks the
  agent's snapshots and screenshots until `browser_file_upload` answers it. To
  sign in there, use the texted code. Or put the login file in the repo root
  (`webyak-login*.json` is gitignored) and have the agent hand it over with
  `browser_file_upload`; the owner types the passphrase.
- **Editing `src/api/client.ts` hot-reloads a client with no token** into the
  signed-in tab: its next polls go out as `Bearer undefined` and get 401s. The
  app doesn't sign out on those (a 401 without a token proves nothing), and a
  reload of that tab re-reads the stored token. Reload it after such edits,
  before using it.
- Snapshots, console logs and screenshots go to `.playwright-mcp/`, which is
  gitignored because they hold other people's posts. The MCP only writes
  inside the repo, so screenshots go there too. Don't quote what they contain
  in docs or commits.
