const { test } = require('node:test');
const assert = require('node:assert');
const pkg = require('../package.json');
const {
    apiDocs,
    docsHtmlPage,
    apiDocsJsonHandler,
    apiDocsPageHandler,
} = require('../utils/apiDocs');

// Structural invariants only (per the #33 spec): the docs object is
// hand-curated, so content is asserted nowhere — but every entry must be
// well-formed, unique, serializable, and version-stamped, and both handlers
// must serve what they claim. Handlers are invoked directly with mock
// req/res (same style as observability.test.js) because supertest is not a
// dependency and app.js starts a listener on require.

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Minimal res stub covering exactly what the two handlers call.
const mockRes = () => {
    const r = { headers: {}, statusCode: null, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.type = (t) => {
        // Mirror express: res.type('html') -> 'text/html; charset=utf-8'
        r.headers['Content-Type'] =
            t === 'html' ? 'text/html; charset=utf-8'
                : t === 'json' ? 'application/json' : t;
        return r;
    };
    r.json = (obj) => { r.headers['Content-Type'] = 'application/json; charset=utf-8'; r.body = obj; return r; };
    r.send = (body) => { r.body = body; return r; };
    return r;
};

test('docs object carries info block stamped with the package.json version', () => {
    assert.equal(apiDocs.openapi.split('.')[0], '3'); // OpenAPI 3.x style
    assert.equal(apiDocs.info.title, 'Fresha Salon App API');
    assert.equal(apiDocs.info.version, pkg.version);
    assert.equal(typeof apiDocs.info.description, 'string');
    assert.ok(apiDocs.info.description.length > 0);
});

test('every endpoint entry has a valid method, path, auth and summary', () => {
    assert.ok(Array.isArray(apiDocs.endpoints));
    assert.ok(apiDocs.endpoints.length > 0);
    for (const e of apiDocs.endpoints) {
        assert.ok(METHODS.includes(e.method), `bad method on ${JSON.stringify(e)}`);
        assert.equal(typeof e.path, 'string');
        assert.ok(e.path.startsWith('/'), `path must start with / on ${e.path}`);
        assert.equal(typeof e.auth, 'string');
        assert.ok(e.auth.length > 0, `empty auth on ${e.path}`);
        assert.equal(typeof e.summary, 'string');
        assert.ok(e.summary.length > 0, `empty summary on ${e.path}`);
        assert.equal(typeof e.tag, 'string');
        assert.ok(e.tag.length > 0, `empty tag on ${e.path}`);
    }
});

test('method + path pairs are unique (no accidental duplicate entries)', () => {
    const keys = apiDocs.endpoints.map((e) => `${e.method} ${e.path}`);
    assert.equal(new Set(keys).size, keys.length);
});

test('every entry tag appears in the declared tags list', () => {
    for (const e of apiDocs.endpoints) {
        assert.ok(apiDocs.tags.includes(e.tag), `unknown tag "${e.tag}" on ${e.path}`);
    }
});

test('params (when present) are arrays of non-empty strings', () => {
    for (const e of apiDocs.endpoints) {
        if (e.params !== undefined) {
            assert.ok(Array.isArray(e.params), `params must be an array on ${e.path}`);
            for (const p of e.params) {
                assert.equal(typeof p, 'string');
                assert.ok(p.length > 0);
            }
        }
    }
});

test('docs object JSON round-trips losslessly (no functions/circulars)', () => {
    let roundTripped;
    assert.doesNotThrow(() => { roundTripped = JSON.parse(JSON.stringify(apiDocs)); });
    assert.deepEqual(roundTripped, apiDocs);
});

test('GET /api-docs.json handler dumps the full docs object as JSON with 200', () => {
    const res = mockRes();
    apiDocsJsonHandler({}, res); // handler ignores req entirely
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /^application\/json/);
    assert.deepEqual(res.body, apiDocs);
});

test('GET /api-docs handler serves self-contained HTML with 200', () => {
    const res = mockRes();
    apiDocsPageHandler({}, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /^text\/html/);
    assert.equal(res.body, docsHtmlPage);
    assert.ok(res.body.startsWith('<!doctype html'));
    // Viewer contract: fetches the JSON dump, renders METHOD badges + auth
    // chips, has a client-side filter box — all without external resources.
    assert.ok(res.body.includes('/api-docs.json'));
    assert.ok(res.body.includes('<input id="filter"'));
    assert.ok(res.body.includes('class="method'));
    assert.ok(res.body.includes('class="auth"'));
    assert.ok(res.body.includes('prefers-color-scheme')); // dark-mode support
    assert.ok(!/https?:\/\//.test(res.body), 'no external URLs (CSP-friendly)');
});
