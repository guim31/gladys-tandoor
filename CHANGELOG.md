# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-17

### Added

- One Gladys device per Tandoor Recipes space, proposed in the Discover tab:
  what is planned today for each meal type of Tandoor, tomorrow's meals, the
  number of meals planned this week, the items still to buy on the whole
  shopping list and on each Tandoor list. Feature names are in French by
  default (English, German and Spanish available).
- Tandoor Recipes 2.x, through its REST API and an access token; HTTPS with a
  self-signed certificate on request. "Today" follows the time zone of Gladys
  and changes right after midnight.
- Scene triggers: the meals of the day at the hour you choose, and the
  shopping list changed in Tandoor (items added, checked or removed elsewhere
  than in Gladys).
- Scene actions: add an item to the shopping list ("2 kg tomatoes" is
  understood, never twice), check an item, get the meals of a day and get a
  shopping list, for a message.
- Dashboard widgets (Gladys 5.2.0 or later): the meal plan of today or of the
  next seven days; the shopping list, with Add and Check buttons and their
  forms; Refresh, and Open Tandoor for an HTTPS Tandoor.
- A Test the connection button, a connection status that names the problem,
  and a transport badge on the device.
- Every text in English, French, German and Spanish, and the documentation in
  the four languages.

[Unreleased]: https://github.com/guim31/gladys-tandoor/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-tandoor/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-tandoor/releases/tag/v1.0.0
