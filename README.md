# webyak

A web-first Yik Yak client, built on [Expo Router](https://docs.expo.dev/router/introduction/)
and [sidechat.js](https://github.com/micahlt/sidechat.js). Aims at parity with
the official app, plus a few things it never had.

Runs at **[webyak.vbjfr.xyz](https://webyak.vbjfr.xyz)** — a static single-page
app on GitHub Pages. Source at
[github.com/victorbjafet/webyak](https://github.com/victorbjafet/webyak).

There is no backend today. One is coming: image upload cannot work from a
static origin (see below), and a small Cloudflare Worker is specced to relay it.

## Status

Early, but usable. Reading works — feeds, sorting, posts, comments, polls,
images and video. Writing works too: voting, composing, comments and replies,
polls, quote-reposts and deleting your own content, all verified against the
live API and confirmed to sync both ways with the official app.

**Known gap: image attachments are disabled.** The upload is a pre-signed `PUT`
to Yik Yak's storage host, which a browser cannot issue — a cross-origin `PUT`
always preflights and that bucket answers no preflight from our origin. Native
clients never hit this because CORS doesn't exist for them. The fix is a small
relay in the Worker; the control stays hidden until one is configured, rather
than offering an upload that provably cannot finish.
[docs/API.md](docs/API.md#-image-upload-is-blocked-by-cors) has the detail.

See [PLAN.md](PLAN.md) for the roadmap and the rest of the gaps.

## Read this before you trust it

**This is an unofficial client for a private, undocumented API.** Yik Yak
publishes no API and has not sanctioned this. Endpoints can change or vanish
without notice, and using a non-official client may well be against their terms
of service. Run it against your own account, at human request rates, and
understand that the account is yours to lose.

**On the web, your session token lives in `localStorage`.** Browsers have no
keychain, and `expo-secure-store` has no web implementation, so there is nowhere
better to put it — which means any script running on the origin can read it. The
mitigation is that we ship *zero* third-party scripts: no analytics, no tags, no
CDN embeds. If you fork this and add one, you have made your users' tokens
readable by whoever wrote it. Native builds use the platform keychain instead.

Logging in requires a phone number, because that is how Yik Yak's auth works. The
token it returns is a real account credential — treat it like a password.

## Running it

```sh
git clone https://github.com/victorbjafet/webyak.git
cd webyak
npm install
npx expo start          # dev, all platforms
npm run build:web       # static export to dist/
```

`npm run build:web` also writes the `.nojekyll`, `404.html` and `CNAME` files
that GitHub Pages needs — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for
why each one is load-bearing.

### Configuration

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_BASE_URL` | Public origin used to build share links. Defaults to `https://webyak.vbjfr.xyz`. |
| `EXPO_PUBLIC_WORKER_URL` | Cloudflare Worker base URL. Unset by default. Enables share-code resolution **and image attachments**, which are hidden without it — see [docs/WORKER.md](docs/WORKER.md). |

Put them in a `.env`, which is gitignored.

## Documentation

Everything non-obvious is written down as it is discovered — that rule is in
[CLAUDE.md](CLAUDE.md).

| File | Holds |
|---|---|
| [PLAN.md](PLAN.md) | Roadmap, phase checklists, parity matrix, live blockers |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | URL shape, hosting model, app structure, data flow |
| [docs/API.md](docs/API.md) | What the Sidechat API actually does: auth flow, ID resolution, probe results, library defects |
| [docs/DESIGN.md](docs/DESIGN.md) | Color tokens, type scale, layout rules |
| [docs/OFFSIDES.md](docs/OFFSIDES.md) | What the reference Android client solved first, and where we diverge |
| [docs/WORKER.md](docs/WORKER.md) | The deferred Cloudflare Worker |
| [docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md) | Secret-hygiene rules for contributing |

## Contributing

One rule beyond the usual: **never paste raw probe output into a file.** Debug
sessions here run authenticated requests against a live account, and the
responses carry bearer tokens, user ids, device ids and other people's posts.
Write down what a probe *proved*, not what it *returned*.
[docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md) has the details and the pre-commit
check.

## Credits

[sidechat.js](https://github.com/micahlt/sidechat.js) and
[offsides](https://github.com/micahlt/offsides), both by
[@micahlt](https://github.com/micahlt), did the hard reverse-engineering work
this is built on.

## License

[MIT](LICENSE). Not affiliated with, endorsed by, or connected to Yik Yak.
