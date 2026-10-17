# Tandoor Recipes for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
brings [Tandoor Recipes](https://tandoor.dev/), the self-hosted recipe manager,
into Gladys: the meal plan and the shopping list as a device, scene triggers
(the meals of the day at a chosen hour, the shopping list changed), scene
actions to add or check an item and to read the menu or the list, and two
dashboard widgets with buttons. It talks to the REST API of Tandoor 2.x with an
access token, over the local network. No cloud, no account.

> Tested against a real Tandoor Recipes 2.6.15 server, not yet in a real
> Gladys: feedback welcome in the
> [issues](https://github.com/guim31/gladys-tandoor/issues).

## Features

- **One device per Tandoor space**, proposed in the Discover tab: **what is
  planned today for each meal type** of your Tandoor (texts: the titles or
  recipes of the meal plan, "Nothing planned" otherwise), **tomorrow's meals**,
  the **number of meals planned this week**, the **items still to buy** on the
  whole shopping list and **on each Tandoor list**. Feature names in French by
  default (English, German and Spanish available).
- **Scene triggers**: _Meals of the day_ at the hour you choose (17: what do
  we cook tonight?), with the menu as variables; _Shopping list changed_ when
  items are added, checked or removed in Tandoor (never for what Gladys did
  itself, so a scene cannot loop).
- **Scene actions**: _Add to the shopping list_ (`2 kg tomatoes` is understood
  by the ingredient parser of Tandoor; never twice: "the milk is finished" said
  twice adds one milk), _Check a shopping list item_, _Get the meals of a day_
  and _Get a shopping list_ (for a message).
- **Dashboard widgets**: _Meal plan_ (today's meals, or the next seven days);
  _Shopping list_ (the whole list or one Tandoor list), with **Add** (a form
  with one text field) and **Check** (a form listing the items). Both with
  **Refresh**, and **Open Tandoor** for an HTTPS Tandoor.
- A **Test the connection** button, a connection status naming the problem
  (address, token, read-only token, certificate, Tandoor 1.x), a **transport
  badge** on the device.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.2.0** or later (widget buttons with forms).
- **Tandoor Recipes 2.x**, reachable from the Gladys machine.
- An **access token** of a Tandoor user (Settings → API), scope `read write`
  (`read` alone reads but cannot add or check).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-tandoor` (or
   install **Tandoor Recipes** from the catalog once it is listed).
2. In **Configuration**, enter the address of Tandoor
   (`http://192.168.1.2:8080`, `https://recipes.example.com`…) and the access
   token. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the **Tandoor** device.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- Every refresh interval (1 to 15 min, 5 min by default) and right after
  midnight in the time zone of Gladys, the integration reads the meal types
  (`GET /api/meal-type/`), the meal plan of the coming days
  (`GET /api/meal-plan/`), the shopping lists and the shopping list entries
  (`GET /api/shopping-list-entry/`, unchecked ones kept), page by page. Who
  the token is (`/api/server-settings/current/`, `/api/space/current/`) is
  read at start, after an error and once an hour. Tandoor sets no API quota.
- **Identity**: the id of the token's space. Changing the address of Tandoor
  keeps the device; each meal type and list feature is keyed on its Tandoor id.
- The device is published with `should_poll: false`: the integration reads
  Tandoor on its own timer (the Gladys scheduler does not reliably poll
  external devices, Gladys#3198), and `onPoll` reads it at once as a fallback.
  A clock looks at the hour every minute for the _Meals of the day_ trigger.
- Only the values that changed are sent to Gladys (the SDK's
  `publishChangedStates`), every value again every 6 hours, and all of them
  when the device is added or Gladys reconnects.
- **Writes are small and reversible**: an entry added (the text goes through
  `POST /api/ingredient-parser/post/`, then `POST /api/shopping-list-entry/`),
  an entry checked (`PATCH` of `checked` only). Nothing is ever deleted.
- Tandoor answers **403, not 401**, to a refused token: the `detail` of the
  answer tells a refused token from a read-only one.
- HTTP(S) runs on `node:http` / `node:https`, so a self-signed certificate can
  be accepted for this Tandoor only, when the user ticks the option.

## Checked on a real Tandoor, and what was not

On 17/10/2026, Tandoor Recipes 2.6.15 (`vabene1111/recipes`) ran in Docker with
PostgreSQL 16, filled through its API (three meal types with default times,
recipes, a meal plan with a recipe, a title alone and an entry over two days,
two shopping lists, entries with and without amount, unit and list, one
checked). Its answers are kept in `test/fixtures/tandoor/real/`. The optional
test `npm run test:real` (`TANDOOR_URL`, `TANDOOR_TOKEN`, `TANDOOR_WRITE=1` for
the writes, `TANDOOR_READ_ONLY_TOKEN` for the refusal) passed against it, and
the integration ran in its Docker image with the Gladys sandbox constraints
(read-only root, all capabilities dropped, 256 MB, bridge network) against the
same Tandoor.

Not checked: a real Gladys (rendering of the widgets and their forms, the
scene editor with the triggers), a Tandoor behind a reverse proxy with a
sub-path, several spaces or households, the hourly trigger over a real day.

## Limitations

- One Tandoor space per integration (the active space of the token's user).
- The device follows 10 meal types and 20 lists at most; the rest of the week
  is in the widget and the scene action.
- Checked items stay in Tandoor until cleared there; the integration does not
  plan recipes.
- _Meals of the day_ skips the hour already begun when the integration starts;
  _Shopping list changed_ sees the changes at the next reading.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
TANDOOR_URL=http://127.0.0.1:8080 TANDOOR_TOKEN=tda_... npm run test:real
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Tandoor (`test/helpers/fakeTandoor.js`) seeded with real
answers of Tandoor 2.6.15 (`test/fixtures/tandoor/real/`). See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Tandoor Recipes](https://github.com/TandoorRecipes/recipes) by vabene1111
  and contributors (AGPL-3.0): its source code was read to understand its API
  (serializers, filters, pagination), not copied.
- The architecture follows [gladys-mealie](https://github.com/guim31/gladys-mealie)
  (same idea, another recipe manager), itself built on
  [gladys-uptime-kuma](https://github.com/guim31/gladys-uptime-kuma) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Tandoor Recipes
or its authors.

## License

[Apache-2.0](LICENSE).
