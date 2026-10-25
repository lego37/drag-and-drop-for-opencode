# OpenCode Tweaks — glisser-déposer et sons de notifications

Patch pour **OpenCode Desktop 2.1.4** qui ajoute deux choses :

- déplacer une session vers un autre projet depuis l'écran d'accueil, par glisser-déposer ;
- des sons distincts pour les notifications, y compris celles qui étaient silencieuses.

Ce dépôt contient les scripts de construction/installation et le patch source. Il ne contient ni l'arbre OpenCode complet ni l'archive `app.asar` générée : ils sont reconstruits localement à partir d'OpenCode 2.1.4.

```
opencode/  ──build──▶  out/renderer  ──patch-desktop-app.mjs──▶  patch/app.asar.patched
                                                                        │
installation actuelle  ──────────────────apply-desktop-patch.mjs────────┘
```

## Fonctionnalité

Depuis l'écran d'accueil d'OpenCode :

- saisir une ligne de session et la déposer sur un autre projet ;
- le projet cible est mis en évidence pendant le survol ;
- la ligne en cours de déplacement est atténuée ;
- le déplacement est effectué côté serveur via `session.move`, puis un toast confirme le résultat ;
- un son de confirmation dédié est joué au succès, sélectionnable dans **Paramètres › Notifications › Effets sonores** ;
- tous les autres toasts peuvent jouer un son général, avec des réglages indépendants par famille de toasts.

Règles appliquées :

- la cible doit appartenir au **même serveur** que la session — les serveurs sont des stocks de sessions séparés ;
- le projet qui possède déjà la session n'est pas une cible valide ;
- un serveur hors ligne n'accepte pas de dépôt ;
- un glisser-déposer annulé (Échap, dépôt hors cible) nettoie correctement la surbrillance.

Le réordonnancement des projets continue d'utiliser **dnd-kit**. Seul le déplacement des sessions utilise l'API native HTML5 de drag-and-drop.

## Pourquoi des sons ?

Un son distinct par famille de toasts — et un son là où il n'y en avait pas — permet de savoir quelle notification vient de se produire sans regarder l'écran ni interrompre le travail en cours.

C'est particulièrement utile pour les notifications qui restaient silencieuses : quand une question est posée, le travail est interrompu et attend une interaction pour continuer. Le son le signale immédiatement, même si la fenêtre est en arrière-plan.

## Fonctionnement

### Côté interface

1. La ligne de session est `draggable`. Au début du glisser, `beginHomeSessionDrag` place le payload dans une référence de module et écrit le type MIME personnalisé `application/x-opencode-home-session`.
2. Chaque ligne de projet accepte le dépôt via `homeSessionDrop`, qui vérifie le serveur, le projet courant et la présence du type MIME.
3. Au dépôt, `onMoveSession` remonte jusqu'au contrôleur des sessions de l'accueil.
4. Le contrôleur synchronise d'abord la session dans le store client, puis appelle l'API de déplacement et affiche un toast.

Le type MIME et la référence de module sont utilisés parce que la source et les cibles vivent dans la même fenêtre : inutile de faire transiter l'état complet par le presse-papiers ou par le DOM.

### Côté serveur

```http
POST /api/session/:sessionID/move
Content-Type: application/json

{ "directory": "C:/OpenCode/SecondProject" }
```

Réponse : `204 No Content`, puis publication de l'événement `session.moved`.

La synchronisation préalable (`ctx.data.session.sync`) est importante : `session.moved` ne met à jour que les sessions déjà présentes dans le store client. Sans elle, une session provenant de l'index de l'accueil pourrait ne pas être rafraîchie.

Si la session est en cours d'exécution, le serveur met le déplacement en file derrière l'étape en cours. Le toast confirme l'acceptation de la requête ; l'interface se met à jour quand `session.moved` est appliqué.

Le succès affiche « Session moved » / « Moved to \<projet\> ». En cas d'échec, le toast existant `session.location.moveFailed` est réutilisé avec le message d'erreur du serveur.

Le son du déplacement est indépendant des sons **Agent**, **Permissions**, **Errors** et **Toasts**. Il possède sa propre ligne dans les effets sonores, avec le choix « None » pour le désactiver. Le réglage est enregistré avec les autres préférences locales. Le toast de succès du déplacement est marqué comme silencieux : le son dédié ne se superpose donc jamais au son général des toasts.

### Sons des toasts

La section **Paramètres › Notifications › Effets sonores** contient deux réglages :

- **Toasts** : active ou désactive le son général et choisit le son joué par défaut (par défaut : activé, « Bip-bop 01 ») ;
- **Sons individuels des toasts** : le bouton **Configurer** déplie une liste de familles de toasts, chacune avec son propre choix. Le bouton devient **Terminé** pour replier la liste.

| Famille | Toasts concernés |
| --- | --- |
| Sessions | export, suppression, renommage, copie, fork, arrêt |
| Projets | ouverture, révélation, rechargement, copie |
| Espaces de travail et fichiers | création de worktree, gestion des espaces, chargement de fichiers |
| Fournisseurs | connexion, déconnexion, changement de compte |
| Invites et composeur | envoi, file d'attente, chargement de pièces jointes, création de session |
| Requêtes et permissions | permissions, formulaires, annulation de changements |
| Serveurs | connexion et rechargement des données |
| Paramètres | réglages, raccourcis, notes de version |

Chaque famille propose « Utiliser le son général », « Aucun » ou un son précis :

- une famille laissée sur « Utiliser le son général » suit le réglage **Toasts** ;
- une famille avec un son précis joue ce son même si le son général est désactivé ;
- une famille sur « Aucun » reste silencieuse ;
- un toast sans famille explicite utilise le son général.

Le choix est enregistré dans les préférences locales, sous `sounds.toastEnabled`, `sounds.toast` et `sounds.toasts`. Les familles non configurées sont absentes de `sounds.toasts` et héritent donc du son général.


### Fichiers modifiés

Chemins relatifs à `opencode/` :

| Fichier | Rôle |
| --- | --- |
| `packages/app/src/home/sessions/drag.ts` | Type MIME, payload transitoire et règles d'acceptation du dépôt |
| `packages/app/src/home/sessions/view.tsx` | Source du drag, opacité pendant le déplacement, nettoyage sur `dragend` |
| `packages/app/src/home/projects/view.tsx` | Cible de dépôt par projet, surbrillance, appel de `onMoveSession` |
| `packages/app/src/home/projects/region.tsx` | Transmission de `onMoveSession` |
| `packages/app/src/home/route.tsx` | Branchement de `sessions.session.move` sur les dispositions mobile et desktop |
| `packages/app/src/home/sessions/controller.tsx` | Synchronisation préalable, appel de `session.move`, son dédié, toasts de succès et d'erreur |
| `packages/app/src/home/projects/view.css` | Anneau visuel de la cible de dépôt |
| `packages/app/src/settings/model.tsx` | Schéma, valeurs par défaut et accesseurs des sons « Session moved » et des toasts |
| `packages/app/src/settings/general/controllers.ts` | Canaux de réglage du son « Session moved », du son général et des familles de toasts |
| `packages/app/src/settings/notifications/notifications.tsx` | Lignes « Session moved », « Toasts » et « Sons individuels des toasts » |
| `packages/app/src/settings/search-catalog.ts` | Entrées de recherche des nouveaux réglages |
| `packages/app/src/runtime/i18n/en.ts` | Chaînes anglaises des toasts, des familles et des réglages de son |
| `packages/app/src/settings/model.test.ts` | Valeurs par défaut des nouveaux sons |
| `packages/app/src/shell/notifications/toast-sound.ts` | Familles de toasts et résolution du son (général, héritage, silence) |
| `packages/app/src/shell/notifications/toast-sound.test.ts` | Tests de la résolution et de l'héritage des sons de toasts |
| `packages/app/src/shell/notifications/toast.tsx` | Lecture des réglages, option `sound` par toast et lecture du son retenu |
| `packages/app/e2e/regression/home.spec.ts` | Test e2e du déplacement d'une session vers un autre projet |
| `packages/app/e2e/utils/mock-server.ts` | Implémentation mock de `session.move`, mise à jour de l'inventaire et émission de `session.moved` |
| `packages/app/e2e/utils/mock-api.ts` | Déclaration de l'endpoint mock `sessionMove` |

Les nouvelles chaînes i18n sont ajoutées uniquement en anglais. Les autres locales retombent sur l'anglais tant que les traductions ne sont pas fournies.

## Développement

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

### Prérequis

- Windows 10/11 ;
- [Bun](https://bun.sh) ;
- Node.js pour les scripts de patch à la racine ;
- OpenCode Desktop **2.1.4** installé à l'emplacement par défaut :
  `%LOCALAPPDATA%\Programs\@opencodedesktop\resources`.

Les scripts actuels ciblent cet emplacement Windows par défaut. `apply-desktop-patch.mjs` accepte `--resources <dossier>` pour une installation déplacée ; `patch-desktop-app.mjs` lit l'emplacement standard.

Installation des dépendances :

```powershell
cd opencode
bun install
```

### Vérifications

```powershell
# depuis opencode/packages/app
bun typecheck
bun run typecheck:tsc

# depuis opencode
bun script/lint-changed.ts v2.1.4

# depuis opencode/packages/app
$env:PLAYWRIGHT_PORT = "4310"
bun run test:e2e:built -- e2e/regression/home.spec.ts --retries=0
bun run test:e2e -- e2e/regression/settings.spec.ts e2e/regression/settings-search.spec.ts --retries=0
```

Le test e2e utilise le serveur mock et un build web local ; il ne touche pas à l'installation desktop.

Vérifications effectuées le 25/10/2026 :

| Vérification | Résultat |
| --- | --- |
| `bun typecheck` (app) | OK |
| `bun run typecheck:tsc` (app) | OK |
| Tests unitaires `settings/model.test.ts`, `settings/search-results.test.ts` et `shell/notifications/toast-sound.test.ts` | 39/39 tests réussis |
| `bun script/lint-changed.ts v2.1.4` | aucun problème |
| Suite e2e `home.spec.ts` | 12/12 tests réussis |
| Suites e2e `settings.spec.ts` et `settings-search.spec.ts` | 54/54 tests réussis |
| Patch ASAR | 1 727 fichiers renderer, octets non-renderer inchangés, 18 fichiers natifs `unpacked` préservés |

### Reconstruire le renderer

Le canal par défaut d'`electron-vite` est `dev`. Pour que le renderer construit ait la même identité que l'application installée, il faut forcer le canal et la version :

```powershell
cd opencode/packages/desktop
$env:OPENCODE_CHANNEL = "prod"
$env:OPENCODE_VERSION = "2.1.4"
bun x electron-vite build
```

La sortie est écrite dans `opencode/packages/desktop/out/renderer`. Les source maps sont générées mais exclues du patch.

### Générer le patch

```powershell
# depuis la racine du dossier glisser-déplacer
node patch-desktop-app.mjs
```

Le script :

1. lit l'`app.asar` installé ;
2. extrait son contenu ;
3. remplace `out/renderer` par le build ;
4. ré-emballe l'archive en conservant les drapeaux `unpacked` ;
5. vérifie que tous les fichiers hors renderer sont identiques octet pour octet ;
6. vérifie que chaque fichier renderer du patch correspond au build ;
7. écrit `patch/app.asar.patched` et `patch/manifest.json`.

> **Important** : `patch-desktop-app.mjs` part de l'archive **installée**. Il doit donc partir de l'archive d'origine. Si le patch est déjà appliqué, restaurez d'abord l'original avec `--revert` (ou réinstallez OpenCode 2.1.4) avant de régénérer.

Le manifeste contient les empreintes SHA-256 de l'archive d'origine et de l'archive patchée ; c'est lui qui fait foi, pas un hash recopié dans ce README.

### Fermer OpenCode complètement

`close-opencode.ps1` ferme toutes les fenêtres et tous les processus `OpenCode.exe` de l'installation, y compris une instance réduite dans la zone de notification :

```powershell
.\close-opencode.ps1
```

Ou double-cliquer `close-opencode.cmd`, qui lance PowerShell avec la stratégie d'exécution adaptée et laisse la fenêtre ouverte à la fin.

Le script demande une fermeture propre, attend 8 secondes, puis force l'arrêt des processus restants. Il vérifie ensuite qu'aucun `OpenCode.exe` de l'installation ne subsiste. Il ne touche pas au service d'arrière-plan `opencode-cli.exe` et ne relance jamais l'application.

Options : `-GraceSeconds <secondes>` pour le délai de fermeture propre, `-WhatIf` pour simuler sans fermer, `-InstallRoot <dossier>` pour une installation déplacée.

## Appliquer le patch

Fermez complètement OpenCode, y compris l'icône de la zone de notification (ou lancez `.\close-opencode.ps1`). Le script refuse de s'exécuter tant qu'un processus `OpenCode.exe` de cette installation est actif.

```powershell
# depuis la racine du dossier glisser-déplacer
node apply-desktop-patch.mjs --check
node apply-desktop-patch.mjs
```

`--check` ne modifie rien : il affiche l'état de l'archive installée, vérifie le patch et indique les processus actifs ainsi que la dernière sauvegarde.

Lors de l'application, le script :

1. vérifie que l'archive installée correspond bien à l'originale 2.1.4 et que le patch correspond au manifeste ;
2. sauvegarde l'archive actuelle dans `patch/backup/` ;
3. copie le patch dans un fichier temporaire et vérifie son empreinte ;
4. remplace uniquement `app.asar` ;
5. vérifie l'archive installée après le remplacement ;
6. restaure automatiquement l'ancienne archive en cas d'échec.

`app.asar.unpacked` n'est jamais modifié. Le script vérifie même que toutes les entrées `unpacked` référencées par l'archive sont présentes avant de faire le remplacement.

Une fois le script terminé, **lancez OpenCode vous-même**. Le script ne démarre ni ne redémarre jamais l'application.

Vérification rapide après relance :

1. ouvrir l'écran d'accueil ;
2. glisser une session sur un autre projet du même serveur ;
3. vérifier le toast « Session moved » et le déplacement de la ligne vers le nouveau projet ;
4. vérifier qu'un dépôt sur le projet d'origine ou sur un autre serveur est ignoré ;
5. ouvrir **Paramètres › Notifications › Effets sonores** et vérifier les lignes « Session moved » et « Toasts » ;
6. cliquer sur **Configurer** à côté de « Sons individuels des toasts » : les huit familles apparaissent, chacune sur « Utiliser le son général » ;
7. choisir un son pour une famille, déclencher un toast de cette famille, puis vérifier qu'il joue ce son ;
8. désactiver le son général et vérifier qu'un toast d'une famille sans dérogation devient silencieux, tandis qu'une famille avec un son explicite continue de jouer ;
9. vérifier qu'un déplacement de session ne joue pas le son général en plus du son « Session moved ».

## Restaurer l'archive d'origine

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
| `--resources <dossier>` | Cible un autre dossier `resources` qu'OpenCode |
| `--ignore-running` | Ignore la détection de processus ; autorisé uniquement avec un `--resources` autre que l'installation réelle |
| `--force` | Passe outre les vérifications d'empreinte ; à réserver aux cas de récupération |

## Garanties et sécurité

- **Seul `app.asar` est remplacé.** Le processus principal, le preload, le serveur et les fichiers natifs `app.asar.unpacked` ne sont pas touchés.
- **Sauvegarde automatique** avant tout remplacement, dans `patch/backup/`.
- **Vérification SHA-256** de l'archive installée, du patch, de la copie temporaire et du résultat final.
- **Retour arrière automatique** si le remplacement ou la vérification échoue.
- **Aucun lancement ni redémarrage** de l'application par les scripts.
- **Refus si OpenCode tourne**, avec la liste des PID concernés.

L'archive 2.1.4 installée a ses fuses Electron `EnableEmbeddedAsarIntegrityValidation` et `OnlyLoadAppFromAsar` désactivés, ce qui permet de reconditionner `app.asar`. Si une future version active ces fuses, l'archive remplacée pourra être rejetée au démarrage : il faudra alors reconstruire l'application ou patcher le binaire Electron, et non simplement remplacer l'ASAR.

Les mises à jour automatiques d'OpenCode remplacent `app.asar`. Après une mise à jour, le patch disparaît et `apply-desktop-patch.mjs` refuse de s'appliquer (empreinte inconnue). Il faut reconstruire le patch depuis les sources de la nouvelle version ; ne pas forcer l'ancien patch sur une version différente.

## Dépannage

| Message / symptôme | Cause probable et solution |
| --- | --- |
| `OpenCode is still running (...)` | Fermer toutes les fenêtres et l'icône de notification, puis relancer `--check` |
| `Cannot replace ... (EPERM/EACCES/EBUSY)` | Processus encore actif, antivirus ou fichier verrouillé ; fermer OpenCode et réessayer |
| `Installed archive is neither the original ... nor the patch` | OpenCode a été mis à jour ou l'archive a changé ; régénérer le patch pour cette version |
| `Missing unpacked payload: ...` | `app.asar.unpacked` est incomplet ; réinstaller OpenCode 2.1.4 |
| `Could not query running OpenCode processes` | PowerShell n'a pas pu lister les processus ; fermer OpenCode puis réessayer, ou vérifier avec `--check` |
| `patched archive: sha256 ... does not match` | Le fichier `patch/app.asar.patched` est corrompu ou incomplet ; régénérer le patch |
| `A previous swap left ... app.asar.pre-patch` | Une exécution précédente a été interrompue ; restaurer ou supprimer ce fichier avant de réessayer |
| La fonctionnalité n'apparaît pas après relance | Vérifier `--check`, l'emplacement de l'installation et qu'aucune mise à jour n'a remplacé `app.asar` |
| `No OpenCode processes` alors que l'application est ouverte | L'installation n'est pas à l'emplacement par défaut ; utiliser `--resources` |

## Limites connues

- **Desktop avant tout** : le glisser-déposer HTML5 n'est pas fiable au doigt. L'interface mobile de l'accueil n'est pas la cible de cette fonctionnalité.
- **Même serveur uniquement** : un déplacement inter-serveurs n'est pas pris en charge.
- **Même fenêtre uniquement** : le payload transite par une référence de module, pas par le presse-papiers.
- **Toast en anglais** pour les locales non traduites.
- **Session en cours d'exécution** : le déplacement est accepté puis appliqué par le serveur à la fin de l'étape en cours ; le toast ne garantit pas que le déplacement est déjà effectif.
- **Réordonnancement des projets** : toujours géré par dnd-kit, indépendamment de ce patch.

## État du dépôt

- `patches/opencode-2.1.4.patch` contient les modifications source complètes pour OpenCode 2.1.4.
- `opencode/` et `patch/` sont générés localement et ignorés par Git.
- Le patch est construit pour OpenCode Desktop **2.1.4**, canal `prod`.
- L'installation réelle n'est modifiée qu'au moment où `apply-desktop-patch.mjs` est exécuté sans `--check` ni `--revert`.
- Les sauvegardes de `patch/backup/` sont à conserver tant que l'application est patchée : elles sont la source de `--revert`.
