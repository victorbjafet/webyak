// Runs the Worker in Node against a stubbed `fetch`: no network, no Cloudflare.
//   node --test worker/test/
// Node 22 has Request, Response and fetch built in. `caches` doesn't exist
// here, which the Worker treats as "no cache", as it must in the dashboard
// preview.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import worker from '../src/index.js';

const ORIGIN = 'https://webyak.vbjfr.xyz';
const realFetch = globalThis.fetch;
let calls = [];

/** Answers the Worker's upstream requests from `handler`, recording each. */
function stubFetch(handler) {
  calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers || {});
    calls.push({ url, method: init.method || 'GET', headers, body: init.body });
    return handler(url, init);
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function call(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Origin') && init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
  const request = new Request(`https://worker.example${path}`, { ...init, headers });
  const ctx = { waitUntil() {} };
  return worker.fetch(request, {}, ctx);
}

const jsonBody = (res) => res.json();

describe('origins and CORS', () => {
  it('answers the root with its routes', async () => {
    const res = await call('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.ok((await jsonBody(res)).routes.includes('GET /media'));
  });

  it('refuses a page on another origin', async () => {
    const res = await call('/', { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('lets a request with no Origin through, without CORS headers', async () => {
    const res = await call('/', { origin: null });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('answers a preflight from the dev server', async () => {
    const res = await call('/upload', { method: 'OPTIONS', origin: 'http://localhost:8081' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8081');
    assert.match(res.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  });

  it('reads ALLOWED_ORIGINS from the environment', async () => {
    const request = new Request('https://worker.example/', { headers: { Origin: 'https://other.example' } });
    const res = await worker.fetch(request, { ALLOWED_ORIGINS: 'https://other.example/, https://x.example' }, { waitUntil() {} });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://other.example');
  });
});

describe('POST /upload', () => {
  it('rejects a type outside png, jpeg and gif', async () => {
    const res = await call('/upload?content_type=webp', { method: 'POST', body: 'x', headers: { Authorization: 'Bearer t' } });
    assert.equal(res.status, 400);
  });

  it('needs the caller\'s token', async () => {
    const res = await call('/upload?content_type=png', { method: 'POST', body: 'x' });
    assert.equal(res.status, 401);
  });

  it('gets an upload URL with the token, then PUTs the bytes without it', async () => {
    stubFetch(async (url, init) => {
      if (url.startsWith('https://api.sidechat.lol/v1/assets/upload_url')) {
        return Response.json({ upload_url: 'https://bucket.example/put?sig=1', asset_id: 'asset-1' });
      }
      if (url.startsWith('https://bucket.example/') && init.method === 'PUT') return new Response('', { status: 200 });
      return new Response('unexpected', { status: 500 });
    });
    const res = await call('/upload?content_type=png', {
      method: 'POST',
      body: new Uint8Array([137, 80, 78, 71]),
      headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'image/png' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await jsonBody(res), { asset_id: 'asset-1' });
    assert.equal(calls[0].headers.get('Authorization'), 'Bearer secret-token');
    assert.equal(calls[0].headers.get('App-Version'), '6.0.0');
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].headers.get('Authorization'), null);
    assert.equal(calls[1].headers.get('Content-Type'), 'image/png');
    assert.equal(calls[1].body.byteLength, 4);
  });

  it('passes a 401 from Sidechat through', async () => {
    stubFetch(async () => Response.json({ message: 'unauthorized' }, { status: 401 }));
    const res = await call('/upload?content_type=jpeg', { method: 'POST', body: 'x', headers: { Authorization: 'Bearer bad' } });
    assert.equal(res.status, 401);
  });

  it('refuses a body over 10 MB', async () => {
    const res = await call('/upload?content_type=png', {
      method: 'POST',
      body: new Uint8Array(10 * 1024 * 1024 + 1),
      headers: { Authorization: 'Bearer t' },
    });
    assert.equal(res.status, 413);
  });
});

describe('GET /asset', () => {
  it('only fetches from api.sidechat.lol', async () => {
    const res = await call(`/asset?url=${encodeURIComponent('https://evil.example/x')}`, { headers: { Authorization: 'Bearer t' } });
    assert.equal(res.status, 400);
  });

  it('follows the redirect without the bearer', async () => {
    stubFetch(async (url) => {
      if (url.startsWith('https://api.sidechat.lol/')) {
        return new Response(null, { status: 302, headers: { Location: 'https://b.r2.cloudflarestorage.com/o?X-Amz-Signature=s' } });
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
    });
    const target = 'https://api.sidechat.lol/v1/assets?post_id=p&asset_id=a';
    const res = await call(`/asset?url=${encodeURIComponent(target)}`, { headers: { Authorization: 'Bearer t' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(calls[0].headers.get('Authorization'), 'Bearer t');
    assert.equal(calls[1].headers.get('Authorization'), null);
    assert.equal((await res.arrayBuffer()).byteLength, 3);
  });
});

describe('GET /media', () => {
  it('only relays R2', async () => {
    const res = await call(`/media?u=${encodeURIComponent('https://api.sidechat.lol/v1/assets/x.ts')}`);
    assert.equal(res.status, 400);
  });

  it('relays a segment with CORS and its type', async () => {
    stubFetch(async () => new Response(new Uint8Array(8), { headers: { 'Content-Type': 'video/mp2t', 'Content-Length': '8' } }));
    const segment = 'https://sidechat-assets.abc.r2.cloudflarestorage.com/seg0.ts?X-Amz-Signature=s';
    const res = await call(`/media?u=${encodeURIComponent(segment)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'video/mp2t');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(calls[0].url, segment);
  });
});

describe('GET /post/:code and /group/:slug', () => {
  // A SvelteKit __data.json: a layout node, then the page node, whose data is
  // devalue-flattened (objects hold indices into the same array).
  const postPage = {
    type: 'data',
    nodes: [
      { type: 'data', data: [{ user: 1 }, null], uses: {} },
      {
        type: 'data',
        data: [
          { post: 1, comments: 4 },
          { id: 2, text: 3, vote_total: 8, tags: 9 },
          'post-id',
          'hello',
          [5, 10],
          { id: 6, text: 7 },
          'comment-1',
          'hi',
          12,
          [],
          { id: 11, text: 7 },
          'comment-2',
        ],
        uses: {},
      },
      { type: 'skip' },
    ],
  };

  it('rehydrates the post and its comments', async () => {
    stubFetch(async (url) => {
      assert.match(url, /^https:\/\/web\.yikyak\.com\/cy\/x\/comments\/0ESz5N3t\/x\/__data\.json/);
      return Response.json(postPage);
    });
    const res = await call('/post/0ESz5N3t');
    assert.equal(res.status, 200);
    const body = await jsonBody(res);
    assert.deepEqual(body.post, { id: 'post-id', text: 'hello', vote_total: 12, tags: [] });
    assert.deepEqual(body.comments, [
      { id: 'comment-1', text: 'hi' },
      { id: 'comment-2', text: 'hi' },
    ]);
  });

  it('says not_found when the page has no post', async () => {
    stubFetch(async () => Response.json({ type: 'data', nodes: [{ type: 'data', data: [{ other: 1 }, 2] }] }));
    assert.equal((await call('/post/abcd1234')).status, 404);
  });

  it('passes an upstream 404 on as not_found', async () => {
    stubFetch(async () => new Response('nope', { status: 404 }));
    assert.equal((await call('/post/abcd1234')).status, 404);
  });

  it('rejects a code that is not a share code', async () => {
    assert.equal((await call('/post/..%2Fetc')).status, 400);
  });

  it('resolves a group by slug', async () => {
    stubFetch(async () =>
      Response.json({ type: 'data', nodes: [{ type: 'data', data: [{ group: 1 }, { id: 2, name: 3 }, 'g-1', 'Wordle'] }] }),
    );
    const res = await call('/group/wordle');
    assert.equal(res.status, 200);
    assert.deepEqual(await jsonBody(res), { group: { id: 'g-1', name: 'Wordle' } });
  });

  it('keeps devalue sentinels and shared references', async () => {
    stubFetch(async () =>
      Response.json({
        type: 'data',
        nodes: [
          {
            type: 'data',
            data: [{ post: 1 }, { id: 2, a: -1, b: 3, c: 3, d: 5 }, 'p', { x: 4 }, 1, ['Date', '2026-09-28T00:00:00.000Z']],
          },
        ],
      }),
    );
    const body = await jsonBody(await call('/post/abcd1234'));
    assert.equal(body.post.id, 'p');
    assert.equal('a' in body.post, false, 'undefined drops out of the JSON');
    assert.deepEqual(body.post.b, { x: 1 });
    assert.deepEqual(body.post.c, { x: 1 });
    assert.equal(body.post.d, '2026-09-28T00:00:00.000Z');
  });
});

describe('everything else', () => {
  it('404s an unknown path', async () => {
    assert.equal((await call('/nope')).status, 404);
  });

  it('405s a wrong method', async () => {
    assert.equal((await call('/media', { method: 'POST', body: 'x' })).status, 405);
  });
});
