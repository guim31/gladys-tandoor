// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Tandoor server: a household has one, and the access token of a user
// gives access to the meal plan and the shopping list of that user's space.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds. Tandoor has no
// API quota; the integration reads it again at once after each of its own
// changes, and when a widget opens on stale data.
export const POLL_INTERVALS = ['60', '120', '300', '600', '900'];

export const DEFAULT_CONFIG = {
  url: '',
  api_token: '',
  allow_self_signed: false,
  poll_interval: '300',
  language: 'fr',
};

// Pages of the Tandoor interface: an address copied from the browser points
// at one of them, the API lives at the root.
const INTERFACE_PATH =
  /\/(search|mealplan|shopping|recipe|view|edit|list|books?|settings|space-overview|accounts|admin|welcome|database|docs)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:8080`), or an address copied from the browser
 * (`https://recipes.example.com/mealplan`). HTTP by default. A path is kept
 * (Tandoor behind a reverse proxy sub-path), the interface pages dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname
    .replace(/\/api(\/.*)?$/i, '')
    .replace(INTERFACE_PATH, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const typedUrl = text('url');
  const url = parseUrl(typedUrl);
  const interval = source.poll_interval === undefined ? '' : String(source.poll_interval);
  // A token pasted with its "Bearer " prefix still works.
  const token = text('api_token').replace(/^bearer\s+/i, '');

  return {
    url,
    invalidUrl: Boolean(typedUrl) && url === null,
    token,
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    pollIntervalMs:
      Number(POLL_INTERVALS.includes(interval) ? interval : DEFAULT_CONFIG.poll_interval) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
