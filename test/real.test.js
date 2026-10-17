// -----------------------------------------------------------------------------
// Optional: the integration against a REAL Tandoor, through the real HTTP
// transport and the SDK's fake Gladys. Skipped unless TANDOOR_URL and
// TANDOOR_TOKEN are set (the CI has no Tandoor):
//
//   TANDOOR_URL=http://127.0.0.1:8080 TANDOOR_TOKEN=tda_... npm run test:real
//
// Read only by default. TANDOOR_WRITE=1 also adds an item to the shopping
// list and checks it: use a test Tandoor (nothing is deleted, the item stays
// checked). TANDOOR_READ_ONLY_TOKEN, a token with the `read` scope only,
// checks the refusal of a write.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../src/app.js';
import { TRIGGER_KEYS, WIDGET_KEYS } from '../src/hub.js';

process.env.LOG_LEVEL ??= 'warn';

const { TANDOOR_URL, TANDOOR_TOKEN, TANDOOR_WRITE, TANDOOR_READ_ONLY_TOKEN } = process.env;
const skip = !TANDOOR_URL || !TANDOOR_TOKEN ? 'TANDOOR_URL and TANDOOR_TOKEN are not set' : false;

async function start(t, token = TANDOOR_TOKEN) {
  const gladys = createFakeGladys({
    config: { url: TANDOOR_URL, api_token: token, language: 'fr', allow_self_signed: true },
  });
  const app = registerHandlers(gladys, { timers: false });
  await gladys.connect();
  await app.ready;
  t.after(() => app.stop());
  return { gladys, fake: gladys.fake, hub: app.hub };
}

test(
  'a real Tandoor: connection, device, states, widgets, reading actions',
  { skip },
  async (t) => {
    const w = await start(t);
    assert.deepEqual(w.fake.connectionStatus, { connected: true }, JSON.stringify(w.hub.error));
    const [device] = w.fake.discoveredDevices;
    assert.ok(device, 'the space is proposed');
    await w.fake.deviceCreated(device);
    const texts = w.fake.states.filter((state) => typeof state.text === 'string');
    assert.equal(
      texts.length,
      w.hub.snapshot.mealTypes.length + 1,
      'one text per meal type, tomorrow',
    );
    assert.ok(texts.every((state) => state.text.length > 0));
    t.diagnostic(JSON.stringify(w.fake.states.map((s) => s.text ?? s.state)));
    for (const [key, settings] of [
      [WIDGET_KEYS.MEAL_PLAN, { period: 'today' }],
      [WIDGET_KEYS.MEAL_PLAN, { period: 'week' }],
      [WIDGET_KEYS.SHOPPING_LIST, {}],
    ]) {
      const ack = await w.fake.widgetGet(key, { settings, language: 'fr' });
      assert.equal(ack.success, true, ack.error);
      assert.deepEqual(validateWidgetContent(ack.data.content), []);
    }
    const meals = await w.fake.sceneAction('get_meals', { day: 'today' });
    assert.equal(meals.success, true, meals.error);
    t.diagnostic(JSON.stringify(meals.data.outputs));
    const list = await w.fake.sceneAction('get_shopping_list', {});
    assert.equal(list.success, true, list.error);
    t.diagnostic(JSON.stringify(list.data.outputs));
    const report = await w.fake.action('test_connection', {});
    assert.match(report.data.message.en, /^Connected to Tandoor/);
    t.diagnostic(report.data.message.en);
  },
);

test(
  'a real Tandoor: add (parsed amount and unit), not twice, check, trigger',
  { skip: skip || (TANDOOR_WRITE !== '1' && 'TANDOOR_WRITE is not 1') },
  async (t) => {
    const w = await start(t);
    const name = `Gladys test ${Date.now()}`;
    const added = await w.fake.sceneAction('add_shopping_item', { item: `2 kg ${name}` });
    assert.equal(added.data.outputs.added, true, added.error);
    t.diagnostic(JSON.stringify(added.data.outputs));
    const again = await w.fake.sceneAction('add_shopping_item', { item: name.toUpperCase() });
    assert.equal(again.data.outputs.added, false, 'not twice');
    const checked = await w.fake.sceneAction('check_shopping_item', { item: name });
    assert.equal(checked.data.outputs.checked, true, checked.error);
    assert.equal(
      w.fake.sceneEvents.filter((e) => e.key === TRIGGER_KEYS.SHOPPING_LIST_CHANGED).length,
      0,
      'the changes made from Gladys fire no trigger',
    );
    // Another user adds an item in Tandoor: the next reading fires the trigger.
    const other = `Other user ${Date.now()}`;
    const response = await fetch(`${TANDOOR_URL}/api/shopping-list-entry/`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TANDOOR_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ food: { name: other }, amount: 0 }),
    });
    assert.equal(response.status, 201);
    await w.hub.pollNow();
    const [event] = w.fake.sceneEvents.filter((e) => e.key === TRIGGER_KEYS.SHOPPING_LIST_CHANGED);
    assert.equal(event?.data.added, other);
    t.diagnostic(JSON.stringify(event.data));
  },
);

test(
  'a real Tandoor: a read-only token reads, and its writes are refused in words',
  { skip: skip || (!TANDOOR_READ_ONLY_TOKEN && 'TANDOOR_READ_ONLY_TOKEN is not set') },
  async (t) => {
    const w = await start(t, TANDOOR_READ_ONLY_TOKEN);
    assert.deepEqual(w.fake.connectionStatus, { connected: true });
    const added = await w.fake.sceneAction('add_shopping_item', { item: 'Gladys read-only' });
    assert.equal(added.success, false);
    assert.match(added.error, /portée « read write »/);
  },
);
