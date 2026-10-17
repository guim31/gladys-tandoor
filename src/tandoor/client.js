// -----------------------------------------------------------------------------
// Tandoor client: the REST API of Tandoor Recipes 2.x (Django REST framework,
// `/api/...`), checked against Tandoor 2.6.15 running in Docker.
//
// Authentication: `Authorization: Bearer <token>`, an access token a user
// creates in Tandoor (Settings → API). It acts in the user's active space,
// with the scope of the token: `read` is enough to read, writing (an item
// added or checked) needs `read write`.
//
// Pitfalls of this API, met on the real server:
//   - a refused or expired token answers 403, not 401 ("Authentication
//     credentials were not provided."), like a token without the write scope
//     ("You do not have permission to perform this action."): the `detail`
//     tells them apart;
//   - lists are paginated (`page_size` 200 at most): read page by page;
//   - `shopping-list-entry/` returns the unchecked entries AND the ones
//     checked in the last days: the caller keeps the unchecked ones;
//   - `meal-plan/` filters on the END date of an entry (`to_date`).
//
// What the integration writes stays small and reversible: a shopping list
// entry added, checked or unchecked. Nothing is ever deleted.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // token refused (wrong, expired, deleted)
  TOKEN_MISSING: 'token_missing', // no token in the configuration
  FORBIDDEN: 'forbidden', // the token may not do this (read-only scope)
  NOT_TANDOOR: 'not_tandoor', // something answers, not a Tandoor 2.x
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class TandoorError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'TandoorError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// Largest page Tandoor serves (DefaultPagination.max_page_size).
export const PAGE_SIZE = 200;
// Pages read at most per list: 2000 entries, far above a household's.
export const MAX_PAGES = 10;

// The `detail` of a 403 that means "this token is not accepted at all".
const AUTH_DETAILS = /credentials were not provided|invalid token|token.*(expired|invalid)/i;

export class TandoorClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.token] access token, '' for none
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, token = '', insecure = false, request = httpRequest, timeoutMs = 10_000 }) {
    this.url = url;
    this.token = token;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  /**
   * One API call.
   * @param {string} method
   * @param {string} path below `/api/`, query string included
   * @param {object} [body] sent as JSON
   * @param {object} [options] { auth: false for the public endpoints }
   * @returns {Promise<any>} the parsed JSON answer
   * @throws {TandoorError}
   */
  async call(method, path, body, { auth = true } = {}) {
    const headers = { accept: 'application/json' };
    if (auth) {
      if (!this.token) {
        throw new TandoorError(ERROR_KINDS.TOKEN_MISSING, 'No access token configured');
      }
      headers.authorization = `Bearer ${this.token}`;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    let response;
    try {
      response = await this.request(`${this.url}/api/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new TandoorError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      throw new TandoorError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }

    const { status } = response;
    const where = `${method} /api/${path.split('?')[0]}`;
    if (status === 401 || (status === 403 && AUTH_DETAILS.test(detailOf(response.body)))) {
      throw new TandoorError(ERROR_KINDS.AUTH, `Token refused (HTTP ${status}, ${where})`, {
        status,
      });
    }
    if (status === 403) {
      throw new TandoorError(ERROR_KINDS.FORBIDDEN, `Not allowed (HTTP 403, ${where})`, {
        status,
      });
    }
    if (status >= 300 && status < 400) {
      throw new TandoorError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status}, ${where})`, {
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw new TandoorError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status}, ${where})`, {
        status,
      });
    }
    try {
      return JSON.parse(response.body);
    } catch {
      // An HTML page in 200: another service, or a proxy login page.
      throw new TandoorError(ERROR_KINDS.NOT_TANDOOR, `The answer is not JSON (${where})`);
    }
  }

  /**
   * Every element of a paginated list, page by page.
   * @param {string} path below `/api/`, without query string
   * @param {Record<string, string>} [params]
   */
  async all(path, params = {}) {
    const results = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        ...params,
        page: String(page),
        page_size: String(PAGE_SIZE),
      });
      const answer = await this.call('GET', `${path}?${query}`);
      // A list endpoint without pagination answers an array.
      if (Array.isArray(answer)) {
        return answer;
      }
      const items = Array.isArray(answer?.results) ? answer.results : [];
      results.push(...items);
      if (!answer?.next || items.length === 0) {
        break;
      }
    }
    return results;
  }

  // --- Identity ------------------------------------------------------------------

  /**
   * Which Tandoor, and which space the token works in: checks the address,
   * the token and the version in one go.
   * @returns {Promise<{ version: string|null, space: { id: number, name: string } }>}
   */
  async identify() {
    let settings;
    try {
      settings = await this.call('GET', 'server-settings/current/', undefined, { auth: false });
    } catch (err) {
      // Tandoor 1.x has no server settings endpoint: treated as "not a Tandoor 2".
      if (err.kind === ERROR_KINDS.HTTP && err.status === 404) {
        throw new TandoorError(
          ERROR_KINDS.NOT_TANDOOR,
          'No Tandoor 2 API at this address (HTTP 404)',
        );
      }
      throw err;
    }
    if (!settings || typeof settings !== 'object' || !('version' in settings)) {
      throw new TandoorError(
        ERROR_KINDS.NOT_TANDOOR,
        'The answer is not the Tandoor server settings',
      );
    }
    const version = typeof settings.version === 'string' ? settings.version : null;
    const space = await this.call('GET', 'space/current/');
    if (!space || typeof space !== 'object' || space.id === undefined || space.id === null) {
      throw new TandoorError(ERROR_KINDS.NOT_TANDOOR, 'The answer is not a Tandoor space');
    }
    return {
      version,
      space: { id: space.id, name: typeof space.name === 'string' ? space.name : '' },
    };
  }

  // --- Reading -------------------------------------------------------------------

  /** The meal types of the space (Breakfast, Lunch... as the users named them). */
  mealTypes() {
    return this.all('meal-type/');
  }

  /**
   * The meal plan entries that END between two dates, both included (the
   * filter of Tandoor is on `to_date`).
   * @param {string} from `YYYY-MM-DD`
   * @param {string} to `YYYY-MM-DD`
   */
  mealPlans(from, to) {
    return this.all('meal-plan/', { from_date: from, to_date: to });
  }

  /** The shopping lists of the space (Tandoor 2.x: an entry can be on several, or none). */
  shoppingLists() {
    return this.all('shopping-list/');
  }

  /** The shopping list entries: unchecked ones, and the ones checked recently. */
  shoppingEntries() {
    return this.all('shopping-list-entry/');
  }

  /** Recipes whose name matches, as the Tandoor search box does. */
  async searchRecipes(query, pageSize = 20) {
    const params = new URLSearchParams({ query, page_size: String(pageSize) });
    const answer = await this.call('GET', `recipe/?${params}`);
    return Array.isArray(answer?.results) ? answer.results : [];
  }

  // --- Writing (small and reversible) ------------------------------------------------

  /**
   * Split "2 kg tomatoes" into amount, unit and food, with the parser of the
   * Tandoor interface (it creates the food and the unit when they are new,
   * as typing the line in Tandoor would).
   * @returns {Promise<{ amount: number, unit: object|null, food: object }|null>} null when unusable
   */
  async parseIngredient(text) {
    const answer = await this.call('POST', 'ingredient-parser/post/', { ingredient: text });
    const ingredient = answer?.ingredient;
    if (!ingredient?.food || typeof ingredient.food.name !== 'string' || !ingredient.food.name) {
      return null;
    }
    const amount = Number(ingredient.amount);
    return {
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
      unit: ingredient.unit?.name ? { id: ingredient.unit.id, name: ingredient.unit.name } : null,
      food: { id: ingredient.food.id, name: ingredient.food.name },
    };
  }

  /**
   * Add an entry to the shopping list.
   * @param {{ amount: number, unit: object|null, food: object }} parsed
   * @param {Array<{ id: number, name: string }>} lists the shopping lists, [] for none
   */
  addEntry(parsed, lists = []) {
    return this.call('POST', 'shopping-list-entry/', {
      food: parsed.food,
      unit: parsed.unit,
      amount: parsed.amount,
      shopping_lists: lists.map((list) => ({ id: list.id, name: list.name })),
    });
  }

  /** Check or uncheck an entry (Tandoor stamps `completed_at` itself). */
  setChecked(entryId, checked) {
    return this.call('PATCH', `shopping-list-entry/${encodeURIComponent(entryId)}/`, { checked });
  }
}

/** The `detail` of a Django REST framework error body, '' otherwise. */
function detailOf(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.detail === 'string' ? parsed.detail : '';
  } catch {
    return '';
  }
}
