// -----------------------------------------------------------------------------
// The Tandoor hub: reads Tandoor on a timer of the container (the interval
// chosen in the configuration, and right after midnight so "today" follows
// the calendar), publishes the device and its states to Gladys, fires the
// scene triggers, and runs the operations of the scene actions and the
// widget buttons.
//
// Gladys never polls the device (should_poll: false): the core scheduler does
// not reliably poll external devices (GladysAssistant/Gladys#3198, still open
// in 5.2.1), and its fixed list of frequencies stops at one minute. onPoll is
// kept as a fallback and reads Tandoor at once.
//
// One reading = four requests (more for a list longer than 200 entries): the
// meal types, the meal plan of the coming days, the shopping lists, the
// shopping list entries; plus "who am I" (server settings and space) at
// start, after an error, and every hour.
//
// Scene triggers:
//   - `meal_time`: at each new hour of a day with meals planned, with the
//     hour (the filter the scene author picks) and the meals of the day;
//   - `shopping_list_changed`: items added or checked in Tandoor (the app,
//     another user), seen at a reading. The changes Gladys made itself are
//     left out: a scene bound to the event must not loop through it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice, featureStates, spaceIds } from './devices.js';
import { ERROR_KINDS, TandoorClient, TandoorError } from './tandoor/client.js';
import {
  addDays,
  dayKey,
  findList,
  groupMeals,
  hourOf,
  isToBuy,
  itemLabel,
  itemMatches,
  itemName,
  msUntilNextDay,
  normalizeName,
  onList,
  sortItems,
} from './tandoor/model.js';
import { hostOf } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  NOTHING_PLANNED,
  REPORT_TEXT,
  WHOLE_LIST,
  format,
  pick,
  say,
} from './texts.js';

const logger = createLogger({ name: 'tandoor-hub' });

// Widget keys (manifest `widgets`): permanent once published.
export const WIDGET_KEYS = Object.freeze({
  MEAL_PLAN: 'meal_plan',
  SHOPPING_LIST: 'shopping_list',
});

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGER_KEYS = Object.freeze({
  MEAL_TIME: 'meal_time',
  SHOPPING_LIST_CHANGED: 'shopping_list_changed',
});

// The days a scene can pick, as offsets from today.
export const DAYS = Object.freeze({ today: 0, tomorrow: 1, day_after_tomorrow: 2 });

// Days of meal plan the device and the widget show (today included).
export const WEEK_DAYS = 7;
// Meal plan entries are filtered by Tandoor on their end date: an entry
// ending this many days ahead (a breakfast planned for months) may still
// cover the week.
const PLAN_LOOKAHEAD_DAYS = 366;

// Item names listed in the trigger variables, at most (the rest is counted).
export const MAX_EVENT_ITEMS = 20;

export const HUB_TIMINGS = {
  // A failed reading is tried again this soon (then at the usual interval).
  retryMs: 60_000,
  // "Who am I" (version, space) is read again this often.
  identifyEveryMs: 3600_000,
  // A scene action or a widget reads Tandoor again when the last read is older.
  freshMs: 30_000,
  // An unchanged state is sent again this often: Gladys shows "no recent
  // value" on a state older than 48 h.
  heartbeatMs: 6 * 3600_000,
  // Read a little after midnight, so "today" has changed for sure.
  midnightDelayMs: 5_000,
  // The clock of the `meal_time` trigger looks at the hour this often.
  clockMs: 60_000,
};

// A name in a message: a toast holds 200 characters.
const short = (text) => (text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text);

const signature = (config) => JSON.stringify([config.url, config.token, config.allowSelfSigned]);

/** The name of a list in a message: the whole shopping list has none. */
export const listLabel = (list, language) =>
  list.id === null ? pick(WHOLE_LIST, language) : list.name;

// A string in a scene event holds 1000 characters at most (SDK, core).
const MAX_EVENT_TEXT = 1000;
const fitEvent = (text) =>
  text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT - 1).trimEnd()}…` : text;

/** A list of names for a message or a variable: "milk, bread, +3". */
function joinNames(names, max = MAX_EVENT_ITEMS) {
  const shown = names.slice(0, max);
  return fitEvent(
    names.length > shown.length
      ? `${shown.join(', ')}, +${names.length - shown.length}`
      : shown.join(', '),
  );
}

/** A refusal of an operation, said in the user's words. */
export class ActionError extends Error {
  /**
   * @param {object} entry a table entry of src/texts.js
   * @param {object|Function} [values] its `{name}` values, or a function of the language
   */
  constructor(entry, values = {}) {
    super(format(entry.en, typeof values === 'function' ? values('en') : values));
    this.name = 'ActionError';
    this.entry = entry;
    this.values = values;
  }

  /** The message in one language. */
  text(language) {
    const values = typeof this.values === 'function' ? this.values(language) : this.values;
    return say(this.entry, language, values);
  }

  /** The message in every language (a widget toast). */
  all() {
    return Object.fromEntries(Object.keys(this.entry).map((lang) => [lang, this.text(lang)]));
  }
}

/** A valid IANA time zone, or undefined (the one of the system). */
function validTimeZone(zone) {
  if (!zone) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

export class TandoorHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.request] HTTP seam (src/tandoor/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {string} [options.timeZone] the time zone of Gladys (TZ by default)
   */
  constructor({ gladys, request, timers = true, timings, now, timeZone }) {
    this.gladys = gladys;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.timeZone = validTimeZone(timeZone ?? process.env.TZ);
    this.config = null;
    this.client = null;
    this.signature = null;
    /** What the last good reading saw (kept while Tandoor does not answer). */
    this.snapshot = null;
    this.identity = null;
    this.identifiedAt = 0;
    this.error = null;
    this.readAt = 0;
    this.snapshotAt = 0;
    this.connected = false;
    this.polling = null;
    this.pollTimer = null;
    this.clockTimer = null;
    this.stopped = false;
    this.discovered = null;
    this.transport = null;
    this.connection = null;
    this.widgetSignature = null;
    /** The items to buy at the last reading (id → label), for `shopping_list_changed`. */
    this.shoppingBaseline = null;
    /** Entry ids Gladys itself added or checked: not reported by the trigger. */
    this.ownChanges = new Set();
    /** The `shopping_list_changed` data of the last reading, until published. */
    this.pendingShoppingEvents = [];
    /** Writes to Tandoor in progress, and how many ended: a reading begun
     * before a write ended cannot tell Gladys' change from another one. */
    this.writing = 0;
    this.writeSeq = 0;
    this.pollingClient = null;
    this.pollingSeq = 0;
    /** The last hour seen by the clock (`YYYY-MM-DDTHH`). */
    this.hourSlot = null;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    // The hour already begun is not fired: the container may just restart.
    this.hourSlot = this.currentSlot();
    try {
      await this.reconfigure(config);
    } finally {
      // The meal_time clock runs even when the first reading threw.
      this.scheduleClock();
    }
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.discovered = null;
    this.transport = null;
    this.connection = null;
    this.gladys.forgetPublishedStates?.();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config !== null && this.config.language !== config.language;
    this.config = config;
    if (signature(config) !== this.signature) {
      this.signature = signature(config);
      this.client = config.url
        ? new TandoorClient({
            url: config.url,
            token: config.token,
            insecure: config.allowSelfSigned,
            request: this.request,
          })
        : null;
      this.identity = null;
      this.identifiedAt = 0;
      this.error = null;
      this.readAt = 0;
      // Another Tandoor (or token): its shopping list is not a change.
      this.shoppingBaseline = null;
      this.ownChanges.clear();
      if (!this.client) {
        this.snapshot = null;
      }
    }
    if (languageChanged) {
      this.discovered = null;
      this.widgetSignature = null;
    }
    await this.pollNow({ publish: true });
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.clockTimer);
    await this.polling?.catch(() => {});
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const interval = this.error
      ? Math.min(this.timings.retryMs, this.config.pollIntervalMs)
      : this.config.pollIntervalMs;
    const midnight = msUntilNextDay(this.now(), this.timeZone) + this.timings.midnightDelayMs;
    this.pollTimer = setTimeout(
      async () => {
        try {
          await this.pollNow();
          this.problems.recover('poll', 'Reading Tandoor works again');
        } catch (err) {
          this.problems.fail('poll', `Reading loop failed: ${err.message}`, 'error');
          this.schedulePoll();
        }
      },
      Math.min(interval, midnight),
    );
    this.pollTimer.unref?.();
  }

  /** The clock of the `meal_time` trigger: a look at the hour every minute. */
  scheduleClock() {
    clearTimeout(this.clockTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    // Just after the next minute, so a new hour is seen within a second.
    const delay = this.timings.clockMs - (this.now() % this.timings.clockMs) + 1_000;
    this.clockTimer = setTimeout(async () => {
      try {
        await this.tick();
        this.problems.recover('clock', 'Meal time trigger works again');
      } catch (err) {
        this.problems.fail('clock', `Meal time trigger failed: ${err.message}`, 'error');
      }
      this.scheduleClock();
    }, delay);
    this.clockTimer.unref?.();
  }

  // --- Reading ----------------------------------------------------------------

  /** Today in the time zone of Gladys. */
  today() {
    return dayKey(this.now(), this.timeZone);
  }

  currentSlot() {
    const now = this.now();
    return `${dayKey(now, this.timeZone)}T${String(hourOf(now, this.timeZone)).padStart(2, '0')}`;
  }

  /**
   * Read Tandoor now, publish what changed, and plan the next reading.
   * Concurrent calls share the reading.
   */
  async pollNow({ publish = false } = {}) {
    // A reading begun with another client (reconfigured) or before the last
    // write ended is outdated: let it end, then read again.
    while (
      this.polling &&
      (this.pollingClient !== this.client || this.pollingSeq < this.writeSeq)
    ) {
      await this.polling.catch(() => {});
    }
    if (!this.polling) {
      this.pollingClient = this.client;
      this.pollingSeq = this.writeSeq;
      const seq = this.writeSeq;
      this.polling = this.read(seq).finally(() => {
        this.polling = null;
      });
    }
    const changed = await this.polling;
    await this.afterReading(changed, { publish });
    this.schedulePoll();
  }

  /** Read again when the last reading is older than `freshMs` (scenes, widgets). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /** @returns {Promise<boolean>} whether the widgets show something new */
  async read(seq = this.writeSeq) {
    if (!this.client) {
      return false;
    }
    const client = this.client;
    try {
      const now = this.now();
      if (!this.identity || now - this.identifiedAt >= this.timings.identifyEveryMs) {
        const identity = await client.identify();
        if (client !== this.client) {
          return false; // reconfigured meanwhile: not the identity of the new Tandoor
        }
        this.identity = identity;
        this.identifiedAt = now;
      }
      const today = this.today();
      const [mealTypes, meals, lists, entries] = await Promise.all([
        client.mealTypes(),
        client.mealPlans(today, addDays(today, PLAN_LOOKAHEAD_DAYS)),
        client.shoppingLists(),
        client.shoppingEntries(),
      ]);
      if (client !== this.client) {
        return false; // reconfigured meanwhile
      }
      return this.applySuccess({ mealTypes, meals, lists, entries, today, seq });
    } catch (err) {
      if (client !== this.client) {
        return false; // the failure of a client replaced meanwhile
      }
      if (!(err instanceof TandoorError)) {
        throw err;
      }
      return this.applyFailure(err);
    }
  }

  applySuccess({ mealTypes, meals, lists, entries, today, seq = this.writeSeq }) {
    const { version, space } = this.identity;
    const now = this.now();
    const toBuy = sortItems(entries.filter((entry) => isToBuy(entry, now)));
    this.snapshot = {
      spaceId: space.id,
      space: space.name || null,
      version,
      day: today,
      mealTypes,
      meals,
      days: groupMeals(meals, mealTypes, today, addDays(today, WEEK_DAYS - 1)),
      lists,
      items: toBuy,
    };
    const wasError = this.error;
    this.error = null;
    this.readAt = now;
    this.snapshotAt = now;
    if (!this.connected) {
      this.connected = true;
      logger.info(
        `Connected to Tandoor ${version ?? '?'} at ${hostOf(this.config.url)}, space "${
          space.name || '?'
        }": ${mealTypes.length} meal type(s), ${lists.length} shopping list(s)`,
      );
    } else if (wasError) {
      logger.info('Tandoor answers again');
    }
    logger.debug(`Read: ${meals.length} meal plan entries, ${toBuy.length} item(s) to buy`);
    const changes = this.shoppingChanges(seq);
    if (changes) {
      this.pendingShoppingEvents.push(changes);
    }
    return this.widgetChanged();
  }

  applyFailure(err) {
    const previous = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (previous !== err.kind) {
      logger.warn(`Tandoor at ${hostOf(this.config.url)}: ${err.message}`);
    } else {
      logger.debug(`Tandoor still failing: ${err.message}`);
    }
    // A token refused or a Tandoor replaced: ask again who we are next time.
    this.identity = err.kind === ERROR_KINDS.UNREACHABLE ? this.identity : null;
    return previous !== err.kind || this.widgetChanged();
  }

  /**
   * What changed on the shopping list since the last reading, Gladys' own
   * changes left out; null when nothing to report (or the first reading).
   */
  shoppingChanges(seq) {
    const language = this.config.language;
    const current = new Map(
      this.snapshot.items.map((entry) => [entry.id, itemLabel(entry, language)]),
    );
    const previous = this.shoppingBaseline;
    // A reading that may have seen a write of Gladys half done: not compared
    // (the baseline stays), the next reading will be.
    if (previous !== null && (this.writing > 0 || seq < this.writeSeq)) {
      return null;
    }
    this.shoppingBaseline = current;
    if (previous === null) {
      return null;
    }
    const added = [];
    const removed = [];
    for (const [id, label] of current) {
      if (!previous.has(id) && !this.ownChanges.delete(id)) {
        added.push(label);
      }
    }
    for (const [id, label] of previous) {
      if (!current.has(id) && !this.ownChanges.delete(id)) {
        removed.push(label);
      }
    }
    // Every write of Gladys ended before this reading: what it did is
    // accounted for, a change undone meanwhile in Tandoor must not linger.
    this.ownChanges.clear();
    if (added.length === 0 && removed.length === 0) {
      return null;
    }
    return {
      added: joinNames(added),
      removed: joinNames(removed),
      added_count: added.length,
      removed_count: removed.length,
      to_buy: current.size,
    };
  }

  /** Whether what the widgets show changed since they were last told. */
  widgetChanged() {
    const key = JSON.stringify([
      this.error?.kind ?? null,
      this.snapshot?.day,
      this.snapshot?.meals.map((entry) => [
        entry.id,
        entry.from_date,
        entry.to_date,
        entry.meal_type?.id,
        entry.title,
        entry.recipe?.id,
      ]),
      this.snapshot?.mealTypes.map((type) => [type.id, type.name, type.order]),
      this.snapshot?.lists.map((list) => [list.id, list.name]),
      this.snapshot?.items.map((entry) => [
        entry.id,
        itemLabel(entry, 'en'),
        entry.shopping_lists?.map((list) => list.id),
      ]),
    ]);
    if (key === this.widgetSignature) {
      return false;
    }
    this.widgetSignature = key;
    return true;
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  deviceId() {
    return this.snapshot ? spaceIds(this.gladys, this.snapshot.spaceId).device : null;
  }

  isCreated() {
    const id = this.deviceId();
    return Boolean(id) && (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  async afterReading(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishStates();
    await this.publishTransport();
    await this.publishConnectionStatus();
    await this.publishShoppingEvent();
    if (widgetChanged) {
      this.refreshWidgets();
    }
  }

  refreshWidgets() {
    for (const key of Object.values(WIDGET_KEYS)) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  /** Publish the Discovery list when it changed (a meal type or a list added...). */
  async publishDevices({ force = false } = {}) {
    if (!this.snapshot && !(force && !this.client)) {
      return;
    }
    const devices = this.snapshot
      ? [buildDevice(this.gladys, this.snapshot, this.config.language)]
      : [];
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** The states of the device, once the user added it (Gladys drops the others). */
  async publishStates() {
    if (!this.snapshot || !this.isCreated()) {
      return;
    }
    const language = this.config.language;
    const states = featureStates(
      this.gladys,
      this.snapshot,
      {
        mealsOn: (offset) => this.mealsOn(offset),
        summary: (meals) => this.summary(meals, language),
        weekCount: () => this.weekCount(),
        itemsOn: (listId) => this.itemsOn(listId),
      },
      pick(NOTHING_PLANNED, language),
    );
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeatMs,
      });
      if (count > 0) {
        logger.debug(`${count} state(s) published`);
      }
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  /** The badge of the device: "local", or "unreachable" while Tandoor does not answer. */
  async publishTransport({ force = false } = {}) {
    if (!this.snapshot || !this.isCreated()) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    if (!force && transport === this.transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: this.deviceId(), transport }]);
      this.transport = transport;
      this.problems.recover('transports', 'Transport accepted again');
    } catch (err) {
      this.problems.fail('transports', `Transport refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.client) {
      return {
        connected: false,
        message: this.config.invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: this.readAt > 0 };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection || (status.connected === false && !status.message)) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  /** The `shopping_list_changed` trigger, when the last reading saw a change. */
  async publishShoppingEvent() {
    const pending = this.pendingShoppingEvents.splice(0);
    for (const data of pending) {
      logger.debug(`Shopping list changed: +${data.added_count} -${data.removed_count}`);
      try {
        await this.gladys.publishSceneEvent(TRIGGER_KEYS.SHOPPING_LIST_CHANGED, data);
        this.problems.recover('event', 'Scene events accepted again');
      } catch (err) {
        this.problems.fail('event', `Scene event refused: ${err.message}`);
      }
    }
  }

  /** Run a write to Tandoor; the readings meanwhile do not report it. */
  async write(operation) {
    this.writing += 1;
    try {
      return await operation();
    } finally {
      this.writing -= 1;
      this.writeSeq += 1;
    }
  }

  /**
   * A look at the clock: at a new hour, the `meal_time` trigger with the
   * meals of the day (none planned: nothing fired).
   */
  async tick() {
    const slot = this.currentSlot();
    if (slot === this.hourSlot) {
      return;
    }
    this.hourSlot = slot;
    if (!this.client) {
      return;
    }
    // The meals of today, not of the day before (midnight), nor of a stale read.
    if (this.snapshot?.day !== this.today()) {
      await this.pollNow();
    } else {
      await this.refreshIfStale();
    }
    if (this.error || !this.snapshot || this.snapshot.day !== this.today()) {
      return;
    }
    const meals = this.mealsOn(0);
    if (meals.size === 0) {
      return;
    }
    const titles = [...meals.values()].flatMap((meal) => meal.titles);
    const data = {
      hour: hourOf(this.now(), this.timeZone),
      meals: fitEvent(this.summary(meals, this.config.language)),
      recipes: joinNames(titles),
      count: titles.length,
    };
    try {
      await this.gladys.publishSceneEvent(TRIGGER_KEYS.MEAL_TIME, data);
      this.problems.recover('event', 'Scene events accepted again');
    } catch (err) {
      this.problems.fail('event', `Scene event refused: ${err.message}`);
    }
  }

  /** The user added the device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const id = this.deviceId();
    if (!id || device?.external_id !== id) {
      return;
    }
    this.gladys.forgetPublishedStates?.(id);
    await this.publishStates();
    await this.publishTransport({ force: true });
    this.refreshWidgets();
  }

  // --- Views -----------------------------------------------------------------------

  /** The meals of a day (offset from the day of the last reading), by meal type. */
  mealsOn(offset) {
    if (!this.snapshot) {
      return new Map();
    }
    // From the real today: after midnight with Tandoor unreachable, yesterday's
    // meals must not show as today's.
    return this.snapshot.days.get(addDays(this.today(), offset)) ?? new Map();
  }

  /** "Lunch: Lasagna · Dinner: Soup", '' when nothing is planned. */
  summary(meals, language) {
    const separator = language === 'fr' ? ' : ' : ': ';
    return [...meals.values()]
      .map(({ type, titles }) =>
        type.name ? `${type.name}${separator}${titles.join(', ')}` : titles.join(', '),
      )
      .join(' · ');
  }

  /** The meals planned in the next seven days, today included. */
  weekCount() {
    let count = 0;
    for (let offset = 0; offset < WEEK_DAYS; offset += 1) {
      for (const meal of this.mealsOn(offset).values()) {
        count += meal.titles.length;
      }
    }
    return count;
  }

  /** The items still to buy on a list (null: the whole shopping list). */
  itemsOn(listId) {
    return (this.snapshot?.items ?? []).filter((entry) => onList(entry, listId));
  }

  /** The error of the last reading, in words. */
  errorText(language) {
    return this.error ? pick(ERROR_TEXT[this.error.kind], language) : '';
  }

  /** The integration can answer: configured, and the last reading worked. */
  async assertReadable() {
    if (!this.client) {
      throw new ActionError(ACTION_TEXT.notConfigured);
    }
    await this.refreshIfStale();
    if (this.error || !this.snapshot) {
      throw new ActionError(ACTION_TEXT.unavailable, (language) => ({
        error: this.errorText(language) || pick(ERROR_TEXT[ERROR_KINDS.UNREACHABLE], language),
      }));
    }
  }

  /** The shopping list a person named; empty: the whole shopping list (`id: null`). */
  resolveList(name) {
    if (!normalizeName(name)) {
      return { id: null, name: '' };
    }
    const list = findList(this.snapshot.lists, name);
    if (!list) {
      throw new ActionError(ACTION_TEXT.listNotFound, {
        list: String(name).trim(),
        lists: this.snapshot.lists.map((entry) => entry.name).join(', ') || '-',
      });
    }
    return list;
  }

  /** A Tandoor refusal of a write, in words. */
  refusal(err) {
    if (err instanceof TandoorError) {
      return new ActionError(ACTION_TEXT.failed, (language) => ({
        error: pick(ERROR_TEXT[err.kind], language),
      }));
    }
    return err;
  }

  /** The item already to buy on a list under this name, if any. */
  findItem(list, name) {
    return this.itemsOn(list.id).find((entry) => itemMatches(entry, name));
  }

  /**
   * Add an item to the shopping list ("2 kg tomatoes" is read by the parser
   * of Tandoor), unless it is already there unchecked ("milk is finished"
   * said twice adds one milk).
   * @returns {Promise<{ added: boolean, item: string, list: object, message: ActionError }>}
   *   `message`: what to tell the user (an ActionError used as a text)
   */
  async addItem(text, listName) {
    const typed = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
    if (!typed) {
      throw new ActionError(ACTION_TEXT.itemMissing);
    }
    await this.assertReadable();
    const list = this.resolveList(listName);
    const already = (entry) => ({
      added: false,
      item: itemName(entry),
      list,
      message: new ActionError(ACTION_TEXT.itemAlready, (language) => ({
        item: short(itemName(entry)),
        list: listLabel(list, language),
      })),
    });
    const existing = this.findItem(list, typed);
    if (existing) {
      return already(existing);
    }
    let parsed;
    let entry;
    try {
      const text200 = typed.slice(0, 200);
      parsed = (await this.client.parseIngredient(text200)) ?? {
        amount: 0,
        unit: null,
        food: { name: text200 },
      };
      const sameFood = this.findItem(list, parsed.food.name);
      if (sameFood) {
        return already(sameFood);
      }
      entry = await this.write(async () => {
        const created = await this.client.addEntry(parsed, list.id === null ? [] : [list]);
        if (created?.id !== undefined) {
          this.ownChanges.add(created.id);
        }
        return created;
      });
    } catch (err) {
      throw this.refusal(err);
    }
    const name = itemName(entry ?? { food: parsed.food });
    logger.info(`"${name}" added to the shopping list${list.id === null ? '' : ` "${list.name}"`}`);
    await this.pollNow();
    return {
      added: true,
      item: name,
      list,
      message: new ActionError(ACTION_TEXT.itemAdded, (language) => ({
        item: short(name),
        list: listLabel(list, language),
      })),
    };
  }

  /**
   * Check an item of the shopping list (Tandoor keeps it, checked: unchecking
   * it in Tandoor undoes this).
   * @param {object} what `{ name }` as a person says it, or `{ id }` (widget form)
   */
  async checkItem({ name, id }, listName) {
    await this.assertReadable();
    const list = this.resolveList(listName);
    const items = this.itemsOn(list.id);
    let item;
    if (id !== undefined && id !== null && id !== '') {
      item = items.find((entry) => String(entry.id) === String(id));
    } else {
      item = this.findItem(list, name);
      if (!item) {
        // "tomates" for "Tomates cerises": the only item whose name contains it.
        const target = normalizeName(name);
        const close = target
          ? items.filter((entry) => normalizeName(itemName(entry)).includes(target))
          : [];
        item = close.length === 1 ? close[0] : undefined;
      }
    }
    if (!item) {
      const wanted = String(name ?? '').trim();
      return {
        checked: false,
        item: wanted,
        list,
        message: wanted
          ? new ActionError(ACTION_TEXT.itemNotFound, (language) => ({
              item: short(wanted),
              list: listLabel(list, language),
            }))
          : new ActionError(ACTION_TEXT.itemGone, (language) => ({
              list: listLabel(list, language),
            })),
      };
    }
    try {
      await this.write(async () => {
        await this.client.setChecked(item.id, true);
        this.ownChanges.add(item.id);
      });
    } catch (err) {
      throw this.refusal(err);
    }
    logger.info(`"${itemName(item)}" checked on the shopping list`);
    await this.pollNow();
    return {
      checked: true,
      item: itemName(item),
      list,
      message: new ActionError(ACTION_TEXT.itemChecked, (language) => ({
        item: short(itemName(item)),
        list: listLabel(list, language),
      })),
    };
  }

  /** "Test the connection": read Tandoor now (who am I included), one report. */
  async testConnection() {
    if (this.client) {
      this.identity = null;
    }
    await this.pollNow({ publish: true });
    const message = {};
    for (const language of Object.keys(REPORT_TEXT.ok)) {
      const status = this.connectionStatus();
      if (!this.client) {
        message[language] = pick(status.message, language);
      } else if (this.error) {
        message[language] = say(REPORT_TEXT.failed, language, {
          host: hostOf(this.config.url),
          error: this.errorText(language),
        });
      } else {
        const { snapshot } = this;
        message[language] = [
          say(REPORT_TEXT.ok, language, {
            version: snapshot.version ?? '?',
            space: snapshot.space ?? '?',
          }),
          say(REPORT_TEXT.counts, language, {
            types: snapshot.mealTypes.length,
            meals: [...this.mealsOn(0).values()].reduce((sum, meal) => sum + meal.titles.length, 0),
            lists: snapshot.lists.length,
            items: snapshot.items.length,
          }),
        ].join('\n');
      }
    }
    logger.info('Connection tested from the configuration screen');
    return message;
  }
}
