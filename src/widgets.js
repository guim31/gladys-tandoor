// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+, forms behind buttons
// 5.2+): `meal_plan` and `shopping_list`.
//
// meal_plan — "what do we eat?" at a glance on the kitchen tablet: today's
// meals as rows, one per meal type (period "today"), or the seven days to
// come, one row per day (period "week"), tapping a day opens its detail.
//
// shopping_list — the items still to buy (the whole shopping list, or one
// Tandoor list), with "Add" (a form with one text field, read by the
// ingredient parser of Tandoor: "2 kg tomatoes") and "Check" (a form listing
// the items) so the list is kept from the wall, not only from the phone.
//
// Budget (8 components, 2 texts, 1 focal, 1 status, 4 buttons): a caption, a
// body only for a problem, the rows (status or card-list), three buttons at
// most plus "Open Tandoor" when Tandoor has an https address (the only links
// the core accepts).
//
// Texts are pre-localized with the `language` of the request: the core caches
// a content per (settings, language, units).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ActionError, WIDGET_KEYS, WEEK_DAYS, listLabel } from './hub.js';
import { addDays, itemDetail, itemLabel, itemName } from './tandoor/model.js';
import { DAY_TEXT, pick, say } from './texts.js';

// Action keys of the buttons: permanent once published.
export const ACTIONS = Object.freeze({
  ADD: 'add_item',
  CHECK: 'check_item',
  REFRESH: 'refresh',
});

// Rows of a card-list in "list" display, at most.
export const MAX_ROWS = 8;
// Items offered in the "Check" form, at most.
export const MAX_CHECK_OPTIONS = 50;

export const TEXT = {
  notConfigured: {
    en: 'Enter the address of your Tandoor and an API token in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Tandoor et un jeton d'API dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Tandoor und ein API-Token in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Tandoor y un token de API en la configuración de la integración.',
  },
  nothingToday: {
    en: 'Nothing planned today in Tandoor.',
    fr: "Rien de prévu aujourd'hui dans Tandoor.",
    de: 'Heute ist in Tandoor nichts geplant.',
    es: 'No hay nada previsto hoy en Tandoor.',
  },
  nothingToBuy: {
    en: 'Nothing to buy on {list}.',
    fr: 'Rien à acheter sur {list}.',
    de: 'Auf {list} steht nichts zum Kaufen.',
    es: 'No hay nada que comprar en {list}.',
  },
  stale: {
    en: '{error}: last data read at {time}.',
    fr: '{error} : dernières données lues à {time}.',
    de: '{error}: letzte Daten von {time}.',
    es: '{error}: últimos datos leídos a las {time}.',
  },
  needsForm: {
    en: 'This button needs Gladys 5.2 or later.',
    fr: 'Ce bouton demande Gladys 5.2 ou plus récent.',
    de: 'Diese Schaltfläche braucht Gladys 5.2 oder neuer.',
    es: 'Este botón necesita Gladys 5.2 o posterior.',
  },
  refreshed: {
    en: 'Tandoor read again.',
    fr: 'Tandoor relu.',
    de: 'Tandoor neu gelesen.',
    es: 'Tandoor leído de nuevo.',
  },
  week: { en: 'Next 7 days', fr: '7 prochains jours', de: 'Nächste 7 Tage', es: 'Próximos 7 días' },
  toBuy: {
    en: '{list} · {count} to buy',
    fr: '{list} · {count} à acheter',
    de: '{list} · {count} zu kaufen',
    es: '{list} · {count} por comprar',
  },
  others: {
    en: '+{count} more',
    fr: '+{count} autres',
    de: '+{count} weitere',
    es: '+{count} más',
  },
  nothing: {
    en: 'Nothing planned',
    fr: 'Rien de prévu',
    de: 'Nichts geplant',
    es: 'Nada previsto',
  },
  add: { en: 'Add', fr: 'Ajouter', de: 'Hinzufügen', es: 'Añadir' },
  check: { en: 'Check', fr: 'Cocher', de: 'Abhaken', es: 'Marcar' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  open: { en: 'Open Tandoor', fr: 'Ouvrir Tandoor', de: 'Tandoor öffnen', es: 'Abrir Tandoor' },
  // Form fields.
  item: { en: 'Item', fr: 'Article', de: 'Eintrag', es: 'Artículo' },
  itemHint: { en: 'e.g. Milk', fr: 'ex. Lait', de: 'z. B. Milch', es: 'p. ej. Leche' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The date of a day in the user's language: "Wednesday 14 October". */
function longDate(day, language) {
  const text = new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Wed 14 Oct". */
function shortDate(day, language) {
  const text = new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The hour of the last good reading, in the time zone of Gladys. */
function readTime(hub, language) {
  return new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: hub.timeZone,
  }).format(new Date(hub.snapshotAt ?? hub.readAt));
}

/** A body text when the last reading failed but older data is shown. */
function staleNotice(hub, language) {
  return {
    type: 'text',
    variant: 'body',
    text: say(TEXT.stale, language, {
      error: capitalize(hub.errorText(language)),
      time: readTime(hub, language),
    }),
  };
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Open Tandoor": a link, only for an https address (the core drops the others). */
function openButton(hub, language, path = '') {
  if (!/^https:\/\//i.test(hub.config?.url ?? '')) {
    return [];
  }
  return [
    {
      type: 'button',
      label: t(TEXT.open, language),
      icon: 'external-link',
      link: { url: `${hub.config.url}${path}`, label: t(TEXT.open, language) },
    },
  ];
}

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  action: { key: ACTIONS.REFRESH },
});

/** Read Tandoor if needed; the content to show instead of the widget, if any. */
async function prepare(hub, language) {
  if (!hub.client) {
    return message(TEXT.notConfigured, language);
  }
  await hub.refreshIfStale();
  if (!hub.snapshot) {
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: 'body', text: capitalize(hub.errorText(language)) },
        refreshButton(language),
      ],
    };
  }
  return null;
}

// --- Meal plan ---------------------------------------------------------------------

// Feather icons of the meal rows, by position in the day.
const MEAL_ICONS = ['coffee', 'sun', 'moon'];

function mealRows(meals) {
  return [...meals.values()].map(({ type, titles }, index) => ({
    label: fit(type.name || '?', 40),
    value: fit(titles.join(', '), 40),
    icon: MEAL_ICONS[index] ?? 'plus-circle',
    color: WIDGET_COLORS.PRIMARY,
  }));
}

function dayLines(meals, language) {
  const separator = language === 'fr' ? ' : ' : ': ';
  return [...meals.values()].map(({ type, titles }) =>
    type.name ? `${type.name}${separator}${titles.join(', ')}` : titles.join(', '),
  );
}

async function getMealPlan(hub, { settings = {}, language = 'en' }) {
  const early = await prepare(hub, language);
  if (early) {
    return early;
  }
  const { snapshot } = hub;
  const components = [];
  const today = snapshot.day;

  if (settings.period === 'week') {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.week, language) });
    if (hub.error) {
      components.push(staleNotice(hub, language));
    }
    const items = [];
    for (let offset = 0; offset < WEEK_DAYS; offset += 1) {
      const meals = hub.mealsOn(offset);
      const lines = dayLines(meals, language);
      const titles = [...meals.values()].flatMap((meal) => meal.titles);
      const item = {
        title: shortDate(addDays(today, offset), language),
        subtitle: fit(titles.join(' · ') || t(TEXT.nothing, language), 60),
      };
      if (lines.length > 0) {
        item.description = lines.join('\n');
      }
      if (offset <= 1) {
        item.badge = {
          text: t(offset === 0 ? DAY_TEXT.today : DAY_TEXT.tomorrow, language),
          color: offset === 0 ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
        };
      }
      items.push(item);
    }
    components.push({ type: 'card-list', display: 'list', items });
  } else {
    components.push({ type: 'text', variant: 'caption', text: longDate(today, language) });
    const rows = mealRows(hub.mealsOn(0));
    if (hub.error) {
      components.push(staleNotice(hub, language));
    } else if (rows.length === 0) {
      components.push({ type: 'text', variant: 'body', text: t(TEXT.nothingToday, language) });
    }
    if (rows.length > 0) {
      components.push({ type: 'status', items: rows.slice(0, 10) });
    }
  }

  components.push(refreshButton(language));
  components.push(...openButton(hub, language, '/mealplan'));
  return { ttl_seconds: hub.error ? 60 : 300, components };
}

async function mealPlanAction(hub, { actionKey }) {
  if (actionKey === ACTIONS.REFRESH) {
    await hub.pollNow();
    return TEXT.refreshed;
  }
  throw new Error(`Unknown action ${actionKey}`);
}

// --- Shopping list -----------------------------------------------------------------

function addButton(language) {
  return {
    type: 'button',
    label: t(TEXT.add, language),
    icon: 'plus',
    style: 'primary',
    action: {
      key: ACTIONS.ADD,
      fields: [
        {
          key: 'item',
          type: 'string',
          label: TEXT.item,
          placeholder: TEXT.itemHint,
          required: true,
        },
      ],
    },
  };
}

function checkButton(items, language) {
  return {
    type: 'button',
    label: t(TEXT.check, language),
    icon: 'check-square',
    action: {
      key: ACTIONS.CHECK,
      fields: [
        {
          key: 'item',
          type: 'select',
          label: TEXT.item,
          required: true,
          options: items.slice(0, MAX_CHECK_OPTIONS).map((item) => ({
            value: String(item.id),
            label: { en: fit(itemLabel(item, language), 40) },
          })),
        },
      ],
    },
  };
}

async function getShoppingList(hub, { settings = {}, language = 'en' }) {
  const early = await prepare(hub, language);
  if (early) {
    return early;
  }
  let list;
  try {
    list = hub.resolveList(settings.list);
  } catch (err) {
    if (err instanceof ActionError) {
      return {
        ttl_seconds: 300,
        components: [
          { type: 'text', variant: 'body', text: err.text(language) },
          refreshButton(language),
        ],
      };
    }
    throw err;
  }
  const items = hub.itemsOn(list.id);
  const name = capitalize(listLabel(list, language));
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: say(TEXT.toBuy, language, { list: name, count: items.length }),
    },
  ];
  if (hub.error) {
    components.push(staleNotice(hub, language));
  }
  if (items.length === 0) {
    if (!hub.error) {
      components.push({
        type: 'text',
        variant: 'body',
        text: say(TEXT.nothingToBuy, language, { list: listLabel(list, language) }),
      });
    }
  } else {
    const shown = items.length > MAX_ROWS ? items.slice(0, MAX_ROWS - 1) : items;
    const rows = shown.map((item) => {
      const row = { title: fit(itemName(item), 60) };
      const detail = itemDetail(item, language);
      if (detail) {
        row.subtitle = fit(detail, 60);
      }
      return row;
    });
    if (items.length > shown.length) {
      const rest = items.slice(shown.length);
      rows.push({
        title: say(TEXT.others, language, { count: rest.length }),
        description: rest.map((item) => itemLabel(item, language)).join('\n'),
      });
    }
    components.push({ type: 'card-list', display: 'list', items: rows });
  }
  components.push(addButton(language));
  if (items.length > 0) {
    components.push(checkButton(items, language));
  }
  components.push(refreshButton(language));
  components.push(...openButton(hub, language, '/shopping'));
  return { ttl_seconds: hub.error ? 60 : 300, components };
}

async function shoppingListAction(hub, { actionKey, values, settings = {} }) {
  if (actionKey === ACTIONS.REFRESH) {
    await hub.pollNow();
    return TEXT.refreshed;
  }
  if (actionKey !== ACTIONS.ADD && actionKey !== ACTIONS.CHECK) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  if (!values) {
    return TEXT.needsForm;
  }
  if (actionKey === ACTIONS.ADD) {
    return toast(() => hub.addItem(values.item, settings.list));
  }
  // The name, for the message when the item was checked meanwhile elsewhere.
  const known = (hub.snapshot?.items ?? []).find((i) => String(i.id) === String(values.item));
  return toast(() =>
    hub.checkItem({ id: values.item, name: known ? itemName(known) : undefined }, settings.list),
  );
}

/** Run an operation; its outcome, or its refusal, as a toast in every language. */
async function toast(operation) {
  try {
    return (await operation()).message.all();
  } catch (err) {
    if (err instanceof ActionError) {
      return err.all();
    }
    throw err;
  }
}

export const WIDGETS = {
  [WIDGET_KEYS.MEAL_PLAN]: { get: getMealPlan, action: mealPlanAction },
  [WIDGET_KEYS.SHOPPING_LIST]: { get: getShoppingList, action: shoppingListAction },
};
