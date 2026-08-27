@AGENTS.md

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
