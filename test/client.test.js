// -----------------------------------------------------------------------------
// The Tandoor client against the in-memory Tandoor (real answers of Tandoor
// 2.6.15): what it reads, what it writes, and how each failure is named.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, MAX_PAGES, PAGE_SIZE, TandoorClient } from '../src/tandoor/client.js';
import {
  BASE_URL,
  FakeTandoor,
  LIST_IDS,
  READ_ONLY_TOKEN,
  SPACE_ID,
  TOKEN,
} from './helpers/fakeTandoor.js';

function client(tandoor = new FakeTandoor(), options = {}) {
  return new TandoorClient({ url: BASE_URL, token: TOKEN, request: tandoor.request, ...options });
}

/** The kind of the TandoorError a promise rejects with. */
async function kindOf(promise) {
  try {
    await promise;
  } catch (err) {
    assert.equal(err.name, 'TandoorError', err.stack);
    return err.kind;
  }
  assert.fail('expected a TandoorError');
}

test('identify: the version (no token needed) and the space of the token', async () => {
  const tandoor = new FakeTandoor();
  const { version, space } = await client(tandoor).identify();
  assert.equal(version, '2.6.15');
  assert.deepEqual(space, { id: SPACE_ID, name: 'Maison' });
  assert.deepEqual(
    tandoor.requests.map((r) => r.path),
    ['server-settings/current/', 'space/current/'],
  );
});

test('reads the meal types, the meal plan, the lists and the entries', async () => {
  const tandoor = new FakeTandoor();
  const c = client(tandoor);
  assert.deepEqual(
    (await c.mealTypes()).map((type) => type.name),
    ['Déjeuner', 'Dîner', 'Petit-déjeuner'],
  );
  const meals = await c.mealPlans('2026-10-18', '2026-10-18');
  assert.deepEqual(
    meals.map((m) => m.recipe?.name),
    ['Bœuf bourguignon'],
  );
  assert.deepEqual(tandoor.requests.at(-1).query, {
    from_date: '2026-10-18',
    to_date: '2026-10-18',
    page: '1',
    page_size: String(PAGE_SIZE),
  });
  assert.deepEqual(
    (await c.shoppingLists()).map((l) => l.name),
    ['Supermarché', 'Marché'],
  );
  const entries = await c.shoppingEntries();
  assert.equal(entries.length, 4, 'the recently checked entry comes too');
  assert.equal(entries.filter((entry) => entry.checked).length, 1);
  assert.deepEqual(
    (await c.searchRecipes('lasag')).map((r) => r.name),
    ['Lasagnes'],
  );
});

test('a long list is read page by page, within a bound', async () => {
  const tandoor = new FakeTandoor();
  for (let i = 0; i < 450; i += 1) {
    tandoor.addEntry(`Article ${i}`);
  }
  const entries = await client(tandoor).shoppingEntries();
  assert.equal(entries.length, 454);
  assert.deepEqual(
    tandoor.requests.map((r) => r.query.page),
    ['1', '2', '3'],
  );

  for (let i = 0; i < PAGE_SIZE * MAX_PAGES; i += 1) {
    tandoor.addEntry(`More ${i}`);
  }
  tandoor.requests = [];
  assert.equal((await client(tandoor).shoppingEntries()).length, PAGE_SIZE * MAX_PAGES);
  assert.equal(tandoor.requests.length, MAX_PAGES);
});

test('adds an entry with the amount and unit the parser of Tandoor found', async () => {
  const tandoor = new FakeTandoor();
  const c = client(tandoor);
  const parsed = await c.parseIngredient('2 kg pommes');
  assert.equal(parsed.amount, 2);
  assert.equal(parsed.unit.name, 'kg');
  assert.equal(parsed.food.name, 'pommes');
  const entry = await c.addEntry(parsed, [{ id: LIST_IDS.MARCHE, name: 'Marché' }]);
  assert.equal(entry.food.name, 'pommes');
  const [write] = tandoor.writes();
  assert.deepEqual(write.body, {
    food: parsed.food,
    unit: parsed.unit,
    amount: 2,
    shopping_lists: [{ id: LIST_IDS.MARCHE, name: 'Marché' }],
  });
  // A plain name: no amount, no unit (Tandoor shows the food alone).
  assert.deepEqual(await c.parseIngredient('Lait'), {
    amount: 0,
    unit: null,
    food: { id: tandoor.foods.get('lait').id, name: 'Lait' },
  });
});

test('checks an entry with a PATCH of `checked` only', async () => {
  const tandoor = new FakeTandoor();
  const entry = await client(tandoor).setChecked(3, true);
  assert.equal(entry.checked, true);
  assert.deepEqual(tandoor.writes().at(-1), {
    method: 'PATCH',
    path: 'shopping-list-entry/3/',
    query: {},
    body: { checked: true },
  });
});

test('every failure has a kind: down, refused token (403), read-only token, no token', async () => {
  const tandoor = new FakeTandoor();
  tandoor.failure = 'down';
  assert.equal(await kindOf(client(tandoor).identify()), ERROR_KINDS.UNREACHABLE);

  // Tandoor answers 403 "credentials were not provided" to a wrong token.
  assert.equal(
    await kindOf(client(new FakeTandoor(), { token: 'tda_wrong' }).identify()),
    ERROR_KINDS.AUTH,
  );
  // A `read` token reads, and is refused a write with another 403.
  const reader = client(new FakeTandoor(), { token: READ_ONLY_TOKEN });
  await reader.identify();
  assert.equal(
    await kindOf(reader.addEntry({ amount: 0, unit: null, food: { name: 'Pain' } })),
    ERROR_KINDS.FORBIDDEN,
  );
  assert.equal(
    await kindOf(client(new FakeTandoor(), { token: '' }).identify()),
    ERROR_KINDS.TOKEN_MISSING,
  );
});

test('another service, a Tandoor 1.x, a redirect, a certificate, an HTTP error', async () => {
  const html = new FakeTandoor();
  html.failure = 'html';
  assert.equal(await kindOf(client(html).identify()), ERROR_KINDS.NOT_TANDOOR);
  const old = new FakeTandoor();
  old.failure = 'v1';
  assert.equal(await kindOf(client(old).identify()), ERROR_KINDS.NOT_TANDOOR);

  const answer =
    (status, body = '{}') =>
    async () => ({ status, headers: {}, body });
  assert.equal(
    await kindOf(client(undefined, { request: answer(301) }).mealTypes()),
    ERROR_KINDS.REDIRECT,
  );
  assert.equal(
    await kindOf(client(undefined, { request: answer(500) }).mealTypes()),
    ERROR_KINDS.HTTP,
  );
  assert.equal(
    await kindOf(client(undefined, { request: answer(401) }).mealTypes()),
    ERROR_KINDS.AUTH,
  );
  const tls = async () => {
    const error = new Error('self-signed certificate');
    error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT';
    throw error;
  };
  assert.equal(await kindOf(client(undefined, { request: tls }).mealTypes()), ERROR_KINDS.TLS);
});

test('the token goes in the Authorization header, never in the address', async () => {
  const seen = [];
  const request = async (url, options) => {
    seen.push({ url, authorization: options.headers.authorization });
    return { status: 200, headers: {}, body: '{"count":0,"next":null,"results":[]}' };
  };
  await client(undefined, { request }).mealTypes();
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);
  assert.ok(!seen[0].url.includes(TOKEN));
});
