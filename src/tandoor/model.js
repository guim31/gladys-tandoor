// -----------------------------------------------------------------------------
// Pure functions over the Tandoor answers: days in the time zone of Gladys,
// meal plan entries grouped by day and meal type, shopping list entries named
// and compared the way a person says them ("lait" finds "Lait", "oeufs" finds
// "Œufs").
// -----------------------------------------------------------------------------

const formatters = new Map();

/** Today in a time zone, as `YYYY-MM-DD`. */
export function dayKey(timestamp, timeZone) {
  if (!formatters.has(timeZone)) {
    // en-CA formats a date as YYYY-MM-DD.
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone).format(new Date(timestamp));
}

const hourFormatters = new Map();

/** The hour (0 to 23) of an instant in a time zone. */
export function hourOf(timestamp, timeZone) {
  if (!hourFormatters.has(timeZone)) {
    hourFormatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }),
    );
  }
  return Number(hourFormatters.get(timeZone).format(new Date(timestamp))) % 24;
}

/** `YYYY-MM-DD` plus a number of days (calendar arithmetic, no time zone involved). */
export function addDays(day, count) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

/** Milliseconds until the next midnight of a time zone (at least one minute). */
export function msUntilNextDay(timestamp, timeZone) {
  // Search the instant the day changes: exact across daylight saving changes.
  const today = dayKey(timestamp, timeZone);
  let low = timestamp;
  let high = timestamp + 26 * 3600_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dayKey(middle, timeZone) === today) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return Math.max(60_000, high - timestamp);
}

const clean = (text) => (typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '');

/**
 * The date of a Tandoor date-time, as Tandoor shows it: `2026-10-17T19:30:00+02:00`
 * is the 17th, in the time zone of the Tandoor server (the one its interface uses).
 */
export const dateOf = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

/** The text of a meal plan entry: its title when it has one (as Tandoor shows it), else the recipe. */
export function entryTitle(entry) {
  return clean(entry?.title) || clean(entry?.recipe?.name) || clean(entry?.recipe_name) || null;
}

/** The meal types in the order of a day (Tandoor `order`, then name). */
export function sortMealTypes(types) {
  return [...types].sort(
    (a, b) =>
      (Number(a.order) || 0) - (Number(b.order) || 0) ||
      String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
      (Number(a.id) || 0) - (Number(b.id) || 0),
  );
}

/**
 * The meal plan, by day then by meal type, in the order of a day. An entry
 * spanning several days (from Monday to Wednesday) is on each of them.
 * @param {object[]} entries meal plan entries of Tandoor
 * @param {object[]} types the meal types (for their order)
 * @param {string} first the first day kept (`YYYY-MM-DD`)
 * @param {string} last the last day kept
 * @returns {Map<string, Map<number|string, { type: object, titles: string[] }>>}
 */
export function groupMeals(entries, types, first, last) {
  const order = new Map(sortMealTypes(types).map((type, index) => [type.id, index]));
  const rank = (entry) => order.get(entry.meal_type?.id) ?? order.size;
  const sorted = [...entries].sort(
    (a, b) =>
      String(a.from_date).localeCompare(String(b.from_date)) ||
      rank(a) - rank(b) ||
      (Number(a.id) || 0) - (Number(b.id) || 0),
  );
  const days = new Map();
  for (const entry of sorted) {
    const title = entryTitle(entry);
    const from = dateOf(entry.from_date);
    const to = dateOf(entry.to_date) ?? from;
    if (!title || !from) {
      continue;
    }
    const type = entry.meal_type && typeof entry.meal_type === 'object' ? entry.meal_type : null;
    const key = type?.id ?? '?';
    // A week at most per entry: a mistaken year-long entry stays cheap.
    let day = from < first ? first : from;
    for (let n = 0; day <= to && day <= last && n < 8; n += 1, day = addDays(day, 1)) {
      if (!days.has(day)) {
        days.set(day, new Map());
      }
      const meals = days.get(day);
      if (!meals.has(key)) {
        meals.set(key, { type: type ?? { id: key, name: entry.meal_type_name ?? '' }, titles: [] });
      }
      meals.get(key).titles.push(title);
    }
  }
  // Within a day, the order of the meal types (Map keeps insertion order).
  for (const [day, meals] of days) {
    const ordered = [...meals.entries()].sort(
      ([a], [b]) => (order.get(a) ?? order.size) - (order.get(b) ?? order.size),
    );
    days.set(day, new Map(ordered));
  }
  return days;
}

/**
 * A name as people say it, to compare two of them: no case, no accents, no
 * ligatures, single spaces. "Œufs " and "oeufs" are the same item.
 */
export function normalizeName(text) {
  return String(text ?? '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** What an entry is: its food ("Tomates"). */
export function itemName(entry) {
  return clean(entry?.food?.name) || '?';
}

/** A quantity in the language of the user: 1.5 → "1,5" in French. */
export function formatQuantity(quantity, language) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(quantity);
}

/**
 * The amount of an entry, besides its name: "1,5 kg", "×6", or ''. Without a
 * unit, one is not worth saying ("Milk", not "Milk ×1").
 */
export function itemDetail(entry, language) {
  const amount = Number(entry?.amount);
  const unit = clean(entry?.unit?.name);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  if (!unit) {
    return hasAmount && amount !== 1 ? `×${formatQuantity(amount, language)}` : '';
  }
  return [hasAmount ? formatQuantity(amount, language) : '', unit].filter(Boolean).join(' ');
}

/** Name and amount in one line: "Tomates (1,5 kg)". */
export function itemLabel(entry, language) {
  const detail = itemDetail(entry, language);
  return detail ? `${itemName(entry)} (${detail})` : itemName(entry);
}

/** A name without its plural mark ("tomates" → "tomate", "choux" → "chou"), word by word. */
export function stem(name) {
  return name
    .split(' ')
    .map((word) => (word.length > 3 ? word.replace(/(?<=[^s])[sx]$/, '') : word))
    .join(' ');
}

/** Whether an entry is the one a person named ("tomate" is the entry "Tomates"). */
export function itemMatches(entry, wanted) {
  const target = stem(normalizeName(wanted));
  if (!target) {
    return false;
  }
  return [itemName(entry), entry?.food?.plural_name].some(
    (name) => typeof name === 'string' && stem(normalizeName(name)) === target,
  );
}

/**
 * Whether an entry is still to buy: unchecked, and not postponed to a later
 * date (Tandoor's "delay": the entry is hidden until then).
 */
export function isToBuy(entry, now) {
  if (entry?.checked === true) {
    return false;
  }
  const delay = Date.parse(entry?.delay_until ?? '');
  return !(Number.isFinite(delay) && delay > now);
}

/** The entries in the order of the Tandoor app (order, then age). */
export function sortItems(entries) {
  return [...entries].sort(
    (a, b) =>
      (Number(a.order) || 0) - (Number(b.order) || 0) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
      (Number(a.id) || 0) - (Number(b.id) || 0),
  );
}

/** Whether an entry is on a shopping list (the list `null`: the whole shopping list). */
export const onList = (entry, listId) =>
  listId === null ||
  (Array.isArray(entry?.shopping_lists) && entry.shopping_lists.some((list) => list.id === listId));

/**
 * The list a person named: same name first, then the only list whose name
 * starts with (or contains) what was typed.
 * @returns {object|null} null when nothing matches (an empty name is handled by the caller)
 */
export function findList(lists, wanted) {
  const target = normalizeName(wanted);
  if (!target) {
    return null;
  }
  const names = lists.map((list) => ({ list, name: normalizeName(list.name) }));
  const exact = names.find((entry) => entry.name === target);
  if (exact) {
    return exact.list;
  }
  for (const test of [(name) => name.startsWith(target), (name) => name.includes(target)]) {
    const found = names.filter((entry) => test(entry.name));
    if (found.length === 1) {
      return found[0].list;
    }
  }
  return null;
}
