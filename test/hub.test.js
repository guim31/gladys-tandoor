// -----------------------------------------------------------------------------
// The hub, end to end: the SDK's fake Gladys on one side, the in-memory
// Tandoor (real answers of Tandoor 2.6.15) on the other, a manual clock in
// Paris. The device, its states, the refresh by the integration's own timer,
// midnight, the heartbeat, the scene triggers, failures and reconfiguration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, listFeatureKey, mealTypeFeatureKey } from '../src/devices.js';
import { TRIGGER_KEYS, WIDGET_KEYS } from '../src/hub.js';
import {
  BASE_URL,
  CONFIG,
  FakeTandoor,
  LIST_IDS,
  MEAL_TYPE_IDS,
  TOKEN,
  createClock,
  createDevice,
  createWorld,
  ids,
  lastText,
} from './helpers/world.js';

async function world(t, options = {}) {
  const result = await createWorld(options);
  t.after(() => result.app.stop());
  return result;
}

const lastState = (w, key) => w.fake.lastState(ids(w.gladys).feature(key));
const typeKey = mealTypeFeatureKey;
const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

/** Let the readings started by a timer finish. */
async function settle(w) {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await w.hub.polling;
}

test('one device for the space, proposed in the Discovery tab, never polled by Gladys', async (t) => {
  const w = await world(t);
  const [device, ...others] = w.fake.discoveredDevices;
  assert.equal(others.length, 0);
  assert.equal(device.name, 'Tandoor');
  assert.equal(device.external_id, ids(w.gladys).device);
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
  assert.deepEqual(device.params, [{ name: 'TANDOOR_SPACE', value: 'Maison' }]);
  const feature = (key) => ids(w.gladys).feature(key);
  assert.deepEqual(
    device.features.map((f) => [f.name, f.external_id]),
    [
      ['Petit-déjeuner today', feature(typeKey(MEAL_TYPE_IDS.PETIT_DEJEUNER))],
      ['Déjeuner today', feature(typeKey(MEAL_TYPE_IDS.DEJEUNER))],
      ['Dîner today', feature(typeKey(MEAL_TYPE_IDS.DINER))],
      ['Meals tomorrow', feature(FEATURE_KEYS.TOMORROW)],
      ['Meals planned this week', feature(FEATURE_KEYS.WEEK)],
      ['Items to buy', feature(FEATURE_KEYS.TO_BUY)],
      ['To buy: Supermarché', feature(listFeatureKey(LIST_IDS.SUPERMARCHE))],
      ['To buy: Marché', feature(listFeatureKey(LIST_IDS.MARCHE))],
    ],
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.states.length, 0, 'nothing sent for a device not added');
});

test('once added, the meals and the items to buy are published', async (t) => {
  const w = await world(t);
  await createDevice(w);
  assert.equal(lastText(w, typeKey(MEAL_TYPE_IDS.PETIT_DEJEUNER)), 'Nothing planned');
  assert.equal(lastText(w, typeKey(MEAL_TYPE_IDS.DEJEUNER)), 'Lasagnes');
  assert.equal(lastText(w, typeKey(MEAL_TYPE_IDS.DINER)), 'Restes', 'a title alone is a meal');
  assert.equal(lastText(w, FEATURE_KEYS.TOMORROW), 'Dîner: Bœuf bourguignon');
  // Today 2, tomorrow 1, the soup planned on the 19th and the 20th.
  assert.equal(lastState(w, FEATURE_KEYS.WEEK), 5);
  assert.equal(lastState(w, FEATURE_KEYS.TO_BUY), 3, 'the checked milk does not count');
  assert.equal(lastState(w, listFeatureKey(LIST_IDS.SUPERMARCHE)), 1);
  assert.equal(lastState(w, listFeatureKey(LIST_IDS.MARCHE)), 1);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: ids(w.gladys).device,
    transport: 'local',
  });
  assert.ok(w.fake.widgetRefreshes.includes(WIDGET_KEYS.SHOPPING_LIST));
  assert.ok(w.fake.widgetRefreshes.includes(WIDGET_KEYS.MEAL_PLAN));
});

test('feature names and the empty slot follow the language of the configuration', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  await createDevice(w);
  const names = w.fake.discoveredDevices[0].features.map((feature) => feature.name);
  assert.equal(names[0], "Petit-déjeuner aujourd'hui");
  assert.equal(names.at(-1), 'À acheter : Marché');
  assert.equal(lastText(w, typeKey(MEAL_TYPE_IDS.PETIT_DEJEUNER)), 'Rien de prévu');
  assert.equal(lastText(w, FEATURE_KEYS.TOMORROW), 'Dîner : Bœuf bourguignon');
});

test('a postponed entry is not to buy until its date', async (t) => {
  const tandoor = new FakeTandoor();
  tandoor.addEntry('Champagne', { delay_until: '2026-12-31T08:00:00+01:00' });
  const w = await world(t, { tandoor });
  await createDevice(w);
  assert.equal(lastState(w, FEATURE_KEYS.TO_BUY), 3);
});

test('the integration refreshes itself on its own timer: no onPoll needed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tandoor = new FakeTandoor();
  const clock = createClock();
  const w = await world(t, { tandoor, clock, timers: true });
  await createDevice(w);
  // Gladys never calls onPoll here: replaced by a counter to prove it.
  const onPoll = t.mock.fn();
  w.gladys.onPoll(onPoll);

  tandoor.addEntry('Moutarde');
  const before = tandoor.requests.length;
  clock.advance(300_000);
  t.mock.timers.tick(300_000);
  await settle(w);
  assert.ok(tandoor.requests.length > before, 'Tandoor was read again');
  assert.equal(lastState(w, FEATURE_KEYS.TO_BUY), 4);
  assert.equal(onPoll.mock.callCount(), 0);

  tandoor.addEntry('Sel');
  clock.advance(300_000);
  t.mock.timers.tick(300_000);
  await settle(w);
  assert.equal(lastState(w, FEATURE_KEYS.TO_BUY), 5);
});

test('right after midnight, tomorrow becomes today without waiting for the interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock(Date.UTC(2026, 9, 17, 21, 58)); // 23:58 in Paris
  const w = await world(t, { clock, timers: true, config: { ...CONFIG, poll_interval: '900' } });
  await createDevice(w);
  assert.equal(lastText(w, typeKey(MEAL_TYPE_IDS.DINER)), 'Restes');
  // Midnight is 2 minutes away, the interval 15: the timer fires at midnight + 5 s.
  clock.advance(125_000);
  t.mock.timers.tick(125_000);
  await settle(w);
  assert.equal(lastText(w, typeKey(MEAL_TYPE_IDS.DINER)), 'Bœuf bourguignon');
  assert.equal(lastText(w, typeKey(MEAL_TYPE_IDS.DEJEUNER)), 'Nothing planned');
  assert.equal(lastText(w, FEATURE_KEYS.TOMORROW), 'Déjeuner: Soupe à l’oignon');
});

test('only the changes are published, and every value again after six hours', async (t) => {
  // The SDK dates what it published with Date.now(): its clock moves with ours.
  const clock = createClock();
  t.mock.timers.enable({ apis: ['Date'], now: clock.time });
  const advance = clock.advance.bind(clock);
  clock.advance = (ms) => {
    advance(ms);
    t.mock.timers.tick(ms);
  };
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor, clock });
  await createDevice(w);
  const count = w.fake.states.length;
  clock.advance(60_000);
  await w.hub.pollNow();
  assert.equal(w.fake.states.length, count, 'nothing changed, nothing sent');

  tandoor.addEntry('Vis', { shopping_lists: [tandoor.lists[1]] });
  clock.advance(60_000);
  await w.hub.pollNow();
  assert.deepEqual(w.fake.states.slice(count), [
    { device_feature_external_id: ids(w.gladys).feature(FEATURE_KEYS.TO_BUY), state: 4 },
    {
      device_feature_external_id: ids(w.gladys).feature(listFeatureKey(LIST_IDS.MARCHE)),
      state: 2,
    },
  ]);

  // The heartbeat: Gladys shows "no recent value" on a state older than 48 h.
  clock.advance(6 * 3600_000);
  const sent = w.fake.states.length;
  await w.hub.pollNow();
  assert.equal(w.fake.states.length - sent, 8, 'the eight features again');
});

test('the device added after the first reading gets its states at once', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0);
  await createDevice(w);
  assert.equal(w.fake.states.length, 8);
  // Created again (deleted then added back): everything again.
  await createDevice(w);
  assert.equal(w.fake.states.length, 16);
});

test('shopping_list_changed: what changed in Tandoor, never what Gladys did', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor, config: { ...CONFIG, language: 'fr' } });
  assert.equal(events(w, TRIGGER_KEYS.SHOPPING_LIST_CHANGED).length, 0, 'not at the first read');

  // Someone adds two items and checks the eggs in the Tandoor app.
  tandoor.addEntry('Beurre');
  tandoor.addEntry('Farine', { amount: 500, unit: { id: 9, name: 'g' } });
  tandoor.entries.find((entry) => entry.id === 3).checked = true;
  await w.hub.pollNow();
  assert.deepEqual(events(w, TRIGGER_KEYS.SHOPPING_LIST_CHANGED), [
    {
      key: TRIGGER_KEYS.SHOPPING_LIST_CHANGED,
      data: {
        added: 'Beurre, Farine (500 g)',
        removed: 'Œufs (×6)',
        added_count: 2,
        removed_count: 1,
        to_buy: 4,
      },
    },
  ]);

  // Nothing new: nothing fired.
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGER_KEYS.SHOPPING_LIST_CHANGED).length, 1);

  // Gladys' own add and check: no event (a scene bound to it would loop).
  await w.fake.sceneAction('add_shopping_item', { item: 'Moutarde' });
  await w.fake.sceneAction('check_shopping_item', { item: 'beurre' });
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGER_KEYS.SHOPPING_LIST_CHANGED).length, 1);
});

test('meal_time: at each new hour of a day with meals, with the hour and the menu', async (t) => {
  const clock = createClock(); // 10:00 in Paris
  const w = await world(t, { clock, config: { ...CONFIG, language: 'fr' } });
  await w.hub.tick();
  assert.equal(events(w, TRIGGER_KEYS.MEAL_TIME).length, 0, 'not the hour begun at start');

  clock.advance(3600_000);
  await w.hub.tick();
  await w.hub.tick(); // the same hour: once
  assert.deepEqual(events(w, TRIGGER_KEYS.MEAL_TIME), [
    {
      key: TRIGGER_KEYS.MEAL_TIME,
      data: {
        hour: 11,
        meals: 'Déjeuner : Lasagnes · Dîner : Restes',
        recipes: 'Lasagnes, Restes',
        count: 2,
      },
    },
  ]);

  // The 21st has nothing planned: no event that day.
  clock.advance(4 * 24 * 3600_000);
  await w.hub.tick();
  assert.equal(events(w, TRIGGER_KEYS.MEAL_TIME).length, 1);
});

test('meal_time at midnight reads the new day before firing', async (t) => {
  const clock = createClock(Date.UTC(2026, 9, 17, 21, 30)); // 23:30 in Paris
  const w = await world(t, { clock });
  clock.advance(31 * 60_000); // 00:01, before any midnight reading
  await w.hub.tick();
  const [event] = events(w, TRIGGER_KEYS.MEAL_TIME);
  assert.equal(event.data.hour, 0);
  assert.equal(event.data.recipes, 'Bœuf bourguignon', 'the meals of the 18th');
});

test('the clock fires meal_time on its own timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock(Date.UTC(2026, 9, 17, 8, 59, 30)); // 10:59:30 in Paris
  const w = await world(t, { clock, timers: true });
  clock.advance(31_000);
  t.mock.timers.tick(31_000);
  await settle(w);
  assert.equal(events(w, TRIGGER_KEYS.MEAL_TIME).at(-1)?.data.hour, 11);
});

test('a Tandoor that stops answering: the badge and the status say it, the values stay', async (t) => {
  const tandoor = new FakeTandoor();
  const clock = createClock();
  const w = await world(t, { tandoor, clock });
  await createDevice(w);
  const count = w.fake.states.length;
  tandoor.failure = 'down';
  clock.advance(60_000);
  await w.hub.pollNow();
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.en, 'Tandoor does not answer');
  assert.equal(w.fake.states.length, count, 'the last values stay');
  clock.advance(3600_000);
  await w.hub.tick();
  assert.equal(events(w, TRIGGER_KEYS.MEAL_TIME).length, 0, 'no menu from a failing Tandoor');

  tandoor.failure = null;
  clock.advance(60_000);
  await w.hub.pollNow();
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a refused token is a configuration problem, said under the integration name', async (t) => {
  const w = await world(t, { tandoor: new FakeTandoor({ token: 'another' }) });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /jeton d'accès refusé/);
  assert.deepEqual(w.fake.discoveredDevices, [], 'nothing to propose before a first reading');
});

test('Tandoor 1.x (or another service) is refused with an explanation', async (t) => {
  const tandoor = Object.assign(new FakeTandoor(), { failure: 'v1' });
  const w = await world(t, { tandoor });
  assert.match(w.fake.connectionStatus.message.en, /no Tandoor Recipes 2 at this address/);
});

test('a new list or meal type in Tandoor adds its feature to the proposed device', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor });
  await createDevice(w);
  tandoor.lists.push({ id: 7, name: 'Pharmacie', description: '', color: null });
  tandoor.mealTypes.push({ id: 8, name: 'Goûter', order: 3, time: '16:30:00', color: null });
  await w.hub.pollNow();
  const names = w.fake.discoveredDevices[0].features.map((feature) => feature.name);
  assert.ok(names.includes('To buy: Pharmacie'));
  assert.ok(names.includes('Goûter today'));
  assert.equal(lastState(w, listFeatureKey(7)), 0);
});

test('two lists with the same name get two distinct feature names', async (t) => {
  const tandoor = new FakeTandoor();
  tandoor.lists.push({ ...tandoor.lists[1], id: 9 });
  const w = await world(t, { tandoor });
  const names = w.fake.discoveredDevices[0].features.map((feature) => feature.name);
  assert.ok(names.includes('To buy: Marché'));
  assert.ok(names.includes('To buy: Marché (2)'));
});

test('without an address, the status asks for one; a wrong one is named', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Enter the address of your Tandoor/);
  assert.deepEqual(w.fake.discoveredDevices, []);
  await w.fake.configUpdated({ url: 'ftp://192.0.2.10', api_token: TOKEN });
  assert.match(w.fake.connectionStatus.message.en, /Address not understood/);
});

test('a new address for the same Tandoor keeps the device', async (t) => {
  const w = await world(t);
  await createDevice(w);
  const id = w.fake.discoveredDevices[0].external_id;
  // Same server: the fake answers only BASE_URL, the address adds what the browser shows.
  await w.fake.configUpdated({ ...CONFIG, url: `${BASE_URL}/mealplan` });
  assert.equal(w.fake.discoveredDevices[0].external_id, id);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('onPoll, should Gladys poll anyway, reads Tandoor at once', async (t) => {
  const tandoor = new FakeTandoor();
  const w = await world(t, { tandoor });
  await createDevice(w);
  tandoor.addEntry('Riz');
  const ack = await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.equal(ack.success, true);
  assert.equal(lastState(w, FEATURE_KEYS.TO_BUY), 4);
});

test('Gladys restarted: the device, the states and the status are sent again', async (t) => {
  const w = await world(t);
  await createDevice(w);
  const states = w.fake.states.length;
  const statuses = w.fake.connectionStatuses.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(w.fake.states.length - states, 8);
  assert.equal(w.fake.connectionStatuses.length - statuses, 1);
});

test('the reading is light: four requests per cycle, "who am I" once an hour', async (t) => {
  const tandoor = new FakeTandoor();
  const clock = createClock();
  const w = await world(t, { tandoor, clock });
  const before = tandoor.requests.length;
  clock.advance(300_000);
  await w.hub.pollNow();
  assert.deepEqual(
    tandoor.requests
      .slice(before)
      .map((request) => request.path)
      .sort(),
    ['meal-plan/', 'meal-type/', 'shopping-list-entry/', 'shopping-list/'],
  );
  clock.advance(3600_000);
  const again = tandoor.requests.length;
  await w.hub.pollNow();
  assert.ok(tandoor.requests.slice(again).some((request) => request.path === 'space/current/'));
});
