// Opens a stand-in tab: webyak from the dev server on http://127.0.0.1:8081,
// a different origin from the signed-in localhost:8081, so its storage is its
// own. Every request to api.sidechat.lol from THIS tab only is answered here
// from fixtures and never reaches Sidechat. The fake session is a made-up
// token in 127.0.0.1's localStorage.
//
// State lives on the browser context as `__harness`, so later snippets can
// change fixtures (`h.data`) and read the request log (`h.log`).
async (page) => {
  const ctx = page.context();
  for (const old of ctx.pages()) if (old.url().startsWith('http://127.0.0.1:8081')) await old.close();
  // The sandbox has no URL or URLSearchParams.
  const parse = (raw) => {
    const [full, search = ''] = raw.split('?');
    const params = {};
    for (const pair of search.split('&').filter(Boolean)) {
      const [k, v = ''] = pair.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    return { path: full.replace(/^https:\/\/[^/]+/, '').replace(/\/+$/, ''), params, search };
  };
  const hex = (n) => n.toString(16).padStart(12, '0');
  const id = (prefix, n) => `${prefix}-0000-4000-8000-${hex(n)}`;
  const now = Date.now();
  const iso = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();

  const ME = id('aaaaaaaa', 1);
  const group = {
    id: id('99999999', 1),
    name: 'Test University',
    analytics_name: 'test',
    membership_type: 'member',
    color: '#9796F0',
    group_join_type: 'open',
    group_visibility: 'public_to_all',
    asset_library_visibility: 'show',
    member_count: 1234,
  };
  // The combined feed. The API calls it "Home", index_name "all"; the app
  // shows it as For You, with the Unread filter.
  const home = { ...group, id: id('99999999', 2), name: 'Home', index_name: 'all', analytics_name: 'home' };
  const base = (extra) => ({
    type: 'post',
    authored_by_user: false,
    alias: 'Anonymous',
    group_id: group.id,
    group,
    vote_total: 3,
    vote_status: 'none',
    assets: [],
    attachments: [],
    dms_disabled: false,
    tags: [],
    identity: { name: 'Anonymous' },
    pinned: false,
    is_saved: false,
    follow_status: 'not_following',
    awards: [],
    ...extra,
  });
  // Scores vary, so a sort by score has something to reorder.
  const post = (n, extra = {}) =>
    base({ id: id('bbbbbbbb', n), text: `Stand-in post ${n}`, created_at: iso(n * 7), comment_count: 0, vote_total: (n * 17) % 40, ...extra });

  const P1 = post(1, { text: 'A post with a long thread', comment_count: 30, authored_by_user: true });
  const mine = [post(4, { authored_by_user: true }), post(5, { authored_by_user: true })];
  const comments = [];
  for (let i = 1; i <= 30; i++) {
    const parent = i % 5 === 0 ? comments[comments.length - 1] : null;
    comments.push(
      base({
        type: 'comment',
        id: id('cccccccc', i),
        text: `Comment ${i}${parent ? ' (a reply)' : ''}`,
        created_at: iso(200 - i),
        parent_post_id: P1.id,
        reply_post_id: parent ? parent.id : P1.id,
        authored_by_user: i % 6 === 1 || i === 19,
        vote_total: (i * 13) % 30,
      }),
    );
  }

  const data = {
    me: ME,
    group,
    home,
    // Every feed post can also be fetched by id.
    posts: Object.fromEntries([P1, post(2), post(3), ...mine].map((p) => [p.id, p])),
    comments: { [P1.id]: comments },
    feed: [P1, post(2), post(3), ...mine],
    activity: [
      {
        id: `comment_reply~${id('cccccccc', 20)}`,
        type: 'comment_reply',
        timestamp: iso(5),
        is_seen: false,
        text: 'Someone replied to your comment',
        post_id: P1.id,
        comment_id: id('cccccccc', 19),
        comment_reply_id: id('cccccccc', 20),
      },
      {
        id: `takedown~${id('bbbbbbbb', 99)}`,
        type: 'takedown',
        timestamp: iso(90),
        is_seen: false,
        text: 'Your post was removed',
        takedown_data: {
          id: id('bbbbbbbb', 99),
          type: 'post',
          client_facing_removal_text: 'Stand-in notice: this post broke a stand-in rule.',
          reason: 'stand_in',
          moderator_type: 'stand_in',
          is_acknowledged: false,
        },
      },
      {
        id: `votes~${P1.id}~10`,
        type: 'votes',
        timestamp: iso(60),
        is_seen: true,
        text: 'Your post reached 10 karma',
        post_id: P1.id,
      },
    ],
    updates: {},
    removed: { posts: [], comments: [], reasons: {} },
  };

  const h = (ctx.__harness = { data, log: [], ids: { ME, P1: P1.id, comment: (n) => id('cccccccc', n) } });

  const tab = await ctx.newPage();
  await tab.route('https://api.sidechat.lol/**', async (route) => {
    const req = route.request();
    const { path, params, search } = parse(req.url());
    const method = req.method();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let body = null;
    try {
      body = req.postDataJSON();
    } catch {}
    h.log.push({ method, path, query: search, body });
    const d = h.data;
    const reply = (json, status = 200) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(json) });

    if (d.override) {
      const out = d.override({ method, path, params, body });
      if (out) return reply(out.json, out.status);
    }
    if (path === '/v1/users/me')
      return reply({ id: d.me, memberships: [{ groupId: d.group.id, type: 'member' }], roles: [] });
    if (path === '/v1/updates')
      return reply({
        groups: [d.home, d.group],
        user: { id: d.me, username: 'tester' },
        unacknowledged_removed_post_ids: d.removed,
        activity_items: { items: d.activity, cursor: null },
        ...d.updates,
      });
    if (path === '/v1/activity') return reply({ items: d.activity, cursor: null });
    if (path === '/v1/posts/get') {
      const p = d.posts[params.post_id];
      return p ? reply({ post: p }) : reply({ message: 'Post not found' }, 404);
    }
    if (path === '/v1/posts/comments')
      return reply({ posts: d.comments[params.post_id] ?? [] });
    if (path === '/v1/posts' && method === 'GET') {
      if (params.type === 'my_posts') return reply({ posts: d.feed.filter((p) => p.authored_by_user) });
      if (params.type === 'my_comments')
        return reply({ posts: Object.values(d.comments).flat().filter((c) => c.authored_by_user) });
      return reply({ posts: d.feed, cursor: null });
    }
    if (path.startsWith('/v1/chats') && method === 'GET') return reply({ chats: [], messages: [], groups: [] });
    return reply({});
  });

  await tab.goto('http://127.0.0.1:8081/login');
  await tab.evaluate(
    ({ me, group }) => {
      localStorage.setItem('webyak.token', 'stand-in-token');
      localStorage.setItem('webyak.userId', me);
      localStorage.setItem('webyak.primaryGroup', JSON.stringify(group));
    },
    { me: ME, group },
  );
  await tab.goto('http://127.0.0.1:8081/');
  return { tabs: ctx.pages().length, ids: { P1: P1.id, reply20: id('cccccccc', 20) } };
}
