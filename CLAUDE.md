@AGENTS.md

# ⛔ Check for sensitive data before every commit

**This repo is open source.** The release audit passed on 2026-08-27
([docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md)) — but that cleared only what was
already there. It does nothing about what the next commit adds, and the thing
that made it necessary has not gone away.

**No commit is made without checking what is in it first:**

```sh
git diff --cached | grep -nEi 'eyJ[A-Za-z0-9_-]{10,}|bearer [A-Za-z0-9_.-]{20,}|api[_-]?key|secret|password|access[_-]token|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|"(user_id|device_id|phone_number)"'
```

Read the hits — `Authorization: Bearer ${api.userToken}` is source code doing its
job, not a leak. A grep is the floor, not the check.

The realistic leak in *this* project is not a committed `.env`. It is **probe
output pasted into a doc.** We debug this private API by running authenticated
probes against a real personal account and writing up what comes back, and those
responses carry bearer tokens, user ids, device ids, emails and other people's
posts. So when documenting a probe: **write down what it proved, not what it
returned.** Redact `token`, `user_id`, `device_id`, `email`, `phone_number` and
any `Authorization` header if a raw payload must be quoted at all.

A leaked Sidechat token is a full account takeover, and git history is public
too — deleting a secret in a later commit does not remove it from any clone.

# Document as you go

**Every non-trivial decision or discovery gets written to a doc file in the same
change that introduces it.** Not at the end of a phase, not "when it settles" —
in the same turn. Assume the next session starts with none of this context.

## What counts

Write it down when it is any of:

- an **architecture or design decision** (URL shape, hosting model, state
  strategy, theme/color choices)
- an **API discovery** (an endpoint's real behaviour, an undocumented field, a
  probe result, an auth step)
- a **blocker or open problem**, including *which phase and which screen* it will
  first bite — a blocker without that pointer is not documented
- a **workaround** for a third-party defect, with a link to the upstream cause
- a **deliberate divergence** from the official Yik Yak app or from `offsides`

Skip it for trivial bugfixes, formatting, dependency bumps, and anything already
obvious from the code or `git log`.

## Where it goes

| File | Holds |
|---|---|
| [PLAN.md](PLAN.md) | Roadmap, phase checklists, parity matrix, live blocker list |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | URL shape, hosting/deploy model, app structure, data flow |
| [docs/API.md](docs/API.md) | Sidechat API behaviour, auth flow, ID resolution, endpoint probes, sidechat.js defects |
| [docs/DESIGN.md](docs/DESIGN.md) | Color tokens, type scale, layout rules, component conventions |
| [docs/OFFSIDES.md](docs/OFFSIDES.md) | What the reference Android client already solved, and where we diverge |
| [docs/WORKER.md](docs/WORKER.md) | The deferred Cloudflare Worker: why, what it does, how to wire it in |
| [docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md) | Release audit before going public: what must be scrubbed, the standing pre-commit rule |

## Check offsides first

[offsides](https://github.com/micahlt/offsides) is a third-party Yik Yak client
for Android by **the same author as sidechat.js**, and it is the closest thing
this private API has to documentation. **Before debugging any API behaviour —
a wrong request shape, a missing field, a surprising response — read their
source for it.** They have already hit most of what we will hit. Anything new
learned from them goes into [docs/OFFSIDES.md](docs/OFFSIDES.md), including the
cases where we deliberately do it differently and why.

Blockers live in **two** places on purpose: the detail in `docs/API.md` or
`docs/ARCHITECTURE.md`, and a one-line pointer in the relevant `PLAN.md` phase so
it is impossible to start that phase without seeing it.

When a decision is reversed, edit the existing entry and say what changed and
why. Do not leave two contradictory entries standing.
