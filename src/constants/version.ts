/**
 * webyak's version, shown at the top of Settings and in diagnostics reports:
 * `yyyy.mm.dd.v`, the date of the commit and then which commit of that day it
 * is, counting from 0.
 *
 * **Every commit bumps it** — the rule is in AGENTS.md. This is the version.
 * The `version` fields in package.json and app.json stay at 1.0.0: npm expects
 * semver there, and iOS allows at most three numbers.
 */
export const APP_VERSION = '2026.09.27.0';
