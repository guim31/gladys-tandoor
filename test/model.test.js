// -----------------------------------------------------------------------------
// The pure functions over the Tandoor answers: days and hours in a time zone,
// the meal plan by day and meal type, entries named and compared as people
// say them.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays,
  dateOf,
  dayKey,
  entryTitle,
  findList,
  groupMeals,
  hourOf,
  isToBuy,
  itemDetail,
  itemLabel,
  itemMatches,
  msUntilNextDay,
  normalizeName,
  onList,
  sortItems,
} from '../src/tandoor/model.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/tandoor/real/${name}.json`, import.meta.url)));
const types = fixture('meal-types').results;
const plans = fixture('meal-plans').results;
const entries = fixture('shopping-entries').results;

test('days and hours in the time zone of Gladys, across midnight and DST', () => {
  // 22:30 UTC on 17 October is already the 18th at 00:30 in Paris.
  const late = Date.UTC(2026, 9, 17, 22, 30);
  assert.equal(dayKey(late, 'Europe/Paris'), '2026-10-18');
  assert.equal(dayKey(late, 'UTC'), '2026-10-17');
  assert.equal(hourOf(late, 'Europe/Paris'), 0);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  // The night of 25 October 2026 lasts 25 hours in Paris.
  const evening = Date.UTC(2026, 9, 24, 22, 0); // 25 October, 00:00 CEST
  assert.equal(msUntilNextDay(evening, 'Europe/Paris'), 25 * 3600_000);
  assert.equal(msUntilNextDay(Date.UTC(2026, 9, 17, 21, 59, 30), 'Europe/Paris'), 60_000);
});

test('a meal plan entry: its title first (as Tandoor shows it), else its recipe', () => {
  assert.equal(dateOf('2026-10-17T19:30:00+02:00'), '2026-10-17');
  assert.equal(dateOf(null), null);
  const [lasagnes, restes] = plans;
  assert.equal(entryTitle(lasagnes), 'Lasagnes');
  assert.equal(entryTitle(restes), 'Restes');
  assert.equal(entryTitle({ title: ' Pizza  maison ', recipe: { name: 'Pizza' } }), 'Pizza maison');
  assert.equal(entryTitle({ title: '', recipe: null }), null);
});

test('the meal plan by day, in the order of the meal types; a long entry on each of its days', () => {
  const days = groupMeals(plans, types, '2026-10-17', '2026-10-23');
  assert.deepEqual([...days.keys()], ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
  const today = [...days.get('2026-10-17').values()];
  assert.deepEqual(
    today.map((meal) => [meal.type.name, meal.titles]),
    [
      ['Déjeuner', ['Lasagnes']],
      ['Dîner', ['Restes']],
    ],
  );
  // "Soupe à l'oignon" is planned from the 19th to the 20th.
  for (const day of ['2026-10-19', '2026-10-20']) {
    assert.deepEqual(
      [...days.get(day).values()].map((meal) => meal.titles),
      [['Soupe à l’oignon']],
    );
  }
  // Outside the window: nothing.
  assert.equal(groupMeals(plans, types, '2026-10-21', '2026-10-27').size, 0);
  // An entry begun before the window counts from its first day.
  assert.ok(groupMeals(plans, types, '2026-10-20', '2026-10-26').has('2026-10-20'));
});

test('names as people say them: case, accents, ligatures, plurals', () => {
  assert.equal(normalizeName(' Œufs  frais '), 'oeufs frais');
  const [, tomates, oeufs] = entries;
  assert.ok(itemMatches(tomates, 'tomate'));
  assert.ok(itemMatches(oeufs, 'OEUF'));
  assert.ok(!itemMatches(oeufs, ''));
  assert.ok(!itemMatches(tomates, 'tomates cerises'));
});

test('an entry in words: amount and unit in the language of the user', () => {
  const [lait, tomates, oeufs, laitBis] = entries;
  assert.equal(itemLabel(tomates, 'fr'), 'Tomates (1,5 kg)');
  assert.equal(itemLabel(tomates, 'en'), 'Tomates (1.5 kg)');
  assert.equal(itemLabel(oeufs, 'fr'), 'Œufs (×6)');
  assert.equal(itemLabel(lait, 'fr'), 'Lait', 'amount 0: the food alone');
  assert.equal(itemLabel(laitBis, 'fr'), 'Lait', 'one, without unit, is not worth saying');
  assert.equal(itemDetail({ amount: 0, unit: { name: 'pincée' } }, 'fr'), 'pincée');
});

test('what is still to buy: unchecked, and not postponed', () => {
  const now = Date.UTC(2026, 9, 17, 12);
  assert.deepEqual(
    entries.filter((entry) => isToBuy(entry, now)).map((entry) => entry.id),
    [2, 3, 5],
  );
  assert.ok(!isToBuy({ checked: false, delay_until: '2026-10-20T08:00:00+02:00' }, now));
  assert.ok(isToBuy({ checked: false, delay_until: '2026-10-10T08:00:00+02:00' }, now));
  assert.deepEqual(
    sortItems([
      { id: 2, order: 1 },
      { id: 1, order: 0, created_at: 'b' },
      { id: 3, order: 0, created_at: 'a' },
    ]).map((entry) => entry.id),
    [3, 1, 2],
  );
});

test('lists: an entry on several or none; a list named as people say it', () => {
  const [, tomates] = entries;
  assert.ok(onList(tomates, 2));
  assert.ok(!onList(tomates, 1));
  assert.ok(onList(tomates, null), 'null: the whole shopping list');
  const lists = fixture('shopping-lists').results;
  assert.equal(findList(lists, 'marche').name, 'Marché');
  assert.equal(findList(lists, 'super').name, 'Supermarché');
  assert.equal(findList(lists, 'arch'), null, 'two lists contain it');
  assert.equal(findList(lists, 'Biocoop'), null);
  assert.equal(findList(lists, ''), null);
});
