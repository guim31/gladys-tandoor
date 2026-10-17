// -----------------------------------------------------------------------------
// The configuration as typed by people: addresses copied from the browser,
// tokens pasted with a space, values of the select fields.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseUrl } from '../src/config.js';

test('an address is understood whichever way it is typed', () => {
  const cases = {
    '192.0.2.10:8080': 'http://192.0.2.10:8080',
    ' http://192.0.2.10:8080/ ': 'http://192.0.2.10:8080',
    'https://recipes.example.com/search': 'https://recipes.example.com',
    'https://recipes.example.com/mealplan': 'https://recipes.example.com',
    'https://recipes.example.com/shopping/': 'https://recipes.example.com',
    'https://recipes.example.com/recipe/12': 'https://recipes.example.com',
    'https://recipes.example.com/settings/api': 'https://recipes.example.com',
    'http://192.0.2.10:8080/api/meal-plan/': 'http://192.0.2.10:8080',
    'https://example.com/tandoor': 'https://example.com/tandoor',
    'https://example.com/tandoor/view/recipe/3': 'https://example.com/tandoor',
  };
  for (const [typed, expected] of Object.entries(cases)) {
    assert.equal(parseUrl(typed), expected, typed);
  }
});

test('an address with credentials or another scheme is refused', () => {
  for (const typed of [
    '',
    '   ',
    'ftp://192.0.2.10',
    'http://user:pass@192.0.2.10:8080',
    'http://',
  ]) {
    assert.equal(parseUrl(typed), null, typed);
  }
  assert.equal(parseUrl(undefined), null);
});

test('normalized configuration: defaults, a pasted "Bearer " token, unknown values', () => {
  assert.deepEqual(normalizeConfig({}), {
    url: null,
    invalidUrl: false,
    token: '',
    allowSelfSigned: false,
    pollIntervalMs: 300_000,
    language: 'fr',
  });
  assert.deepEqual(
    normalizeConfig({
      url: '192.0.2.10:8080',
      api_token: ' Bearer abc.def \n',
      allow_self_signed: 'true',
      poll_interval: 60,
      language: 'de',
    }),
    {
      url: 'http://192.0.2.10:8080',
      invalidUrl: false,
      token: 'abc.def',
      allowSelfSigned: true,
      pollIntervalMs: 60_000,
      language: 'de',
    },
  );
  const odd = normalizeConfig({ url: 'ftp://x', poll_interval: '7', language: 'it' });
  assert.equal(odd.invalidUrl, true);
  assert.equal(odd.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 1000);
  assert.equal(odd.language, 'fr');
  assert.deepEqual(normalizeConfig(null).url, null);
});
