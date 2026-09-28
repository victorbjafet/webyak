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
