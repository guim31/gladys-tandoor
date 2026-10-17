// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of Tandoor 2.6.15, and from a busier space (seven meal types, two
// with the same name, many shopping lists), in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-uptime-kuma.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, FakeTandoor, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** A busy space: more meal types and lists than the integration follows. */
function busyTandoor() {
  const tandoor = new FakeTandoor();
  const names = ['Breakfast', 'Brunch', 'Lunch', 'Snack', 'Dinner', 'Dinner', 'Late snack'];
  for (let i = 0; i < 12; i += 1) {
    tandoor.mealTypes.push({ id: 10 + i, name: names[i % names.length], order: i, time: null });
  }
  for (let i = 0; i < 25; i += 1) {
    tandoor.lists.push({ id: 10 + i, name: i % 5 === 0 ? 'Market' : `List ${i}`, color: null });
  }
  return tandoor;
}

async function discover(language, tandoor) {
  const w = await createWorld({ tandoor, config: { ...CONFIG, language } });
  await w.app.stop();
  return w.fake.discoveredDevices;
}

const scenarios = [
  { label: 'Tandoor 2.6.15, English names', language: 'en', tandoor: () => new FakeTandoor() },
  { label: 'Tandoor 2.6.15, French names', language: 'fr', tandoor: () => new FakeTandoor() },
  { label: 'busy space, German names', language: 'de', tandoor: busyTandoor },
  { label: 'busy space, Spanish names', language: 'es', tandoor: busyTandoor },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const devices = await discover(scenario.language, scenario.tandoor());
    assert.equal(devices.length, 1, 'one device per space');
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length >= 8, `${where}: ${device.features.length} features`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
