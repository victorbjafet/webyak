# Open-sourcing webyak — release audit

> **Status: NOT DONE. This is a gate, not a task.**
> Nothing in this repo has ever been pushed anywhere — `git remote -v` is empty
> as of 2026-08-27. That is the only reason nothing has leaked yet. **The audit
> below must pass before the first `git push`, and before Phase 4 starts.**

This project is a client for a **private, reverse-engineered API** that we log
into with a **real personal account**. Every debugging session runs authenticated
probes and pastes their output back into the conversation, and those findings get
summarised into `docs/`. That makes this repo a much higher leak risk than a
normal side project, and the risk is *ongoing* — it does not end when this audit
passes. See [The standing rule](#the-standing-rule).

---

## Why this is urgent

Three things make the usual "eh, it's just a frontend" reasoning wrong here:

1. **A bearer token is a full account takeover.** The Sidechat token is not
   scoped and, as far as we know, is not short-lived (see `docs/API.md`). One
   leaked token in one pasted probe result is someone else reading and posting as
   the account owner.
2. **Git history is public too.** Removing a secret in a later commit does not
   remove it — it stays in every clone forever. The fix after a push is to
   rotate the credential and rewrite history, which is painful and unreliable. The
   fix before a push is free.
3. **Probe output is unreviewed by construction.** It is raw API responses. It
   contains whatever the API felt like returning: user ids, device ids, emails,
   phone numbers, other people's posts.

---

## Pre-scan findings (2026-08-27)

A first pass over `HEAD` and all 294 objects in history. **This is a starting
point for the audit, not the audit itself** — it is pattern-matching, and
pattern-matching does not find a secret that does not look like one.

### Clean so far

| Check | Result |
|---|---|
| JWTs / `Bearer <token>` in tracked files | none |
| Same, across full `git log --all -p` | none |
| Tracked `.env` / key / credential files | none |
| Emails or phone numbers in tracked source | none (one `you@school.edu` placeholder) |
| `*.pem`, `*.key`, `*.p12`, `*.jks` | ignored by `.gitignore`, none tracked |

### Must fix before publishing

| # | Finding | Where | Why it matters |
|---|---|---|---|
| 1 | **`LICENSE` is still Expo's boilerplate** — `Copyright (c) 2015-present 650 Industries, Inc.` | `LICENSE` | We would be publishing under someone else's copyright line. Must be replaced with the real one before the repo is public. |
| 2 | **A third party's real handle is hardcoded** — `SAMPLE_PROFILE = 'snoopyvt'` | `src/api/diagnostics.ts:21` | A real person's username, baked into a file that becomes public. They did not consent to being this project's test fixture. Move it to an env var or a gitignored local config. |
| 3 | **`.gitignore` did not cover plain `.env`** | `.gitignore` | It listed `.env*.local` only, which misses `.env` and `.env.production` — and Expo reads `.env` for `EXPO_PUBLIC_*`. Since `EXPO_PUBLIC_BASE_URL` and `EXPO_PUBLIC_WORKER_URL` both exist, that file was likely to appear. **Fixed 2026-08-27**, but re-verify nothing was already committed. |

### Decide before publishing

| # | Finding | Where | The call to make |
|---|---|---|---|
| 4 | Virginia Tech's group UUID hardcoded | `src/api/diagnostics.ts:19`, `docs/API.md`, `docs/WORKER.md` | It is a public community id, not personal data — but it ties the repo to one specific school and one specific user's campus. Probably fine; decide deliberately rather than by omission. |
| 5 | Expo template assets still tracked | `assets/images/react-logo*`, `expo-badge*`, `expo-logo.png`, `tutorial-web.png`, `assets/expo.icon/` | Unused Expo branding shipping in our repo. Delete — this is cleanliness, and avoids implying an Expo affiliation. |
| 6 | Web stores the bearer token in `localStorage` | `src/lib/storage.web.ts` | Not a repo-secret problem, but publishing the client makes the storage model public knowledge. The README should state it plainly rather than let someone discover it. The mitigation is already real: zero third-party scripts on the origin. |

---

## The standing rule

**Every future commit gets checked for sensitive insertions before it is made.**
This is in [CLAUDE.md](../CLAUDE.md) so it survives between sessions.

The specific thing that will go wrong, in this project, is not a committed
`.env`. It is **probe output getting pasted into a doc**. The workflow that
produces our best documentation — run an authenticated probe, paste the result,
write down what it proved — is exactly the workflow that carries live
credentials and personal data into tracked files.

So, when writing up a probe result:

- Write down **what it proved**, not **what it returned**. "The envelope is
  `{groups: [...]}`" is the finding. The array is not.
- If a raw payload has to be quoted, redact `token`, `user_id`, `device_id`,
  `email`, `phone_number`, and any `Authorization` header to `<redacted>`.
- Never paste a request that includes headers.
- Other users' posts and usernames are other people's data. Paraphrase.

## The pre-commit check

```sh
# what is actually about to be committed
git diff --cached

# secret-shaped strings in the staged change
git diff --cached | grep -nEi 'eyJ[A-Za-z0-9_-]{10,}|bearer [A-Za-z0-9_.-]{20,}|api[_-]?key|secret|password|access[_-]token|refresh[_-]token'

# personal data shapes
git diff --cached | grep -nEi '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|[0-9]{3}[-. ]?[0-9]{3}[-. ]?[0-9]{4}|"(user_id|device_id|phone_number)"'
```

A hit is not automatically a problem — `Authorization: Bearer ${api.userToken}`
is source code doing its job. Read the hit; do not just count them.

## Before the first push

1. Work the "must fix" table above to zero.
2. Make the decisions in the "decide" table.
3. Re-run the full-history scan, not just `HEAD` — history is what gets cloned:
   ```sh
   git log --all -p | grep -nEi 'eyJ[A-Za-z0-9_-]{10,}|bearer [A-Za-z0-9_.-]{20,}'
   ```
4. Read every file in `docs/` **as a stranger**. This is the step that catches
   what grep cannot: a group id, a campus, a schedule, a real username in a
   quoted payload.
5. Confirm `dist/` is ignored — a built bundle can inline an `EXPO_PUBLIC_*`
   value that was set at build time.
6. Only then create the GitHub repo and push.

> If a credential is ever pushed: **rotate first** (log out everywhere / change
> the account password), *then* worry about scrubbing history. Scrubbing an
> already-cloned secret is not a fix on its own.
