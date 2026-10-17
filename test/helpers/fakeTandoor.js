// -----------------------------------------------------------------------------
// An in-memory Tandoor, seeded with the answers of a real Tandoor 2.6.15
// (test/fixtures/tandoor/real/, recorded on 2026-10-17), speaking the same
// REST API through the HTTP seam of the client (src/tandoor/http.js). It
// keeps the quirks the integration must live with: the server settings need
// no token, a refused token answers 403 (not 401), lists are paginated
// (`page_size` capped at 200), the shopping entries include the recently
// checked ones, the meal plan is filtered on the end date of an entry.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/tandoor/real/${name}.json`, import.meta.url), 'utf8'),
  );

export const TOKEN = 'tda_test_rw_token_0000000000000000';
export const READ_ONLY_TOKEN = 'tda_test_ro_token_0000000000000000';
export const BASE_URL = 'http://192.0.2.10:8080';
export const SPACE_ID = 1;
export const LIST_IDS = Object.freeze({ SUPERMARCHE: 1, MARCHE: 2 });
export const MEAL_TYPE_IDS = Object.freeze({ DEJEUNER: 1, DINER: 2, PETIT_DEJEUNER: 3 });

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const MAX_PAGE_SIZE = 200;

/** A paginated answer of Django REST framework, `next` pointing at the next page. */
function paginate(items, query, path) {
  const size = Math.min(Number(query.get('page_size')) || 50, MAX_PAGE_SIZE);
  const page = Number(query.get('page')) || 1;
  const start = (page - 1) * size;
  const results = items.slice(start, start + size);
  const next =
    start + size < items.length
      ? `${BASE_URL}/api/${path}?page=${page + 1}&page_size=${size}`
      : null;
  return { count: items.length, next, previous: null, timestamp: '', results };
}

export class FakeTandoor {
  constructor({ token = TOKEN } = {}) {
    this.token = token;
    this.settings = fixture('server-settings');
    this.space = fixture('space-current');
    this.mealTypes = fixture('meal-types').results;
    this.mealPlans = fixture('meal-plans').results;
    this.lists = fixture('shopping-lists').results;
    this.entries = fixture('shopping-entries').results;
    this.recipes = fixture('recipes-search').results;
    this.foods = new Map();
    for (const entry of this.entries) {
      this.foods.set(entry.food.name.toLowerCase(), entry.food);
    }
    this.nextId = 100;
    /** 'down' (no answer), 'html' (another web page), 'v1' (no server settings), or null. */
    this.failure = null;
    /** Every request received: { method, path, query, body }. */
    this.requests = [];
  }

  /** The HTTP seam of the client. */
  request = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const target = new URL(url);
    if (!url.startsWith(`${BASE_URL}/`) || this.failure === 'down') {
      const error = new Error(`connect ECONNREFUSED ${target.host}`);
      error.code = 'ECONNREFUSED';
      throw error;
    }
    const path = target.pathname.replace(/^\/api\//, '');
    this.requests.push({
      method,
      path,
      query: Object.fromEntries(target.searchParams),
      body: body === undefined ? undefined : JSON.parse(body),
    });
    if (this.failure === 'html') {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html></html>' };
    }
    if (path === 'server-settings/current/' && method === 'GET') {
      return this.failure === 'v1' ? json(404, { detail: 'Not found.' }) : json(200, this.settings);
    }
    const authorization = headers.authorization;
    if (authorization !== `Bearer ${this.token}` && authorization !== `Bearer ${READ_ONLY_TOKEN}`) {
      return json(403, fixture('error-bad-token'));
    }
    if (authorization === `Bearer ${READ_ONLY_TOKEN}` && method !== 'GET') {
      return json(403, fixture('error-read-only-token'));
    }
    return this.route(method, path, target.searchParams, body ? JSON.parse(body) : undefined);
  };

  route(method, path, query, body) {
    if (path === 'space/current/' && method === 'GET') {
      return json(200, this.space);
    }
    if (path === 'meal-type/' && method === 'GET') {
      return json(200, paginate(this.mealTypes, query, path));
    }
    if (path === 'meal-plan/' && method === 'GET') {
      const from = query.get('from_date') ?? '0000-00-00';
      const to = query.get('to_date') ?? '9999-99-99';
      // Tandoor filters on the END date of an entry.
      const found = this.mealPlans.filter(
        (entry) => entry.to_date.slice(0, 10) >= from && entry.to_date.slice(0, 10) <= to,
      );
      return json(200, paginate(found, query, path));
    }
    if (path === 'shopping-list/' && method === 'GET') {
      return json(200, paginate(this.lists, query, path));
    }
    if (path === 'shopping-list-entry/' && method === 'GET') {
      return json(200, paginate(this.entries, query, path));
    }
    if (path === 'shopping-list-entry/' && method === 'POST') {
      if (!body.food?.name) {
        return { status: 500, headers: { 'content-type': 'text/html' }, body: '<h1>500</h1>' };
      }
      const entry = this.addEntry(body.food.name, {
        amount: body.amount ?? 0,
        unit: body.unit ?? null,
        shopping_lists: (body.shopping_lists ?? []).map((ref) =>
          this.lists.find((list) => list.id === ref.id),
        ),
      });
      return json(201, entry);
    }
    const entryMatch = path.match(/^shopping-list-entry\/(\d+)\/$/);
    if (entryMatch && method === 'PATCH') {
      const entry = this.entries.find((candidate) => candidate.id === Number(entryMatch[1]));
      if (!entry) {
        return json(404, { detail: 'No ShoppingListEntry matches the given query.' });
      }
      if ('checked' in body) {
        entry.completed_at = body.checked && !entry.checked ? '2026-10-17T15:11:37+02:00' : null;
        entry.checked = body.checked;
      }
      return json(200, entry);
    }
    if (path === 'ingredient-parser/post/' && method === 'POST') {
      return json(200, { ingredient: this.parse(body.ingredient), ingredients: [] });
    }
    if (path === 'recipe/' && method === 'GET') {
      const search = (query.get('query') ?? '').toLowerCase();
      return json(
        200,
        paginate(
          this.recipes.filter((recipe) => recipe.name.toLowerCase().includes(search)),
          query,
          path,
        ),
      );
    }
    return json(404, { detail: 'Not found.' });
  }

  /** The food of a name, created when new (Tandoor matches names without case). */
  food(name) {
    const key = name.toLowerCase();
    if (!this.foods.has(key)) {
      this.foods.set(key, {
        id: (this.nextId += 1),
        name,
        plural_name: null,
        supermarket_category: null,
        shopping_lists: [],
      });
    }
    return this.foods.get(key);
  }

  /** The ingredient parser, for the shapes the tests use: "2 kg tomates", "6 œufs", "Lait". */
  parse(text) {
    const match = String(text).match(/^(\d+(?:[.,]\d+)?)\s+(?:(kg|g|l|ml)\s+)?(.+)$/i);
    const amount = match ? Number(match[1].replace(',', '.')) : 0;
    const unit = match?.[2] ? { id: 1, name: match[2], plural_name: match[2] } : null;
    const food = this.food(match ? match[3] : text);
    return {
      id: null,
      food: { id: food.id, name: food.name, plural_name: null },
      unit,
      amount,
      note: '',
      original_text: text,
    };
  }

  /** An entry, as the Tandoor app would add it. */
  addEntry(name, { amount = 0, unit = null, shopping_lists = [], ...extra } = {}) {
    const id = (this.nextId += 1);
    const entry = {
      id,
      list_recipe: null,
      shopping_lists: shopping_lists.filter(Boolean),
      food: this.food(name),
      unit,
      amount,
      order: 0,
      checked: false,
      ingredient: null,
      list_recipe_data: null,
      created_by: this.entries[0]?.created_by ?? null,
      created_at: `2026-10-17T16:${String(id % 60).padStart(2, '0')}:00+02:00`,
      updated_at: `2026-10-17T16:${String(id % 60).padStart(2, '0')}:00+02:00`,
      completed_at: null,
      delay_until: null,
      ...extra,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Writes received. */
  writes() {
    return this.requests.filter(
      (request) => request.method !== 'GET' && request.path !== 'ingredient-parser/post/',
    );
  }
}
