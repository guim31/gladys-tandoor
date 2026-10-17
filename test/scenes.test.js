// -----------------------------------------------------------------------------
// The scene actions, as a scene runs them (fields resolved by the core), on
// the in-memory Tandoor: what changes in Tandoor, what the outputs say, and
// the errors a scene log shows.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, listFeatureKey } from '../src/devices.js';
import {
  CONFIG,
  FakeTandoor,
  LIST_IDS,
  READ_ONLY_TOKEN,
  createClock,
  createDevice,
  createWorld,
  ids,
} from './helpers/world.js';

async function world(t, options = {}) {
  const result = await createWorld(options);
  t.after(() => result.app.stop());
  return result;
}

const run = (w, key, fields = {}) => w.fake.sceneAction(key, fields);
const lastState = (w, key) => w.fake.lastState(ids(w.gladys).feature(key));

test('"the milk is finished" twice adds one milk; a new item goes on the whole list', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor });
  await createDevice(w);

  const again = await run(w, 'add_shopping_item', { item: 'lait' });
  assert.deepEqual(again, {
    success: true,
    data: { outputs: { added: false, item: 'Lait', list: 'the shopping list', to_buy: 3 } },
  });
  assert.equal(tandoor.writes().length, 0, 'nothing written');

  const added = await run(w, 'add_shopping_item', { item: '  Moutarde  de Dijon ' });
  assert.deepEqual(added.data.outputs, {
    added: true,
    item: 'Moutarde de Dijon',
    list: 'the shopping list',
    to_buy: 4,
  });
  assert.deepEqual(tandoor.writes().at(-1).body.shopping_lists, []);
  // The counter of the device follows at once, without waiting for the timer.
  assert.equal(lastState(w, FEATURE_KEYS.TO_BUY), 4);
});

test('an amount and a unit are understood, and the food already listed is not added twice', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor });
  // The tomatoes are on the market list, not on the supermarket one.
  const added = await run(w, 'add_shopping_item', { item: '2 kg Tomates', list: 'super' });
  assert.deepEqual(added.data.outputs, {
    added: true,
    item: 'Tomates',
    list: 'Supermarché',
    to_buy: 2,
  });
  // On the whole list, the tomatoes already listed are the same food: not twice.
  const whole = await run(w, 'add_shopping_item', { item: '500 g tomate' });
  assert.equal(whole.data.outputs.added, false);
  const pommes = await run(w, 'add_shopping_item', { item: '2 kg pommes', list: 'Marché' });
  assert.equal(pommes.data.outputs.added, true);
  const entry = tandoor.entries.at(-1);
  assert.equal(entry.amount, 2);
  assert.equal(entry.unit.name, 'kg');
  assert.deepEqual(
    entry.shopping_lists.map((list) => list.id),
    [LIST_IDS.MARCHE],
  );
  assert.equal(pommes.data.outputs.to_buy, 2);
});

test('check: the item named, without case, accent or plural; unknown items are said', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor, config: { ...CONFIG, language: 'fr' } });
  await createDevice(w);
  const checked = await run(w, 'check_shopping_item', { item: 'oeuf' });
  assert.deepEqual(checked.data.outputs, {
    checked: true,
    item: 'Œufs',
    list: 'la liste de courses',
    to_buy: 2,
  });
  assert.equal(tandoor.entries.find((entry) => entry.id === 3).checked, true);
  assert.equal(lastState(w, listFeatureKey(LIST_IDS.SUPERMARCHE)), 0);

  const missing = await run(w, 'check_shopping_item', { item: 'Caviar', list: 'Marché' });
  assert.deepEqual(missing.data.outputs, {
    checked: false,
    item: 'Caviar',
    list: 'Marché',
    to_buy: 1,
  });
  // "tom" is the only item that contains it on the market list.
  const close = await run(w, 'check_shopping_item', { item: 'tom', list: 'Marché' });
  assert.equal(close.data.outputs.item, 'Tomates');
});

test('get_meals: the menu of a day, for a message', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  const today = await run(w, 'get_meals', { day: 'today' });
  assert.deepEqual(today.data.outputs, {
    summary: 'Déjeuner : Lasagnes · Dîner : Restes',
    recipes: 'Lasagnes, Restes',
    count: 2,
  });
  const after = await run(w, 'get_meals', { day: 'day_after_tomorrow' });
  assert.deepEqual(after.data.outputs, {
    summary: 'Déjeuner : Soupe à l’oignon',
    recipes: 'Soupe à l’oignon',
    count: 1,
  });
});

test('get_meals on a day with nothing planned says so', async (t) => {
  const w = await world(t, { clock: createClock(Date.UTC(2026, 9, 25, 8)) });
  const ack = await run(w, 'get_meals', { day: 'today' });
  assert.deepEqual(ack.data.outputs, {
    summary: 'Nothing planned',
    recipes: 'Nothing planned',
    count: 0,
  });
});

test('get_shopping_list: the items to buy, with their amounts', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  const whole = await run(w, 'get_shopping_list', {});
  assert.deepEqual(whole.data.outputs, {
    list: 'la liste de courses',
    to_buy: 3,
    items: 'Tomates (1,5 kg), Œufs (×6), Lait',
  });
  const market = await run(w, 'get_shopping_list', { list: 'marché' });
  assert.deepEqual(market.data.outputs, {
    list: 'Marché',
    to_buy: 1,
    items: 'Tomates (1,5 kg)',
  });
});

test('errors are said in the language of the configuration', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  const unknown = await run(w, 'get_shopping_list', { list: 'Biocoop' });
  assert.equal(unknown.success, false);
  assert.equal(
    unknown.error,
    'Aucune liste de courses « Biocoop » dans Tandoor (listes : Supermarché, Marché).',
  );
  const empty = await run(w, 'add_shopping_item', { item: '  ' });
  assert.equal(empty.error, "Saisissez l'article à ajouter.");
});

test('a read-only token: reading works, a write is refused in words', async (t) => {
  const w = await world(t, { config: { ...CONFIG, api_token: READ_ONLY_TOKEN } });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  const ack = await run(w, 'add_shopping_item', { item: 'Pain' });
  assert.equal(ack.success, false);
  assert.equal(
    ack.error,
    'Tandoor refused: the access token may only read: create one with the "read write" scope.',
  );
});

test('a Tandoor that does not answer, a Tandoor not configured', async (t) => {
  const tandoor = new FakeTandoor();
  const clock = createClock();
  const w = await world(t, { tandoor, clock });
  tandoor.failure = 'down';
  clock.advance(60_000);
  const down = await run(w, 'get_meals', { day: 'today' });
  assert.equal(down.error, 'Tandoor cannot be read: Tandoor does not answer.');
  const bare = await world(t, { config: { language: 'en' } });
  const none = await run(bare, 'get_shopping_list', {});
  assert.equal(none.error, 'Tandoor is not configured.');
});
