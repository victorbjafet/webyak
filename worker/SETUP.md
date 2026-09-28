# Setting up the Worker in the Cloudflare dashboard

This puts webyak's Worker online and points the app at it. It takes about ten
minutes, needs a free Cloudflare account, and nothing else: no card, no
domain, no command line.

**What you get.** Four things webyak can't do from a browser start working:

- **Image attachments.** The composer shows a *Photo* button.
- **Video playback in Chrome and Firefox.** Safari plays video without the
  Worker already.
- **Video thumbnails and other images that need your login.**
- **Pasted yikyak.com links** (`/p/<share code>`), for posts in public
  communities. School communities may not resolve.

Why a Worker is needed at all is in [docs/WORKER.md](../docs/WORKER.md). The
code is one file, [src/index.js](src/index.js), with no dependencies.

---

## 1. Create the Worker

1. Sign in at <https://dash.cloudflare.com>.
2. In the left sidebar, open **Workers & Pages**. On some accounts it sits
   under **Compute (Workers)**.
3. Select **Create application**. The button may just say **Create**.
4. Choose **Start with Hello World!**.
5. Name it **`webyak-worker`**. The name becomes part of its address, and the
   command-line route below assumes this one.
6. Select **Deploy**.

You land on the Worker's page. Its address is shown there, in the form
`https://webyak-worker.<your-subdomain>.workers.dev`. Copy it; steps 5 and 6
need it.

## 2. Replace the code with webyak's

1. On the Worker's page, select **Edit code** (top right).
2. The editor shows one file, `worker.js`. Select everything in it and delete
   it.
3. Open [worker/src/index.js](src/index.js) from this repo, copy **all** of
   it, and paste it into the editor.
4. Select **Deploy** (top right), and confirm.
5. Check it: open the Worker's address in a new browser tab. You should see:

   ```json
   {"ok":true,"routes":["POST /upload","GET /asset","GET /media","GET /post/:code","GET /group/:slug"]}
   ```

   If you still see "Hello World!", the deploy didn't take. Redo step 4.

## 3. Turn request logging off

New Workers log every request by default, and some of webyak's request URLs
carry signed links and account ids. Nothing about the Worker needs logs.

1. On the Worker's page, open **Settings**.
2. Find **Observability**. Next to **Workers Logs**, edit the setting
   (usually a pencil icon), switch it **off**, and save.

If that section looks different, the aim is simply that Workers Logs shows as
disabled.

## 4. Say which sites may use it (optional)

The Worker only answers webyak's own pages. By default that means
`https://webyak.vbjfr.xyz` and the dev server, `http://localhost:8081`. To
change the list:

1. **Settings** → **Variables and Secrets** → **Add**.
2. Type: **Text**. Variable name: **`ALLOWED_ORIGINS`**. Value: the sites,
   separated by commas, for example
   `https://webyak.vbjfr.xyz,http://localhost:8081`.
3. Select **Deploy**.

There are **no secrets to add.** The Worker never holds a login. It forwards
the one the app sends with each request and keeps nothing.

## 5. Point the live site at it

The live site is built by GitHub Actions, which reads the Worker's address
from a repository variable. You don't need to change any code.

1. On GitHub, open the webyak repository → **Settings** → **Secrets and
   variables** → **Actions**.
2. Open the **Variables** tab (not Secrets) → **New repository variable**.
3. Name: **`WORKER_URL`**. Value: the address from step 1, e.g.
   `https://webyak-worker.<your-subdomain>.workers.dev`, with no trailing
   slash.
4. Deploy again: push anything, or **Actions** → **Deploy to GitHub Pages** →
   **Run workflow**.

It's a variable rather than a secret because the address ends up in the
site's JavaScript either way. It isn't sensitive.

## 6. Point your dev server at it

1. In the repo root, create a file named `.env` (it's gitignored) containing:

   ```
   EXPO_PUBLIC_WORKER_URL=https://webyak-worker.<your-subdomain>.workers.dev
   ```

2. Restart the dev server **with `--clear`**: `npx expo start --clear`.
   `EXPO_PUBLIC_*` values are baked in when a file is compiled, and without
   `--clear` the old compiled files are reused.

## 7. Check that it works

- **Uploads:** the composer now shows **Photo**. Attach an image and post it.
- **Video:** a video post plays in Chrome.
- **Refusal:** from a terminal, a request claiming to come from another site
  is refused:

  ```sh
  curl -s -H "Origin: https://example.com" https://webyak-worker.<your-subdomain>.workers.dev/
  # {"error":"origin_not_allowed"}
  ```

---

## Updating it later

When `worker/src/index.js` changes, repeat **step 2**: *Edit code*, replace
everything, *Deploy*. Nothing else needs redoing.

### The command-line way

For anyone who prefers it, this does the same as steps 1–3 and later updates:

```sh
cd worker
npx wrangler@latest login     # opens a browser once
npx wrangler@latest deploy    # reads wrangler.jsonc
```

[wrangler.jsonc](wrangler.jsonc) names the Worker `webyak-worker`, so it
updates the one made in the dashboard rather than creating another. It keeps
Workers Logs off, and it leaves `ALLOWED_ORIGINS` as set in the dashboard.

## Testing it without deploying

```sh
cd worker && npm test
```

This runs every route in Node against stubbed upstreams, with no network and
no Cloudflare account involved.

## Cost

The free plan covers personal use. Its limits, per Cloudflare's docs as of
2026-09-28:

- **100,000 requests a day.** Every image through `/asset` and every video
  segment through `/media` counts as one. A short video is a handful of
  segments.
- **10 ms of CPU per request.** The Worker mostly waits on the network, which
  doesn't count toward that.
- **100 MB request bodies.** The Worker caps uploads at 10 MB itself.

## What it can't do

- **School-community share links may not resolve.** `/post/:code` reads the
  public Yik Yak site, which answered "couldn't find that post" for a Virginia
  Tech code when it was tested. Links copied from webyak carry the post id and
  never need the Worker.
- **It doesn't make webyak work logged out.** Everything else still talks to
  Sidechat directly, with your login.
