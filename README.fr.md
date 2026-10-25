# OpenCode Tweaks — déplacer une session entre projets

Petit patch pour **OpenCode Desktop 2.1.4** qui permet de faire glisser une session depuis l'écran d'accueil vers un autre projet.

La modification prête pour l'amont est maintenue séparément dans une branche propre basée sur `origin/dev`. Les sons de notification ne font volontairement **pas** partie de cette branche : ils feront l'objet d'une proposition séparée, plus tard.

> Version anglaise (principale) : [README.md](README.md)

## Ce que ça fait

Depuis l'écran d'accueil :

- faire glisser une ligne de session et la déposer sur un autre projet ;
- le projet cible reçoit un anneau pendant le survol ;
- la ligne déplacée devient translucide ;
- le déplacement est envoyé au serveur via `session.move`, puis un toast confirme le résultat ;
- un événement `session.moved` met à jour le store client.

Règles :

- seuls les projets du **même serveur** acceptent le dépôt — les serveurs sont des stocks de sessions séparés ;
- le projet qui possède déjà la session n'est pas une cible valide ;
- un serveur injoignable n'accepte pas de dépôt ;
- annuler un glisser (Échap, dépôt hors cible) nettoie la surbrillance.

Le réordonnancement des projets utilise toujours **dnd-kit**. Seul le déplacement des sessions utilise l'API native HTML5 de drag-and-drop.

## Fonctionnement

### Côté interface

1. `beginHomeSessionDrag` stocke le payload dans une référence de module et écrit le type MIME personnalisé `application/x-opencode-home-session`.
2. Chaque ligne de projet accepte le dépôt via `homeSessionDrop`, qui vérifie le serveur, le projet courant et le type MIME.
3. Au dépôt, `onMoveSession` appelle le contrôleur des sessions de l'accueil.
4. Le contrôleur synchronise la session dans le store client, appelle `session.move`, puis affiche le toast de succès ou d'échec.

Le type MIME et la référence de module sont utilisés parce que la source et les cibles vivent dans la même fenêtre : le payload complet ne transite ni par le presse-papiers ni par le DOM.

### Côté serveur

```http
POST /api/session/:sessionID/move
Content-Type: application/json

{ "directory": "C:/OpenCode/SecondProject" }
```

Réponse : `204 No Content`, puis publication d'un événement `session.moved`.

La synchronisation avant la requête est importante : `session.moved` ne met à jour que les sessions déjà présentes dans le store client. Sans elle, une session issue de l'index de l'accueil pourrait ne pas se rafraîchir.

Si la session est en cours d'exécution, le serveur met le déplacement en file derrière l'étape en cours. Le toast confirme que la requête a été acceptée ; l'interface se met à jour quand `session.moved` est appliqué.

Le toast de succès affiche « Session moved » / « Moved to &lt;projet&gt; ». En cas d'échec, la chaîne existante `session.location.moveFailed` est réutilisée avec le message d'erreur du serveur.

## Fichiers modifiés

Chemins relatifs au dépôt OpenCode. La branche propre modifie 11 fichiers :

| Fichier | Rôle |
| --- | --- |
| `packages/app/src/home/sessions/drag.ts` | Type MIME, payload transitoire, règles d'acceptation du dépôt |
| `packages/app/src/home/sessions/view.tsx` | Source du drag, opacité pendant le déplacement, nettoyage sur `dragend` |
| `packages/app/src/home/projects/view.tsx` | Cible de dépôt par projet, surbrillance, appel de `onMoveSession` |
| `packages/app/src/home/projects/region.tsx` | Transmission de `onMoveSession` |
| `packages/app/src/home/route.tsx` | Branchement de `sessions.session.move` pour les dispositions mobile et desktop |
| `packages/app/src/home/sessions/controller.tsx` | Synchronisation, `session.move`, toasts de succès et d'échec |
| `packages/app/src/home/projects/view.css` | Anneau visuel de la cible de dépôt |
| `packages/app/src/runtime/i18n/en.ts` | Chaînes anglaises des toasts |
| `packages/app/e2e/regression/home.spec.ts` | Couverture e2e du déplacement |
| `packages/app/e2e/utils/mock-server.ts` | Mock de `session.move`, mise à jour de l'inventaire, événement `session.moved` |
| `packages/app/e2e/utils/mock-api.ts` | Déclaration de l'endpoint mock |

Les nouvelles chaînes i18n sont uniquement en anglais. Les autres locales retombent sur l'anglais tant que les traductions ne sont pas fournies.

## État amont

OpenCode exige une feature request et une validation de design avant toute PR d'implémentation (`CONTRIBUTING.md`). Le code est prêt, mais **aucune PR n'a été ouverte**.

La possibilité de déplacer une session entre projets a déjà été demandée :

- [#24708](https://github.com/anomalyco/opencode/issues/24708) — « move a session », fermée comme doublon de #23249 ;
- [#23249](https://github.com/anomalyco/opencode/issues/23249) — dialogue de migration de session, fermée par le bot de nettoyage ;
- [#21400](https://github.com/anomalyco/opencode/issues/21400) — déplacer/cloner une session dans un autre projet, fermée par le bot de nettoyage.

Aucune de ces demandes ne proposait le **glisser-déposer sur l'écran d'accueil**, et l'API serveur `session.move` n'existait pas lorsqu'elles ont été fermées. La nouvelle feature request doit le dire explicitement, renvoyer vers ces anciennes issues et demander une validation de design.

Les sons de notification sont un sujet séparé. Issues existantes :

- [#41355](https://github.com/anomalyco/opencode/issues/41355) — sons de notification/erreur configurables ;
- [#49371](https://github.com/anomalyco/opencode/issues/49371) — son quand l'agent pose une question.

Ne pas ouvrir de nouvelle issue générique sur les sons.

## Construire et installer le patch 2.1.4

> Cette section concerne le build desktop patché local. Elle ne fait pas partie de la PR amont.

### Prérequis

- Windows 10/11 ;
- [Bun](https://bun.sh) ;
- Node.js ;
- OpenCode Desktop **2.1.4** installé à l'emplacement par défaut :
  `%LOCALAPPDATA%\Programs\@opencodedesktop\resources`.

Les scripts ciblent ce chemin Windows. `apply-desktop-patch.mjs` accepte `--resources <dossier>` pour une installation déplacée.

### Récupérer les sources

Le dépôt ne versionne pas `opencode/`. Pour reconstruire le renderer :

```powershell
git clone https://github.com/sst/opencode
cd opencode
git checkout 68bc26b
git apply ..\patches\opencode-2.1.4.patch
bun install
```

Le patch est généré depuis la révision `68bc26b` (« release: v2.1.4 »).

### Reconstruire le renderer

`electron-vite` utilise le canal `dev` par défaut. Pour correspondre à l'application installée, forcer le canal et la version :

```powershell
cd opencode/packages/desktop
$env:OPENCODE_CHANNEL = "prod"
$env:OPENCODE_VERSION = "2.1.4"
bun x electron-vite build
```

Sortie : `opencode/packages/desktop/out/renderer`. Les source maps sont générées mais exclues du patch.

### Générer le patch

```powershell
# depuis la racine du dépôt
node patch-desktop-app.mjs
```

Le script :

1. lit l'`app.asar` installé ;
2. l'extrait ;
3. remplace `out/renderer` par le build ;
4. ré-emballe l'archive en conservant les drapeaux `unpacked` ;
5. vérifie que tous les fichiers hors renderer sont identiques octet pour octet ;
6. vérifie que chaque fichier renderer correspond au build ;
7. écrit `patch/app.asar.patched` et `patch/manifest.json`.

> Partir de l'archive **d'origine** installée. Si le patch est déjà appliqué, restaurer l'original avec `--revert` (ou réinstaller 2.1.4) avant de régénérer.

### Fermer OpenCode complètement

`close-opencode.ps1` ferme toutes les fenêtres et tous les processus `OpenCode.exe` de l'installation, y compris l'instance dans la zone de notification :

```powershell
.\close-opencode.ps1
```

Options : `-GraceSeconds <secondes>`, `-WhatIf`, `-InstallRoot <dossier>`.

Le script ne touche pas au service d'arrière-plan `opencode-cli.exe` et ne relance jamais l'application.

### Appliquer le patch

```powershell
node apply-desktop-patch.mjs --check
node apply-desktop-patch.mjs
```

`--check` ne modifie rien. L'application du patch :

1. vérifie que l'archive installée est bien l'originale 2.1.4 et que le patch correspond au manifeste ;
2. sauvegarde l'archive actuelle dans `patch/backup/` ;
3. copie le patch dans un fichier temporaire et vérifie son empreinte ;
4. remplace uniquement `app.asar` ;
5. vérifie l'archive installée ;
6. restaure automatiquement l'archive précédente en cas d'échec.

`app.asar.unpacked` n'est jamais modifié. Le script vérifie que chaque entrée `unpacked` référencée par l'archive existe avant de remplacer quoi que ce soit.

Une fois le script terminé, **lancer OpenCode vous-même**. Il ne démarre ni ne redémarre jamais l'application.

### Restaurer l'archive d'origine

```powershell
node apply-desktop-patch.mjs --revert
```

Par défaut, la sauvegarde la plus récente de `patch/backup/` est utilisée. Pour en choisir une autre :

```powershell
node apply-desktop-patch.mjs --revert --backup "patch\backup\app.asar.2.1.4-original-<horodatage>.bak"
```

### Options

| Option | Effet |
| --- | --- |
| `--check` | Affiche l'état et vérifie le patch sans rien modifier |
| `--revert` | Restaure une archive d'origine depuis `patch/backup/` |
| `--backup <fichier>` | Choisit explicitement la sauvegarde à restaurer |
| `--resources <dossier>` | Cible un autre dossier `resources` |
| `--ignore-running` | Ignore la détection de processus ; autorisé uniquement avec un `--resources` autre que l'installation réelle |
| `--force` | Passe outre les vérifications d'empreinte ; réservé à la récupération |

## Vérifications

Depuis `opencode/packages/app` sauf indication contraire :

```powershell
# depuis la racine du dépôt
bun run check

# depuis packages/app
bun typecheck
bun run typecheck:tsc

$env:PLAYWRIGHT_PORT = "4310"
bun run test:e2e:built -- e2e/regression/home.spec.ts --retries=0
```

Résultats du 25/10/2026 pour la branche propre `session-drag-drop` basée sur `origin/dev` :

| Vérification | Résultat |
| --- | --- |
| `bun run check` (racine) | 0 erreur |
| `bun typecheck` (app) | aucune erreur de type |
| `bun run typecheck:tsc` (app) | réussi |
| e2e `home.spec.ts` (build) | 12/12 réussis |

`bun run typecheck:e2e` signale encore des erreurs préexistantes dans les specs de performance et de timeline, sans rapport avec ce changement.

## Limites connues

- **Desktop d'abord** : le glisser-déposer HTML5 n'est pas fiable au doigt. La disposition mobile de l'accueil n'est pas la cible.
- **Même serveur uniquement** : le déplacement entre serveurs n'est pas pris en charge.
- **Même fenêtre uniquement** : le payload utilise une référence de module, pas le presse-papiers.
- **Toast en anglais** pour les locales sans traduction.
- **Session en cours d'exécution** : le serveur met le déplacement en file derrière l'étape en cours ; le toast ne garantit pas que le déplacement est déjà appliqué.
- **Réordonnancement des projets** : toujours géré par dnd-kit, indépendamment de ce patch.

## Contenu du dépôt

- `patches/opencode-2.1.4.patch` — patch local complet pour OpenCode 2.1.4 (glisser-déposer plus l'expérimentation de sons, différée).
- `opencode/` et `patch/` — générés localement et ignorés par Git.
- Le patch cible OpenCode Desktop **2.1.4**, canal `prod`.
- L'installation réelle n'est modifiée qu'au moment où `apply-desktop-patch.mjs` est exécuté sans `--check` ni `--revert`.
- Les sauvegardes de `patch/backup/` sont à conserver tant que l'application est patchée : ce sont elles que `--revert` utilise.

## Différé : sons de notification

Le patch 2.1.4 contient aussi une couche expérimentale de sons de notification. Elle ne fait **pas** partie de la PR amont sur le glisser-déposer.

- #41355 couvre les sons de notification/erreur configurables.
- #49371 couvre le son quand l'agent pose une question.
- Le patch actuel ne joue pas de son sur `question.asked` ; il ajoute seulement un son aux toasts d'échec du dock de question. Ne pas affirmer que #49371 est corrigé.

## Version anglaise

[README.md](README.md)
