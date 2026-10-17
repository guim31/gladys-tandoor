// -----------------------------------------------------------------------------
// The two dashboard widgets: every content they can produce passes the
// validator of the SDK (vocabulary, budget, form fields) untouched, in the
// four languages; the buttons and their forms act on Tandoor.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEYS } from '../src/hub.js';
import { ACTIONS, MAX_ROWS } from '../src/widgets.js';
import { CONFIG, FakeTandoor, createClock, createWorld } from './helpers/world.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];

async function world(t, options = {}) {
  const result = await createWorld(options);
  t.after(() => result.app.stop());
  return result;
}

async function content(w, key, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(key, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const { content: body } = ack.data;
  assert.deepEqual(validateWidgetContent(body), [], JSON.stringify(body, null, 1));
  return body;
}

async function act(w, key, actionKey, { settings = {}, values } = {}) {
  const ack = await w.fake.widgetAction(key, actionKey, {}, { settings, values, language: 'en' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.message ?? ack.data;
}

const ofType = (body, type) => body.components.filter((c) => c.type === type);
const button = (body, key) => ofType(body, 'button').find((b) => b.action?.key === key);

test('today: the date, one row per meal type planned, Refresh', async (t) => {
  const w = await world(t);
  const body = await content(w, WIDGET_KEYS.MEAL_PLAN, { period: 'today' }, 'fr');
  assert.deepEqual(ofType(body, 'text'), [
    { type: 'text', variant: 'caption', text: 'Samedi 17 octobre' },
  ]);
  assert.deepEqual(
    ofType(body, 'status')[0].items.map((row) => [row.label, row.value]),
    [
      ['Déjeuner', 'Lasagnes'],
      ['Dîner', 'Restes'],
    ],
  );
  assert.deepEqual(
    ofType(body, 'button').map((b) => b.label),
    ['Actualiser'],
  );
});

test('today with nothing planned says so', async (t) => {
  const w = await world(t, { clock: createClock(Date.UTC(2026, 9, 22, 8)) });
  const body = await content(w, WIDGET_KEYS.MEAL_PLAN, { period: 'today' });
  assert.equal(ofType(body, 'text')[1].text, 'Nothing planned today in Tandoor.');
  assert.equal(ofType(body, 'status').length, 0);
});

test('week: seven days, the meals of each in its detail, today and tomorrow marked', async (t) => {
  const w = await world(t);
  const body = await content(w, WIDGET_KEYS.MEAL_PLAN, { period: 'week' });
  const [list] = ofType(body, 'card-list');
  assert.equal(list.items.length, 7);
  assert.deepEqual(list.items[0], {
    title: 'Sat, Oct 17',
    subtitle: 'Lasagnes · Restes',
    description: 'Déjeuner: Lasagnes\nDîner: Restes',
    badge: { text: 'Today', color: 'primary' },
  });
  assert.equal(list.items[1].badge.text, 'Tomorrow');
  assert.equal(list.items[2].subtitle, 'Soupe à l’oignon');
  assert.equal(list.items[4].subtitle, 'Nothing planned');
  assert.equal(list.items[4].description, undefined);
});

test('shopping list: the whole list by default, its items, Add, Check and Refresh', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  const body = await content(w, WIDGET_KEYS.SHOPPING_LIST, {}, 'fr');
  assert.equal(ofType(body, 'text')[0].text, 'La liste de courses · 3 à acheter');
  assert.deepEqual(ofType(body, 'card-list')[0].items, [
    { title: 'Tomates', subtitle: '1,5 kg' },
    { title: 'Œufs', subtitle: '×6' },
    { title: 'Lait' },
  ]);
  assert.deepEqual(
    ofType(body, 'button').map((b) => b.label),
    ['Ajouter', 'Cocher', 'Actualiser'],
  );
  const options = button(body, ACTIONS.CHECK).action.fields[0].options;
  assert.deepEqual(
    options.map((option) => option.label.en),
    ['Tomates (1,5 kg)', 'Œufs (×6)', 'Lait'],
  );
});

test('shopping list: one Tandoor list, named in the settings', async (t) => {
  const w = await world(t);
  const body = await content(w, WIDGET_KEYS.SHOPPING_LIST, { list: 'marche' });
  assert.equal(ofType(body, 'text')[0].text, 'Marché · 1 to buy');
  assert.deepEqual(ofType(body, 'card-list')[0].items, [{ title: 'Tomates', subtitle: '1.5 kg' }]);
});

test('shopping list: an unknown list, an empty list', async (t) => {
  const w = await world(t);
  const unknown = await content(w, WIDGET_KEYS.SHOPPING_LIST, { list: 'Biocoop' });
  assert.match(ofType(unknown, 'text')[0].text, /No shopping list "Biocoop" in Tandoor/);
  const tandoor = new FakeTandoor();
  tandoor.entries = [];
  const empty = await content(
    await world(t, { tandoor }),
    WIDGET_KEYS.SHOPPING_LIST,
    { list: 'Supermarché' },
    'de',
  );
  assert.equal(ofType(empty, 'text')[1].text, 'Auf Supermarché steht nichts zum Kaufen.');
  assert.equal(button(empty, ACTIONS.CHECK), undefined, 'nothing to check');
});

test('a long list keeps the budget: the rest in one row', async (t) => {
  const tandoor = new FakeTandoor();
  for (let i = 0; i < 20; i += 1) {
    tandoor.addEntry(`Article ${i}`);
  }
  const w = await world(t, { tandoor });
  const body = await content(w, WIDGET_KEYS.SHOPPING_LIST);
  const rows = ofType(body, 'card-list')[0].items;
  assert.equal(rows.length, MAX_ROWS);
  assert.equal(rows.at(-1).title, '+16 more');
});

test('Add, from the form: parsed by Tandoor, then the widget shows it', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor });
  const message = await act(w, WIDGET_KEYS.SHOPPING_LIST, ACTIONS.ADD, {
    settings: { list: 'Supermarché' },
    values: { item: '2 kg pommes' },
  });
  assert.equal(message.fr, '« pommes » ajouté à Supermarché.');
  assert.deepEqual(tandoor.writes().at(-1).body.shopping_lists, [{ id: 1, name: 'Supermarché' }]);
  const again = await act(w, WIDGET_KEYS.SHOPPING_LIST, ACTIONS.ADD, {
    values: { item: 'Lait' },
  });
  assert.equal(again.en, '"Lait" is already on the shopping list.');
});

test('Check, from the form: the item picked is checked in Tandoor', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor });
  const message = await act(w, WIDGET_KEYS.SHOPPING_LIST, ACTIONS.CHECK, {
    values: { item: '3' },
  });
  assert.equal(message.en, '"Œufs" checked on the shopping list.');
  assert.equal(tandoor.entries.find((entry) => entry.id === 3).checked, true);
  // Checked meanwhile elsewhere: said, not failed.
  const gone = await act(w, WIDGET_KEYS.SHOPPING_LIST, ACTIONS.CHECK, { values: { item: '3' } });
  assert.equal(gone.en, 'This item is no longer to buy on the shopping list.');
});

test('a button from an older core without its form says Gladys 5.2 is needed', async (t) => {
  const w = await world(t);
  const message = await act(w, WIDGET_KEYS.SHOPPING_LIST, ACTIONS.ADD, {});
  assert.equal(message.en, 'This button needs Gladys 5.2 or later.');
});

test('Refresh reads Tandoor again', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor });
  const before = tandoor.requests.length;
  const message = await act(w, WIDGET_KEYS.MEAL_PLAN, ACTIONS.REFRESH);
  assert.equal(message.en, 'Tandoor read again.');
  assert.ok(tandoor.requests.length > before);
});

test('an https Tandoor gets an "Open Tandoor" link; an http one does not', async (t) => {
  const w = await world(t);
  const body = await content(w, WIDGET_KEYS.MEAL_PLAN);
  assert.equal(ofType(body, 'button').filter((b) => b.link).length, 0);
  w.hub.config = { ...w.hub.config, url: 'https://recipes.example.com' };
  const linked = await content(w, WIDGET_KEYS.SHOPPING_LIST);
  assert.deepEqual(ofType(linked, 'button').find((b) => b.link).link, {
    url: 'https://recipes.example.com/shopping',
    label: 'Open Tandoor',
  });
});

test('a failing Tandoor: the last data with a notice, or the error alone', async (t) => {
  const tandoor = new FakeTandoor();
  const clock = createClock();
  const w = await world(t, { tandoor, clock });
  tandoor.failure = 'down';
  clock.advance(60_000);
  const body = await content(w, WIDGET_KEYS.SHOPPING_LIST);
  assert.match(ofType(body, 'text')[1].text, /^Tandoor does not answer: last data read at/);
  assert.equal(ofType(body, 'card-list')[0].items.length, 3);

  const never = new FakeTandoor();
  never.failure = 'down';
  const fresh = await content(await world(t, { tandoor: never }), WIDGET_KEYS.MEAL_PLAN);
  assert.equal(ofType(fresh, 'text')[0].text, 'Tandoor does not answer');
});

test('not configured: one sentence', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  const body = await content(w, WIDGET_KEYS.MEAL_PLAN);
  assert.match(body.components[0].text, /Enter the address of your Tandoor/);
});

test('every content is valid in the four languages', async (t) => {
  const w = await world(t);
  for (const language of LANGUAGES) {
    await content(w, WIDGET_KEYS.MEAL_PLAN, { period: 'today' }, language);
    await content(w, WIDGET_KEYS.MEAL_PLAN, { period: 'week' }, language);
    await content(w, WIDGET_KEYS.SHOPPING_LIST, {}, language);
    await content(w, WIDGET_KEYS.SHOPPING_LIST, { list: 'Marché' }, language);
  }
});
