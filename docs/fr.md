# Tandoor Recipes

[Tandoor Recipes](https://tandoor.dev/) est un gestionnaire de recettes
auto-hébergé : vos recettes, un planning des repas et une liste de courses
partagée. Cette intégration l'amène dans Gladys : un appareil montre ce qui est
prévu aujourd'hui pour chaque repas, les repas de demain, les repas prévus
cette semaine et les articles restant à acheter ; des scènes peuvent démarrer à
l'heure choisie avec le menu du jour, ou quand la liste de courses change dans
Tandoor, ajouter un article à la liste (« il n'y a plus de lait »), en cocher
un, ou envoyer le menu ou la liste ; deux widgets du tableau de bord montrent le
menu et la liste de courses, avec des boutons pour ajouter et cocher depuis la
tablette murale.

Testée contre un vrai serveur Tandoor Recipes 2.6.15 (sous Docker) ; pas encore
sur une vraie installation de Gladys : vos retours sont les bienvenus dans
[les issues](https://github.com/guim31/gladys-tandoor/issues).

## Ce qu'il faut

- Gladys Assistant 5.2.0 ou plus récent.
- Tandoor Recipes 2.x, joignable depuis la machine de Gladys : sur le réseau
  local, ou sur Internet en HTTPS.
- Un jeton d'accès d'un utilisateur de Tandoor, avec la portée `read write`
  (`read` seul suffit pour lire, pas pour ajouter ni cocher un article). Il agit
  au nom de cet utilisateur, dans son espace actif.

## Mise en route

### 1. Créer un jeton d'accès

Dans Tandoor, ouvrez **Paramètres**, puis **API**, et créez un jeton avec la
portée `read write` et une date d'expiration lointaine. Copiez le jeton
(`tda_…`) : Tandoor ne l'affiche en entier que juste après sa création.

### 2. Configurer l'intégration

Dans Gladys, **Intégrations → Tandoor Recipes → Configuration** :

- **Adresse de Tandoor** : l'adresse avec laquelle vous ouvrez Tandoor, port
  compris, par exemple `http://192.168.1.2:8080` ou
  `https://recettes.example.com`. Une adresse copiée du navigateur
  (`…/mealplan`) fonctionne aussi.
- **Jeton d'accès** : le jeton de l'étape 1.
- **Accepter les certificats auto-signés** : seulement pour une adresse en
  `https://` dont le certificat n'est pas reconnu non plus par votre navigateur.
- **Intervalle de rafraîchissement** : la fréquence de lecture de Tandoor,
  5 minutes par défaut (de 1 à 15 minutes). Ce que vous faites depuis Gladys
  s'affiche tout de suite.
- **Langue des noms et des messages** : la langue des noms des fonctionnalités
  et des textes des scènes (français par défaut).

Enregistrez, puis cliquez sur **Tester la connexion** : Tandoor répond avec sa
version, l'espace et ce qu'il contient.

### 3. Ajouter l'appareil

Dans **Intégrations → Tandoor Recipes → Découverte**, ajoutez l'appareil
**Tandoor**. Ses valeurs s'affichent aussitôt. Quand un type de repas ou une
liste de courses est créé dans Tandoor, l'appareil propose **Mettre à jour**
dans l'onglet Découverte : sa fonctionnalité s'ajoute alors.

## L'appareil Tandoor

Un appareil par espace Tandoor (l'espace actif de l'utilisateur du jeton). Ses
fonctionnalités :

| Fonctionnalité                | Type     | Valeur                                                                    |
| ----------------------------- | -------- | ------------------------------------------------------------------------- |
| `<type de repas> aujourd'hui` | Texte    | Une par type de repas de Tandoor : ce qui est prévu, ou « Rien de prévu » |
| `Repas de demain`             | Texte    | Les repas de demain, `Dîner : Lasagnes`, ou « Rien de prévu »             |
| `Repas prévus cette semaine`  | Compteur | Repas prévus dans les 7 prochains jours, aujourd'hui compris              |
| `Articles à acheter`          | Compteur | Articles encore à acheter sur toute la liste de courses                   |
| `À acheter : <liste>`         | Compteur | Articles encore à acheter sur chaque liste de courses de Tandoor          |

Les types de repas sont ceux de votre Tandoor (`Petit-déjeuner`, `Déjeuner`,
`Dîner`…, dans leur ordre de la journée, 10 au plus), avec les noms que vous
leur avez donnés. Une entrée du planning affiche son titre, à défaut sa
recette ; deux entrées pour un même repas s'affichent `Lasagnes · Salade`. Une
entrée sur plusieurs jours compte pour chacun d'eux. Un article reporté dans
Tandoor (« délai ») n'est pas à acheter avant sa date. « Aujourd'hui » suit le
fuseau horaire de Gladys : juste après minuit, les repas de demain deviennent
ceux du jour. Les noms sont donnés dans la langue de la configuration à l'ajout
de l'appareil, et restent ensuite tels quels (une règle de Gladys).

## Widgets du tableau de bord

Dans **Tableau de bord → Éditer le tableau de bord**, ajoutez un widget de
l'intégration **Tandoor Recipes**.

### Menu

- **Période : Aujourd'hui** : la date et une ligne par type de repas prévu
  aujourd'hui.
- **Période : 7 prochains jours** : une ligne par jour, aujourd'hui et demain
  signalés ; touchez un jour pour voir ses repas.
- **Actualiser** relit Tandoor.
- **Ouvrir Tandoor** ouvre le planning, quand Tandoor a une adresse en
  `https://` (Gladys n'ouvre pas d'autres liens).

### Liste de courses

Les articles encore à acheter (réglage **Liste de courses** : le nom d'une
liste de Tandoor ; vide : toute la liste de courses), avec leur quantité et leur
unité.

- **Ajouter** ouvre un formulaire à un champ, **Article**, lu comme une ligne
  tapée dans Tandoor : `Lait`, `2 kg tomates`. Un article déjà sur la liste (aux
  majuscules, accents et pluriel près) n'est pas ajouté deux fois.
- **Cocher** ouvre un formulaire qui liste les articles : celui choisi est coché
  dans Tandoor, comme dans son appli (le décocher là-bas l'annule).
- **Actualiser** relit Tandoor.
- **Ouvrir Tandoor** ouvre la liste de courses, quand Tandoor a une adresse en
  `https://`.

## Scènes

### Déclencheurs

| Déclencheur                   | Filtre         | Variables                                                              |
| ----------------------------- | -------------- | ---------------------------------------------------------------------- |
| **Repas du jour**             | Heure (0 à 23) | Tous les repas du jour, recettes, repas prévus                         |
| **Liste de courses modifiée** | (aucun)        | Articles ajoutés, articles cochés ou retirés, leurs nombres, à acheter |

- **Repas du jour** se déclenche à l'heure choisie, un jour où au moins un repas
  est prévu dans Tandoor : 17 pour savoir à 17 h quoi cuisiner ce soir. Un jour
  sans rien de prévu ne déclenche rien.
- **Liste de courses modifiée** se déclenche quand des articles ont été ajoutés,
  cochés ou retirés dans Tandoor (son appli, un autre utilisateur), vus à la
  lecture suivante. Ce que Gladys a fait elle-même (une scène, le widget) ne
  déclenche rien : une scène liée à ce déclencheur ne peut pas boucler.

### Actions

| Action                                       | Champs                                            | Résultats                                                    |
| -------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| **Ajouter à la liste de courses**            | Article, Liste de courses (vide : toute la liste) | Article ajouté (oui/non), Article, liste, articles à acheter |
| **Cocher un article de la liste de courses** | Article, Liste de courses                         | Article coché (oui/non), Article, liste, articles à acheter  |
| **Lire les repas d'un jour**                 | Jour (aujourd'hui, demain, après-demain)          | Tous les repas du jour, recettes, repas prévus               |
| **Lire une liste de courses**                | Liste de courses                                  | Articles à acheter (séparés par des virgules), nombre, liste |

- Un article se tape comme dans Tandoor : `2 kg tomates` donne 2 kg de
  l'aliment « tomates » (l'analyseur d'ingrédients de Tandoor, qui crée un
  nouvel aliment ou une nouvelle unité comme le ferait la saisie dans Tandoor).
- Un article se retrouve comme vous le dites : `oeufs` trouve `Œufs`, `tomate`
  trouve `Tomates`. Une liste se retrouve par son nom, ou par son début
  (`super` pour `Supermarché`).
- Un article déjà sur la liste n'est pas ajouté à nouveau : le résultat
  **Article ajouté** vaut alors « non ». Un article absent de la liste n'est pas
  une erreur : **Article coché** vaut « non ».
- Les résultats servent aux actions suivantes de la scène, par exemple un
  message `Ce soir : {{0.0.summary}}` (`0.0` : la position de l'action dans la
  scène ; l'éditeur de message liste les résultats).

### Idées de scènes

- **Qu'est-ce qu'on mange ce soir ?** : déclencheur **Repas du jour** à 17, puis
  envoyer `{{triggerEvent.data.meals}}` sur Telegram.
- **« Il n'y a plus de lait »** : un bouton (ou un assistant vocal) lance
  **Ajouter à la liste de courses** avec `Lait`.
- **Quelqu'un a complété la liste** : déclencheur **Liste de courses modifiée**,
  puis envoyer `Ajouté : {{triggerEvent.data.added}}` à celui qui fait les
  courses.
- **En route vers les magasins** : quand quelqu'un quitte le travail, **Lire une
  liste de courses**, puis envoyer ses articles s'il y en a.

## Rafraîchissement et usage de l'API de Tandoor

L'intégration lit Tandoor avec son propre minuteur (Gladys ne l'interroge pas),
à l'intervalle de la configuration, et juste après minuit. Une lecture, ce sont
quatre requêtes : les types de repas, le planning des jours à venir, les listes
de courses et les articles (plus de pages au-delà de 200 articles) ; « qui
suis-je » (version et espace) est relu une fois par heure. Tandoor n'impose
aucun quota d'API. Une action de scène, un widget ou une nouvelle heure relit
Tandoor quand la dernière lecture date de plus de 30 secondes ; ce que
l'intégration modifie est relu tout de suite.

Seules les valeurs qui changent sont envoyées à Gladys, et toutes les valeurs à
nouveau toutes les 6 heures.

## Dépannage

- **« jeton d'accès refusé »** : le jeton a été supprimé, a expiré, ou appartient
  à un autre Tandoor. Créez-en un nouveau (étape 1).
- **« le jeton d'accès ne peut que lire »** : le jeton a la portée `read` ;
  créez-en un en `read write` pour ajouter ou cocher des articles.
- **« Tandoor ne répond pas »** : vérifiez l'adresse et le port depuis la
  machine de Gladys (`http://<adresse>:8080/api/server-settings/current/` doit
  répondre). Le badge de l'appareil indique alors « injoignable », et ses
  valeurs restent les dernières lues.
- **« certificat refusé »** : cochez **Accepter les certificats auto-signés**,
  ou utilisez l'adresse en `http://` sur le réseau local.
- **« aucun Tandoor Recipes 2 à cette adresse »** : l'adresse répond par une
  autre page web (une page de connexion de reverse proxy…), ou Tandoor est en
  version 1.x : utilisez l'adresse de Tandoor lui-même, et mettez-le à jour.
- **Un type de repas ou une liste n'a pas de fonctionnalité** : ouvrez l'onglet
  Découverte et cliquez sur **Mettre à jour** sur l'appareil Tandoor.
- **Plus de détails** : mettez la variable d'environnement `LOG_LEVEL` à
  `debug` ; les logs ne contiennent jamais le jeton d'accès.

## Limites

- Un seul espace Tandoor par intégration : l'espace actif de l'utilisateur du
  jeton.
- L'appareil suit 10 types de repas et 20 listes de courses au plus ; le reste
  de la semaine est dans le widget et dans **Lire les repas d'un jour**.
- Les articles ne sont jamais supprimés : les articles cochés restent dans
  Tandoor jusqu'à ce que vous les effaciez là-bas. L'intégration ne planifie pas
  de recettes.
- **Repas du jour** se déclenche au début de l'heure ; l'heure déjà commencée
  au démarrage de l'intégration (une mise à jour, un redémarrage) n'est pas
  déclenchée.
- **Liste de courses modifiée** voit les changements à la lecture suivante
  (5 minutes par défaut), et un changement défait entre-temps n'est pas vu.
- Le formulaire **Cocher** liste les 50 premiers articles ; le widget montre
  7 articles et le nombre des autres.
- **Ouvrir Tandoor** n'apparaît que pour une adresse en `https://`.
- Pas encore testée sur une vraie installation de Gladys ; testée contre un vrai
  serveur Tandoor Recipes 2.6.15.
