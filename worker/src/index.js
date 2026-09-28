/**
 * webyak's Cloudflare Worker.
 *
 * docs/WORKER.md says why it exists and what each route is for; worker/SETUP.md
 * says how to deploy it. In short: webyak is a static site, and a handful of
 * requests cannot be made from a browser at all (CORS, or a redirect a
 * preflighted request may not follow). This Worker makes exactly those
 * requests, server to server, and nothing else.
 *
 * One file, no dependencies, plain JavaScript, so it can be pasted into the
 * Cloudflare dashboard's code editor as it is, or deployed with Wrangler.
 *
 * Routes:
 *
 *   POST /upload?content_type=png|jpeg|gif   image bytes → { asset_id }
 *   GET  /asset?url=<api.sidechat.lol URL>    an authed image, redirect followed
 *   GET  /media?u=<R2 segment URL>            a video segment, with CORS headers
 *   GET  /post/:code                          a yikyak.com share code → { post, comments }
 *   GET  /group/:slug                         a community slug → { group }
 *   GET  /                                    { ok, routes }, for a quick check
 *
 * Rules it keeps (docs/WORKER.md):
 *
 * - **It holds no credentials.** `/upload` and `/asset` forward the caller's
 *   own `Authorization` header and nothing else. There are no secrets to set.
 * - **It is not an open proxy.** Each relay checks the target host first:
 *   `/asset` only fetches from api.sidechat.lol, `/media` only from
 *   *.r2.cloudflarestorage.com, and the two scrapes build their own URL.
 * - **It never logs a URL or a header.** Those carry tokens, signatures and
 *   user ids. Errors are reported by kind, not by what was requested.
 * - **Only webyak's own origins get CORS headers.** Set `ALLOWED_ORIGINS`
 *   (comma-separated) in the Worker's settings; the defaults cover the live
 *   site and the dev server. A browser request from any other origin is
 *   refused outright.
 */

const SIDECHAT_API = 'https://api.sidechat.lol';
const YIKYAK_WEB = 'https://web.yikyak.com';

const DEFAULT_ORIGINS = ['https://webyak.vbjfr.xyz', 'http://localhost:8081'];

/** Well above a phone photo, far below anything worth abusing. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The set `uploadAssetWeb` already enforces client-side. */
const IMAGE_TYPES = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };

/** sidechat.js's default headers, which the API expects on every call. */
const SIDECHAT_HEADERS = {
  Accept: 'application/json',
  'App-Version': '6.0.0',
  Dnt: '1',
};

/** The two scrapes are public and hot-linked; a minute of caching is plenty. */
const SCRAPE_CACHE_SECONDS = 60;

/** A segment never changes. Its URL's signature lasts about 12 hours. */
const MEDIA_CACHE_SECONDS = 60 * 60;

const ROUTES = ['POST /upload', 'GET /asset', 'GET /media', 'GET /post/:code', 'GET /group/:slug'];

export default {
  async fetch(request, env, ctx) {
    const origins = allowedOrigins(env);
    const origin = request.headers.get('Origin');
    const allowed = !origin || origins.includes(origin);
    const cors = allowed && origin ? corsHeaders(origin) : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    }
    // A browser page on another site. Requests without an Origin (curl, the
    // Worker's own checks) carry no page to protect, so they go through.
    if (!allowed) return json({ error: 'origin_not_allowed' }, 403);

    const url = new URL(request.url);
    let response;
    try {
      response = await route(request, url, ctx);
    } catch (error) {
      response = json({ error: 'worker', message: describe(error) }, 500);
    }
    return withHeaders(response, cors);
  },
};

async function route(request, url, ctx) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/upload') return method === 'POST' ? upload(request, url) : notAllowed('POST');
  if (pathname === '/asset') return method === 'GET' ? asset(request, url) : notAllowed('GET');
  if (pathname === '/media') return method === 'GET' ? media(request, url, ctx) : notAllowed('GET');
  if (pathname.startsWith('/post/')) {
    return method === 'GET' ? post(pathname.slice('/post/'.length), ctx) : notAllowed('GET');
  }
  if (pathname.startsWith('/group/')) {
    return method === 'GET' ? group(pathname.slice('/group/'.length), ctx) : notAllowed('GET');
  }
  if (pathname === '/') return json({ ok: true, routes: ROUTES });
  return json({ error: 'not_found' }, 404);
}

/* ------------------------------------------------------------------------ *
 * POST /upload — the byte relay image attachments need
 * ------------------------------------------------------------------------ */

/**
 * The storage host refuses a browser's pre-signed `PUT` (CORS), so the Worker
 * does the two steps the client would: ask the API for an upload URL with the
 * caller's token, then `PUT` the bytes there. Returns the `asset_id` that
 * `createPost` takes.
 */
async function upload(request, url) {
  const type = url.searchParams.get('content_type');
  const mime = IMAGE_TYPES[type];
  if (!mime) return json({ error: 'bad_content_type', allowed: Object.keys(IMAGE_TYPES) }, 400);

  const auth = bearer(request);
  if (!auth) return json({ error: 'no_token' }, 401);

  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_UPLOAD_BYTES) return json({ error: 'too_large', max: MAX_UPLOAD_BYTES }, 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: 'empty_body' }, 400);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return json({ error: 'too_large', max: MAX_UPLOAD_BYTES }, 413);
  }

  const ticket = await fetch(`${SIDECHAT_API}/v1/assets/upload_url?content_type=${type}`, {
    headers: { ...SIDECHAT_HEADERS, Authorization: auth },
  });
  if (!ticket.ok) return passError(ticket, 'upload_url');
  const { upload_url: uploadUrl, asset_id: assetId } = await ticket.json();
  if (typeof uploadUrl !== 'string' || typeof assetId !== 'string') {
    return json({ error: 'upstream_shape', step: 'upload_url' }, 502);
  }

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: bytes,
    headers: { 'Content-Type': mime },
  });
  if (!put.ok) return json({ error: 'upstream', step: 'put', status: put.status }, 502);

  return json({ asset_id: assetId });
}

/* ------------------------------------------------------------------------ *
 * GET /asset — authed images, redirect followed
 * ------------------------------------------------------------------------ */

/**
 * Some asset URLs need the bearer and then answer with a 302 to a signed R2
 * URL. A browser can't do that: the header forces a preflight, and a
 * preflighted request may not follow a cross-origin redirect. So the Worker
 * sends the bearer to api.sidechat.lol only, and follows the redirect
 * **without** it: S3-style storage rejects a request that carries both a
 * signature and an `Authorization` header.
 */
async function asset(request, url) {
  const target = safeUrl(url.searchParams.get('url'));
  if (!target || target.hostname !== 'api.sidechat.lol') return json({ error: 'bad_url' }, 400);

  const auth = bearer(request);
  let next = target.toString();
  let headers = { Accept: '*/*', 'App-Version': SIDECHAT_HEADERS['App-Version'], ...(auth ? { Authorization: auth } : {}) };

  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(next, { headers, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = safeUrl(res.headers.get('Location'), next);
      if (!location) return json({ error: 'bad_redirect' }, 502);
      next = location.toString();
      headers = { Accept: '*/*' };
      continue;
    }
    if (!res.ok) return json({ error: 'upstream', status: res.status }, res.status === 404 ? 404 : 502);
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
        // Authed content: the viewer's browser may keep it, a shared cache may not.
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }
  return json({ error: 'too_many_redirects' }, 502);
}

/* ------------------------------------------------------------------------ *
 * GET /media — video segments with CORS headers
 * ------------------------------------------------------------------------ */

/**
 * Video segments live on R2, presigned, and the bucket sends no CORS headers,
 * so hls.js can request them and cannot read them. No credentials pass through
 * here: the URL is its own. `Range` is forwarded for byte-range playlists.
 */
async function media(request, url, ctx) {
  const target = safeUrl(url.searchParams.get('u'));
  if (!target || !target.hostname.endsWith('.r2.cloudflarestorage.com')) {
    return json({ error: 'bad_url' }, 400);
  }

  const range = request.headers.get('Range');
  // Whole segments are cached on their full, signed URL. Ranged reads aren't.
  const cacheKey = range ? null : new Request(target.toString());
  const cached = cacheKey ? await cacheMatch(cacheKey) : null;
  if (cached) return cached;

  const res = await fetch(target.toString(), { headers: range ? { Range: range } : {} });
  if (!res.ok) return json({ error: 'upstream', status: res.status }, res.status === 404 ? 404 : 502);

  const headers = {
    'Content-Type': res.headers.get('Content-Type') || 'video/mp2t',
    'Cache-Control': `public, max-age=${MEDIA_CACHE_SECONDS}`,
  };
  for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const value = res.headers.get(name);
    if (value) headers[name] = value;
  }
  const response = new Response(res.body, { status: res.status, headers });
  if (cacheKey && res.status === 200) cachePut(ctx, cacheKey, response.clone());
  return response;
}

/* ------------------------------------------------------------------------ *
 * GET /post/:code and GET /group/:slug — the public web client's data
 * ------------------------------------------------------------------------ */

/**
 * A yikyak.com share code → the post and its comments, read from the public
 * web client's SvelteKit data endpoint. Only the code matters in that URL;
 * the `x` segments are placeholders and `cy` is a literal (docs/WORKER.md).
 *
 * Unverified for school communities: the public client said "couldn't find
 * that post" for one, so it may only serve public ones.
 */
async function post(rawCode, ctx) {
  const code = decodeURIComponent(rawCode);
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) return json({ error: 'bad_code' }, 400);
  const found = await scrape(
    `${YIKYAK_WEB}/cy/x/comments/${code}/x/__data.json?x-sveltekit-invalidated=01`,
    ctx,
    (node) => (node && typeof node === 'object' && node.post ? node : null),
  );
  if (found.response) return found.response;
  return json(
    { post: found.value.post, comments: Array.isArray(found.value.comments) ? found.value.comments : [] },
    200,
    { 'Cache-Control': `public, max-age=${SCRAPE_CACHE_SECONDS}` },
  );
}

/** A community slug → the group. A fallback: the app resolves slugs natively. */
async function group(rawSlug, ctx) {
  const slug = decodeURIComponent(rawSlug);
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(slug)) return json({ error: 'bad_slug' }, 400);
  const found = await scrape(
    `${YIKYAK_WEB}/cy/${slug}/__data.json?x-sveltekit-invalidated=01`,
    ctx,
    (node) => (node && typeof node === 'object' && node.group ? node : null),
  );
  if (found.response) return found.response;
  return json({ group: found.value.group }, 200, {
    'Cache-Control': `public, max-age=${SCRAPE_CACHE_SECONDS}`,
  });
}

/**
 * Fetches a SvelteKit `__data.json`, rehydrates each node, and returns the
 * first one `pick` accepts. Either `{ value }` or `{ response }` (an error).
 */
async function scrape(upstream, ctx, pick) {
  const cacheKey = new Request(upstream);
  let res = await cacheMatch(cacheKey);
  if (!res) {
    res = await fetch(upstream, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return { response: json({ error: 'not_found' }, 404) };
    if (!res.ok) return { response: json({ error: 'upstream', status: res.status }, 502) };
    const text = await res.text();
    res = new Response(text, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${SCRAPE_CACHE_SECONDS}` },
    });
    cachePut(ctx, cacheKey, res.clone());
  }

  const nodes = sveltekitNodes(await res.text());
  for (const node of nodes) {
    const value = pick(node);
    if (value) return { value };
  }
  return { response: json({ error: 'not_found' }, 404) };
}

/**
 * The page's data nodes, rehydrated. A `__data.json` is `{type: "data",
 * nodes: [...]}`, each node `{type: "data", data: [...]}` whose `data` is a
 * devalue-flattened array. Skipped nodes are dropped. When the body is
 * streamed as one JSON document per line, the first line is the page.
 */
function sveltekitNodes(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    const first = text.split('\n').find((line) => line.trim());
    doc = first ? JSON.parse(first) : null;
  }
  const nodes = Array.isArray(doc?.nodes) ? doc.nodes : [];
  return nodes
    .filter((node) => node && node.type === 'data' && Array.isArray(node.data))
    .map((node) => unflatten(node.data));
}

/* ------------------------------------------------------------------------ *
 * devalue's unflatten, inlined
 * ------------------------------------------------------------------------ */

// devalue's sentinels for values JSON can't hold.
const UNDEFINED = -1;
const HOLE = -2;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

/**
 * The inverse of devalue's `stringify`, the format SvelteKit ships data in:
 * one flat array where objects hold **indices** into that same array instead
 * of values, and index 0 is the root. Kept to the shapes a page's data can
 * use; SvelteKit's own client does the same pointer chase.
 */
function unflatten(values) {
  const hydrated = new Array(values.length);

  function hydrate(index) {
    if (index === UNDEFINED) return undefined;
    if (index === NAN) return NaN;
    if (index === POSITIVE_INFINITY) return Infinity;
    if (index === NEGATIVE_INFINITY) return -Infinity;
    if (index === NEGATIVE_ZERO) return -0;
    if (index in hydrated) return hydrated[index];

    const value = values[index];
    if (!value || typeof value !== 'object') {
      hydrated[index] = value;
    } else if (Array.isArray(value)) {
      if (typeof value[0] === 'string') {
        hydrated[index] = typed(value, hydrate, index);
      } else {
        const array = new Array(value.length);
        hydrated[index] = array;
        for (let i = 0; i < value.length; i++) {
          if (value[i] !== HOLE) array[i] = hydrate(value[i]);
        }
      }
    } else {
      const object = {};
      hydrated[index] = object;
      for (const key of Object.keys(value)) object[key] = hydrate(value[key]);
    }
    return hydrated[index];
  }

  function typed(value, hydrate, index) {
    switch (value[0]) {
      case 'Date':
        return new Date(value[1]);
      case 'Set': {
        const set = new Set();
        hydrated[index] = set;
        for (let i = 1; i < value.length; i++) set.add(hydrate(value[i]));
        return set;
      }
      case 'Map': {
        const map = new Map();
        hydrated[index] = map;
        for (let i = 1; i < value.length; i += 2) map.set(hydrate(value[i]), hydrate(value[i + 1]));
        return map;
      }
      case 'RegExp':
        return new RegExp(value[1], value[2]);
      case 'Object':
        return Object(value[1]);
      case 'BigInt':
        return BigInt(value[1]);
      case 'null': {
        const object = Object.create(null);
        hydrated[index] = object;
        for (let i = 1; i < value.length; i += 2) object[value[i]] = hydrate(value[i + 1]);
        return object;
      }
      default:
        // A type this page shouldn't carry. Left as its raw pair rather than
        // failing the whole response.
        return value;
    }
  }

  return hydrate(0);
}

/* ------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------ */

function allowedOrigins(env) {
  const configured = typeof env?.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS : '';
  const list = configured
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function withHeaders(response, extra) {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(extra)) out.headers.set(name, value);
  return out;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function notAllowed(method) {
  return json({ error: 'method_not_allowed', allow: method }, 405, { Allow: method });
}

/** The caller's bearer, if it looks like one. Never stored, never logged. */
function bearer(request) {
  const auth = request.headers.get('Authorization') || '';
  return /^Bearer \S+$/.test(auth) ? auth : null;
}

/** An https URL, or null. `base` resolves a relative redirect. */
function safeUrl(raw, base) {
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Passes a Sidechat error status through, with its body if it is JSON. */
async function passError(res, step) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  const status = res.status === 401 || res.status === 403 || res.status === 429 ? res.status : 502;
  return json({ error: 'upstream', step, status: res.status, ...(body && typeof body === 'object' ? { upstream: body } : {}) }, status);
}

function describe(error) {
  return String((error && error.message) || error).slice(0, 200);
}

/** The Cache API, best-effort: it does nothing in the dashboard preview. */
async function cacheMatch(key) {
  try {
    return (await caches.default.match(key)) || null;
  } catch {
    return null;
  }
}

function cachePut(ctx, key, response) {
  try {
    ctx.waitUntil(caches.default.put(key, response).catch(() => {}));
  } catch {
    // no cache here
  }
}
