# Open-sourcing webyak — release audit

> **Status: PASSED 2026-08-27, and published.**
> No credentials or personal data were found in `HEAD` or in any of the 294
> objects in history, and nothing had ever been pushed before the audit ran, so
> nothing could have leaked. The repo is now public at
> [github.com/victorbjafet/webyak](https://github.com/victorbjafet/webyak).
>
> **The [standing rule](#the-standing-rule) survives this.** The audit cleared
> what was already here; it does nothing about what the next commit adds, and
> the risk that made this necessary is ongoing.

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

## Audit results (2026-08-27)

Two passes: a pattern scan over `HEAD` and every blob in history, then a manual
read of all of `docs/` as a stranger — because pattern-matching does not find a
secret that does not look like one, and does not recognise a campus or a
schedule as identifying.

### Clean so far

| Check | Result |
|---|---|
| JWTs / `Bearer <token>` in tracked files | none |
| Same, across full `git log --all -p` | none |
| Tracked `.env` / key / credential files | none |
| Emails or phone numbers in tracked source | none (one `you@school.edu` placeholder) |
| `*.pem`, `*.key`, `*.p12`, `*.jks` | ignored by `.gitignore`, none tracked |

### Resolved

| # | Finding | Resolution |
|---|---|---|
| 1 | `LICENSE` was Expo's boilerplate — `Copyright (c) 2015-present 650 Industries, Inc.` | Replaced with MIT under the real copyright holder. |
| 2 | A third party's handle hardcoded as a fixture — `SAMPLE_PROFILE = 'snoopyvt'` | **Kept**, by the owner's decision. It is a public username on a public profile, and it is the only account known to have a profile photo, which makes it the one usable regression case for [the image bug](API.md#-images-that-dont-render--unresolved). |
| 3 | `.gitignore` did not cover plain `.env` | Widened to `.env` / `.env.*` with a `!.env.example` escape. Confirmed nothing was already tracked. |
| 4 | Virginia Tech group UUID hardcoded | **Kept.** A public community identifier, not personal data. |
| 5 | Expo template assets and `scripts/reset-project.js` still tracked | Deleted — all verified unreferenced by `src/` and `app.json` first. |
| 6 | Web stores the bearer token in `localStorage` | Not a repo-secret issue, and unchanged: there is no better option in a browser. Now **disclosed in the README** rather than left to be discovered, along with the zero-third-party-scripts mitigation that makes it defensible. |

### Hardened while here

`.gitignore` now also covers `*.har`, `probe-*.json`, `diagnostics-*.json` and
friends. A HAR exported from DevTools is the single most likely way a live
bearer token gets committed in a project debugged like this one, and it would
sail past a reviewer as "just a log file".

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

## Before the first push (done — kept for the next repo)

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
