// -----------------------------------------------------------------------------
// One Gladys device per Tandoor space, proposed in the Discovery tab.
//
// Identity: the space id Tandoor gives (`space/current/`), never the address:
// changing the address of Tandoor (an IP for a name, HTTP for HTTPS) keeps
// the device, its history and its scenes.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - one text/text per meal type of the space ("Lunch", "Dinner"... as the
//     users named them in Tandoor): what is planned today for that meal,
//     "Nothing planned" when the slot is empty (Gladys ignores an empty text).
//     Its id is the Tandoor meal type id: renaming the type keeps it;
//   - the meals of tomorrow, in one text/text;
//   - the meals planned in the next seven days: counter-sensor/integer;
//   - the items still to buy, the whole shopping list: counter-sensor/integer;
//   - one counter-sensor/integer per Tandoor shopping list (Tandoor 2.x: a
//     supermarket, a market...): the items still to buy on it.
// A meal type or a list created in Tandoor adds a feature: Gladys then offers
// "Update" in the Discovery tab.
//
// Published with should_poll: false: the integration reads Tandoor on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { sortMealTypes } from './tandoor/model.js';

export const DEVICE_TYPE = 'space';
export const MODEL = 'Tandoor Recipes';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  TOMORROW: 'tomorrow_meals',
  WEEK: 'week_meals',
  TO_BUY: 'to_buy',
});

/** Feature key of today's meal of a meal type: `today_type_<Tandoor meal type id>`. */
export const mealTypeFeatureKey = (typeId) => `today_type_${String(typeId).toLowerCase()}`;

/** Feature key of the items to buy on a list: `list_<Tandoor list id>`. */
export const listFeatureKey = (listId) => `list_${String(listId).toLowerCase()}`;

// Meal types followed as features, at most (the first ones of the day).
export const MAX_MEAL_TYPE_FEATURES = 10;
// Shopping lists followed as features, at most.
export const MAX_LIST_FEATURES = 20;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.TOMORROW]: 'Meals tomorrow',
    [FEATURE_KEYS.WEEK]: 'Meals planned this week',
    [FEATURE_KEYS.TO_BUY]: 'Items to buy',
    type: '{type} today',
    list: 'To buy: {list}',
  },
  fr: {
    [FEATURE_KEYS.TOMORROW]: 'Repas de demain',
    [FEATURE_KEYS.WEEK]: 'Repas prévus cette semaine',
    [FEATURE_KEYS.TO_BUY]: 'Articles à acheter',
    type: "{type} aujourd'hui",
    list: 'À acheter : {list}',
  },
  de: {
    [FEATURE_KEYS.TOMORROW]: 'Mahlzeiten morgen',
    [FEATURE_KEYS.WEEK]: 'Geplante Mahlzeiten diese Woche',
    [FEATURE_KEYS.TO_BUY]: 'Einträge zu kaufen',
    type: '{type} heute',
    list: 'Zu kaufen: {list}',
  },
  es: {
    [FEATURE_KEYS.TOMORROW]: 'Comidas de mañana',
    [FEATURE_KEYS.WEEK]: 'Comidas previstas esta semana',
    [FEATURE_KEYS.TO_BUY]: 'Artículos por comprar',
    type: '{type} de hoy',
    list: 'Por comprar: {list}',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_ITEMS = 2000;
export const MAX_WEEK_MEALS = 1000;
// Gladys stores a text state whole: a day with five recipes in one slot stays
// readable, a longer one is cut.
export const MAX_TEXT_LENGTH = 250;
const MAX_NAME_LENGTH = 100;

// No version param: a Tandoor update would make Gladys offer "Update" on the
// device for nothing (the version is in "Test the connection").
export const PARAMS = Object.freeze({ SPACE: 'TANDOOR_SPACE' });

/** External ids of the device of a space and its features. */
export const spaceIds = (gladys, spaceId) =>
  gladys.externalIds(DEVICE_TYPE, String(spaceId).toLowerCase());

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The meal types that get a feature: the first ones of the day. */
export const followedTypes = (types) => sortMealTypes(types).slice(0, MAX_MEAL_TYPE_FEATURES);

/** The shopping lists that get a feature. */
export const followedLists = (lists) => lists.slice(0, MAX_LIST_FEATURES);

/**
 * The discovery payload of the space.
 * @param {object} gladys SDK client
 * @param {object} snapshot see src/hub.js: { spaceId, space, mealTypes, lists }
 * @param {string} language feature names language
 */
export function buildDevice(gladys, snapshot, language = 'fr') {
  const ids = spaceIds(gladys, snapshot.spaceId);
  const names = NAMES[language] ?? NAMES.en;
  const used = new Set();
  // Two types or lists with the same name: Gladys shows the features side by side.
  const unique = (base) => {
    let name = fit(base, MAX_NAME_LENGTH);
    for (let n = 2; used.has(name); n += 1) {
      name = fit(`${base} (${n})`, MAX_NAME_LENGTH);
    }
    used.add(name);
    return name;
  };
  const text = (key, name) => ({
    name: unique(name),
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    // NOT NULL in Gladys, even for a text: without them "Add" fails (422).
    min: 0,
    max: 0,
  });
  const counter = (key, name, max) => ({
    name: unique(name),
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max,
  });

  const features = [];
  for (const type of followedTypes(snapshot.mealTypes)) {
    features.push(
      text(mealTypeFeatureKey(type.id), names.type.replace('{type}', type.name || '?')),
    );
  }
  features.push(text(FEATURE_KEYS.TOMORROW, names[FEATURE_KEYS.TOMORROW]));
  features.push(counter(FEATURE_KEYS.WEEK, names[FEATURE_KEYS.WEEK], MAX_WEEK_MEALS));
  features.push(counter(FEATURE_KEYS.TO_BUY, names[FEATURE_KEYS.TO_BUY], MAX_ITEMS));
  for (const list of followedLists(snapshot.lists)) {
    features.push(
      counter(listFeatureKey(list.id), names.list.replace('{list}', list.name || '?'), MAX_ITEMS),
    );
  }

  const params = [];
  if (snapshot.space) {
    params.push({ name: PARAMS.SPACE, value: fit(snapshot.space, 255) });
  }
  return {
    name: 'Tandoor',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features,
  };
}

/**
 * The value of every feature (text features carry `text`, counters `state`).
 * @param {object} gladys SDK client
 * @param {object} snapshot see src/hub.js
 * @param {object} views { mealsOn(offset), summary(meals), weekCount(), itemsOn(listId) }
 * @param {string} nothing the text of an empty slot
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function featureStates(gladys, snapshot, views, nothing) {
  const ids = spaceIds(gladys, snapshot.spaceId);
  const states = [];
  const today = views.mealsOn(0);
  for (const type of followedTypes(snapshot.mealTypes)) {
    const titles = today.get(type.id)?.titles ?? [];
    states.push({
      device_feature_external_id: ids.feature(mealTypeFeatureKey(type.id)),
      text: titles.length > 0 ? fit(titles.join(' · '), MAX_TEXT_LENGTH) : nothing,
    });
  }
  states.push({
    device_feature_external_id: ids.feature(FEATURE_KEYS.TOMORROW),
    text: fit(views.summary(views.mealsOn(1)) || nothing, MAX_TEXT_LENGTH),
  });
  states.push({
    device_feature_external_id: ids.feature(FEATURE_KEYS.WEEK),
    state: views.weekCount(),
  });
  states.push({
    device_feature_external_id: ids.feature(FEATURE_KEYS.TO_BUY),
    state: views.itemsOn(null).length,
  });
  for (const list of followedLists(snapshot.lists)) {
    states.push({
      device_feature_external_id: ids.feature(listFeatureKey(list.id)),
      state: views.itemsOn(list.id).length,
    });
  }
  return states;
}
