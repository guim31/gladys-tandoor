// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the feature names
// (src/devices.js) and the widgets (src/widgets.js): connection status, errors,
// the "Test the connection" report, scene action outputs and errors. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". The meal types keep the names the users gave them in Tandoor.
// test/i18n.test.js checks every table.
//
// A `{name}` in a text is replaced by format().
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './tandoor/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Tandoor and an access token in the configuration.',
    fr: "Saisissez l'adresse de votre Tandoor et un jeton d'accès dans la configuration.",
    de: 'Gib die Adresse deines Tandoor und ein Zugriffstoken in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Tandoor y un token de acceso en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:8080',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:8080',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:8080',
  },
};

// One short explanation per error kind (src/tandoor/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Tandoor does not answer',
    fr: 'Tandoor ne répond pas',
    de: 'Tandoor antwortet nicht',
    es: 'Tandoor no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'access token refused: create a new one in Tandoor (Settings → API)',
    fr: "jeton d'accès refusé : créez-en un autre dans Tandoor (Paramètres → API)",
    de: 'Zugriffstoken abgelehnt: Erstelle ein neues in Tandoor (Einstellungen → API)',
    es: 'token de acceso rechazado: cree otro en Tandoor (Ajustes → API)',
  },
  [ERROR_KINDS.TOKEN_MISSING]: {
    en: 'an access token is needed: create one in Tandoor (Settings → API)',
    fr: "un jeton d'accès est nécessaire : créez-le dans Tandoor (Paramètres → API)",
    de: 'ein Zugriffstoken ist nötig: Erstelle es in Tandoor (Einstellungen → API)',
    es: 'se necesita un token de acceso: créelo en Tandoor (Ajustes → API)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'the access token may only read: create one with the "read write" scope',
    fr: "le jeton d'accès ne peut que lire : créez-en un avec la portée « read write »",
    de: 'das Zugriffstoken darf nur lesen: Erstelle eines mit dem Bereich „read write“',
    es: 'el token de acceso solo puede leer: cree uno con el alcance «read write»',
  },
  [ERROR_KINDS.NOT_TANDOOR]: {
    en: 'no Tandoor Recipes 2 at this address',
    fr: 'aucun Tandoor Recipes 2 à cette adresse',
    de: 'kein Tandoor Recipes 2 unter dieser Adresse',
    es: 'no hay ningún Tandoor Recipes 2 en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer from Tandoor, see the logs',
    fr: 'réponse inattendue de Tandoor, voir les logs',
    de: 'unerwartete Antwort von Tandoor, sieh in den Protokollen nach',
    es: 'respuesta inesperada de Tandoor, consulte los registros',
  },
};

// The whole shopping list (no list named), in the messages: "added to the
// shopping list".
export const WHOLE_LIST = {
  en: 'the shopping list',
  fr: 'la liste de courses',
  de: 'die Einkaufsliste',
  es: 'la lista de la compra',
};

// The days a scene or a widget form can pick (scene action field `day`).
export const DAY_TEXT = {
  today: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  tomorrow: { en: 'Tomorrow', fr: 'Demain', de: 'Morgen', es: 'Mañana' },
  day_after_tomorrow: {
    en: 'Day after tomorrow',
    fr: 'Après-demain',
    de: 'Übermorgen',
    es: 'Pasado mañana',
  },
};

// The value of a meal feature on a day with nothing planned: a text state
// is never empty (Gladys ignores an empty one).
export const NOTHING_PLANNED = {
  en: 'Nothing planned',
  fr: 'Rien de prévu',
  de: 'Nichts geplant',
  es: 'Nada previsto',
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  ok: {
    en: 'Connected to Tandoor {version}, space "{space}".',
    fr: 'Connecté à Tandoor {version}, espace « {space} ».',
    de: 'Mit Tandoor {version} verbunden, Bereich „{space}“.',
    es: 'Conectado a Tandoor {version}, espacio «{space}».',
  },
  counts: {
    en: '{types} meal type(s), {meals} meal(s) planned today, {lists} shopping list(s), {items} item(s) to buy.',
    fr: '{types} type(s) de repas, {meals} repas prévu(s) aujourd’hui, {lists} liste(s) de courses, {items} article(s) à acheter.',
    de: '{types} Mahlzeitentyp(en), {meals} Mahlzeit(en) heute geplant, {lists} Einkaufsliste(n), {items} Eintrag/Einträge zu kaufen.',
    es: '{types} tipo(s) de comida, {meals} comida(s) prevista(s) hoy, {lists} lista(s) de la compra, {items} artículo(s) por comprar.',
  },
  failed: {
    en: 'Tandoor at {host}: {error}.',
    fr: 'Tandoor à {host} : {error}.',
    de: 'Tandoor unter {host}: {error}.',
    es: 'Tandoor en {host}: {error}.',
  },
};

// Messages of the scene actions and of the widget buttons. The errors are
// shown in Gladys (scene logs, widget toasts).
export const ACTION_TEXT = {
  notConfigured: {
    en: 'Tandoor is not configured.',
    fr: "Tandoor n'est pas configuré.",
    de: 'Tandoor ist nicht konfiguriert.',
    es: 'Tandoor no está configurado.',
  },
  unavailable: {
    en: 'Tandoor cannot be read: {error}.',
    fr: 'Tandoor est illisible : {error}.',
    de: 'Tandoor kann nicht gelesen werden: {error}.',
    es: 'No se puede leer Tandoor: {error}.',
  },
  listNotFound: {
    en: 'No shopping list "{list}" in Tandoor (lists: {lists}).',
    fr: 'Aucune liste de courses « {list} » dans Tandoor (listes : {lists}).',
    de: 'Keine Einkaufsliste „{list}“ in Tandoor (Listen: {lists}).',
    es: 'No hay ninguna lista de la compra «{list}» en Tandoor (listas: {lists}).',
  },
  itemMissing: {
    en: 'Enter the item to add.',
    fr: "Saisissez l'article à ajouter.",
    de: 'Gib den Eintrag ein, der hinzugefügt werden soll.',
    es: 'Introduzca el artículo que desea añadir.',
  },
  itemAdded: {
    en: '"{item}" added to {list}.',
    fr: '« {item} » ajouté à {list}.',
    de: '„{item}“ zu {list} hinzugefügt.',
    es: '«{item}» añadido a {list}.',
  },
  itemAlready: {
    en: '"{item}" is already on {list}.',
    fr: '« {item} » est déjà sur {list}.',
    de: '„{item}“ steht schon auf {list}.',
    es: '«{item}» ya está en {list}.',
  },
  itemChecked: {
    en: '"{item}" checked on {list}.',
    fr: '« {item} » coché sur {list}.',
    de: '„{item}“ auf {list} abgehakt.',
    es: '«{item}» marcado en {list}.',
  },
  itemNotFound: {
    en: '"{item}" is not on {list}.',
    fr: '« {item} » n’est pas sur {list}.',
    de: '„{item}“ steht nicht auf {list}.',
    es: '«{item}» no está en {list}.',
  },
  itemGone: {
    en: 'This item is no longer to buy on {list}.',
    fr: "Cet article n'est plus à acheter sur {list}.",
    de: 'Dieser Eintrag steht nicht mehr zum Kaufen auf {list}.',
    es: 'Este artículo ya no está por comprar en {list}.',
  },
  failed: {
    en: 'Tandoor refused: {error}.',
    fr: 'Tandoor a refusé : {error}.',
    de: 'Tandoor hat abgelehnt: {error}.',
    es: 'Tandoor lo ha rechazado: {error}.',
  },
};

export const LANGUAGES = Object.keys(INIT_FAILED);

/** A text in a language, English when missing. */
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** Replace the `{name}` of a text with values. */
export function format(text, values = {}) {
  return text.replace(/\{(\w+)\}/g, (whole, key) =>
    values[key] === undefined || values[key] === null ? whole : String(values[key]),
  );
}

/** A table entry formatted in one language. */
export const say = (entry, language, values) => format(pick(entry, language), values);

/** A table entry formatted in every language (a multi-language toast). */
export function sayAll(entry, values = {}) {
  return Object.fromEntries(
    Object.keys(entry).map((language) => [
      language,
      format(entry[language], typeof values === 'function' ? values(language) : values),
    ]),
  );
}
