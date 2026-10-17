# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the Tandoor access token is a `secret` field of the Gladys
  configuration. The integration reads it from Gladys at startup, keeps it in
  memory, sends it only to the Tandoor address of the configuration (an
  `Authorization: Bearer` header), and never writes it to `/data` nor to the
  logs. The token acts as the Tandoor user who created it, within its scope:
  `read` is enough to read, `read write` is needed to add or check an item.
- **Stored in `/data`**: nothing. Everything is read again from Tandoor and
  Gladys after a restart.
- **Writes to Tandoor**: a shopping list entry added (through the ingredient
  parser of Tandoor, which may create the food or the unit, as typing the line
  in Tandoor would), an entry checked — from a scene action or a dashboard
  button. Nothing is ever deleted. A dashboard button can be used by any user
  of Gladys who sees the dashboard.
- **Network**: requests go only to the Tandoor address typed in the
  configuration, in HTTP or HTTPS. HTTPS certificates are verified unless the
  user ticks "Accept self-signed certificates"; the integration opens no port
  and calls no cloud service.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Tandoor Recipes itself (see its
[security policy](https://github.com/TandoorRecipes/recipes/security/policy)).
