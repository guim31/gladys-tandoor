// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, an in-memory Tandoor, a manual
// clock in the time zone of Paris, with the integration wired on top through
// registerHandlers. No timer runs unless asked: the tests read Tandoor with
// `world.hub.pollNow()`.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { spaceIds } from '../../src/devices.js';
import {
  BASE_URL,
  FakeTandoor,
  LIST_IDS,
  MEAL_TYPE_IDS,
  READ_ONLY_TOKEN,
  SPACE_ID,
  TOKEN,
} from './fakeTandoor.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const TIME_ZONE = 'Europe/Paris';

/** A manual clock, shared by the hub and the tests: 17 October 2026, 10:00 in Paris. */
export function createClock(start = Date.UTC(2026, 9, 17, 8, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = { url: BASE_URL, api_token: TOKEN, language: 'en' };

/**
 * @param {object} [options]
 * @param {FakeTandoor} [options.tandoor]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] the hub's own reading timer (mock them first)
 */
export async function createWorld({
  clock = createClock(),
  tandoor = new FakeTandoor(),
  config = CONFIG,
  devices = [],
  connect = true,
  timings = {},
  timers = false,
  timeZone = TIME_ZONE,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    request: tandoor.request,
    timers,
    timings,
    now: clock.now,
    timeZone,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, tandoor, app, hub: app.hub, clock };
}

/** External ids of the space device and its features. */
export const ids = (gladys) => spaceIds(gladys, SPACE_ID);

/** Add the discovered device in Gladys, as the user would. */
export async function createDevice(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** The last text published on a feature. */
export function lastText(world, key) {
  const id = ids(world.gladys).feature(key);
  const states = world.fake.states.filter((state) => state.device_feature_external_id === id);
  return states.at(-1)?.text;
}

export { BASE_URL, FakeTandoor, LIST_IDS, MEAL_TYPE_IDS, READ_ONLY_TOKEN, SPACE_ID, TOKEN };
