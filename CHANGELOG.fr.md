# Journal des modifications

> [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [日本語](CHANGELOG.ja.md) · [한국어](CHANGELOG.ko.md)

Tous les changements notables sont consignés dans ce fichier. Le projet suit le versionnement sémantique après `0.1.0`.

## 0.8.0-beta.1 - 2026-09-30

### Modifié

- Ligne de compatibilité Harness 0.2.0 : les 23 plages de peers `@deepseek-ai/dsh-*` passent à
  `>=0.2.0-rc.1 <0.2.1-0`, et `engines.dsh` suit dans les trois manifestes (racine,
  package sélecteur, manifeste du plugin). `publishConfig.tag` devient `dsh-0.2.0` ; la ligne 0.1.7
  reste servie depuis `dsh-0.1.7` (désormais `0.7.0-beta.1`), les lignes 0.1.5/0.1.2 depuis
  leurs propres dist-tags.
- 39 des 41 overrides épinglés et 46 des 48 dev-dependencies passent à `0.2.0-rc.1` ;
  `@deepseek-ai/dsh-agent-presets` (`0.1.6-alpha.2`) et `@deepseek-ai/dsh-code-runtime`
  (`0.1.5-rc.3`) conservent leur épinglage — aucun des deux packages n'a de version sur la ligne 0.2.0.
- Portes de mise en version reciblées : l'épinglage harness de l'e2e d'installation empaquetée
  checkout désormais l'arbre officiel `dsh-v0.2.0-rc.1` (`4878cdab`), et le test de contrat
  des artefacts construits vérifie le slot client `configForms` (renommé depuis `settingsScope`
  sur la ligne 0.1.7).

## 0.6.5 - 2026-09-29

### Corrigé

- Alignement des dev-dependencies sur la ligne Harness 0.1.7 : 46 des 48 `@deepseek-ai/dsh-*`
  passent de l'épinglage précis `0.1.5-rc.2` à l'épinglage précis `0.1.7-rc.2`,
  et `pnpm-lock.yaml` a été régénéré depuis un arbre propre. Typecheck, build, tests, lint et
  `verify:release` s'exécutent désormais contre la véritable base 0.1.7-rc.2 au lieu de valider
  les adaptations 0.1.7 avec des entrées 0.1.5 (un vert trompeur). Deux packages n'ont aucune
  version sur la ligne 0.1.7 et conservent leurs valeurs épinglées à l'installation :
  `@deepseek-ai/dsh-agent-presets` (`0.1.6-alpha.2`) et `@deepseek-ai/dsh-code-runtime`
  (`0.1.5-rc.3`). `react-dom` gagne une dev-dependency explicite `^18.2.0` afin qu'une résolution
  propre ne puisse pas associer React-DOM 19 à React 18 sous les suites de tests.
- La couture de réglages de l'hôte de test a été reconstruite contre le véritable hôte 0.1.7 :
  `SettingsProvider` n'existe plus dans `@deepseek-ai/dsh-settings` (remplacé par les
  `SettingsForms` déclaratifs), tandis que le plugin conserve la lecture héritée
  `ctx.settings.get(ns)` comme repli à la forme de l'hôte. Les specs montent désormais une copie
  embarquée du provider 0.1.5-rc.2 (`tests/helpers/legacy-settings/`) pour exercer exactement ce
  repli, et le registrar des espaces de noms hérités resserre le service à la couture. Le test
  live du harness DeepSeek enregistre le provider via la couture d'adaptateur 0.1.7 au lieu du
  plugin autonome `llm-deepseek` supprimé.
- Adaptations de tests révélées par la véritable base : les fixtures du moteur de compaction
  passent `headroomTokens: 0` (0.1.7-rc.2 fixe par défaut un headroom de compaction de 65 536
  tokens, qui avale les fenêtres de sondes de 1k tokens des fixtures), et l'assertion d'actifs
  de résultats d'outils suit la forme de message de premier ordre `role: 'tool'` (plus de bloc
  de contenu enveloppant `tool-result`).
- Portes de mise en version ré-épinglées à la version officielle 0.1.7 : `verify-release.mjs` et
  l'e2e empaqueté vérifient désormais des peers sélecteur `>=0.1.7-rc.1 <0.2.0-0`, et l'e2e
  empaqueté clone le harness officiel en vérifiant le tag `dsh-v0.1.7-rc.2` (commit `477b4f42`,
  arbre `e3e63253`).
- `packages/selector/dsh.plugin.json` porte désormais la version de mise en version (0.6.5 ;
  chaque 0.6.x antérieur la publiait figée à 0.1.0) et déclare la plage honnête du moteur
  `>=0.1.7-rc.1 <0.2.0-0`.
- La dette de lint issue des adaptations manuelles 0.6.3 est soldée : imports/locaux inutilisés
  supprimés dans `src/index.ts`, `src/client/index.ts`, `src/pruner.ts` et trois specs d'hôte ;
  le balayage des restants de staging de la génération courante est désormais limité au magasin
  propre à la spec, de sorte qu'une spec publiant concurremment ne puisse pas le faire échouer.

## 0.6.4 - 2026-09-26

### Corrigé

- Le lieur de locale du client est eager : changer la locale de l'hôte re-rend désormais
  l'interface de réglages de compression sans remontage.
- Publiée depuis un stash et jamais committée sur aucune branche (l'arbre de travail qui l'a
  publiée a été perdu) ; compat/0.1.7 a restauré le contenu exact en 0.6.5 et l'a vérifié octet
  par octet contre le tarball du registre avant de continuer.

## 0.5.4 - 2026-09-20

### Corrigé

- La surface d'installation déclare `@deepseek-ai/schemastery` comme dépendance d'exécution. Le
  runtime empaqueté l'importe sans condition (`import z from '@deepseek-ai/schemastery'` dans
  `packages/selector/lib/index.js`, `lib/pruner.js` et `lib/advisor-state.js`), mais 0.5.3 ne le
  déclarait nulle part qu'une installation consommatrice puisse lire : le manifeste racine livré
  ne listait que `@huggingface/tokenizers` et `js-yaml`, et `packages/selector/package.json` le
  déclarait comme peer, ce qu'aucun gestionnaire de paquets ne consulte pour un package imbriqué
  qu'il installe. La résolution dépendait donc d'un package installé sans rapport qui hisse
  `@deepseek-ai/schemastery` dans le profil. Dans une installation propre, l'import retombait sur
  le repli de module partagé de l'installation Harness à `$DSH_HOME/profiles/node_modules` ;
  lorsque ce repli ne contenait aucun package construit, chaque entrée de plugin échouait à se
  charger et l'hôte démarrait sans la couche Bundle. Les deux manifestes épinglent désormais
  `3.18.2`, la version contre laquelle cette mise en version est construite et testée, et le
  package sélecteur ne revendique plus une obligation de peer qu'il n'a pas.

### Ajouté

- `verify:release` dérive les dépendances de la surface d'installation des spécificateurs nus
  importés par les fichiers du runtime empaqueté, au lieu de nommer `@huggingface/tokenizers` et
  `js-yaml` à la main. Quels packages sont livrés avec le plugin et lesquels sont fournis par
  l'installation Harness est une liste revue, et un import dont le fournisseur ne figure dans
  aucun manifeste fait échouer la porte avec le nom manquant. La porte a été ajoutée comme
  contrôle négatif contre les manifestes non corrigés, où elle échouait sur
  `@deepseek-ai/schemastery`.

## 0.5.3 - 2026-09-20

### Corrigé

- Le patch Bundle ne définit plus le drapeau de route de revue retiré. `reviewQueueRoute` avait
  été retiré du schéma Config du plugin lorsque la porte de revue avait été retirée, mais il
  restait dans `packages/selector/cordis.patch.yml`, où il annonçait une route qui ne peut jamais
  s'enregistrer. Les hôtes tolèrent aujourd'hui la clé inconnue (le plugin se charge et sert —
  vérifié sur un hôte réel), c'est donc un défaut de configuration périmée plutôt qu'une rupture,
  mais cela casserait sur tout hôte qui valide strictement la configuration des plugins.
- Les artefacts générés sont épinglés à LF (`packages/selector/lib/** text eol=lf`). Avec
  `core.autocrlf=true`, chaque checkout réécrivait les `lib/**` committés en CRLF, si bien que
  tout changement de branche ou merge laissait tout le répertoire d'artefacts signalé comme
  modifié avec des différences de fins de ligne uniquement. Rien n'a jamais été committé depuis
  cet état, mais cela donnait à chaque arbre un aspect sale et cela pouvait masquer un véritable
  changement d'artefact.

### Ajouté

- Une épingle de contrat à contrôle négatif sur le patch Bundle : il échoue lorsqu'une clé de
  configuration retirée est définie dans le patch (vérifié sur les lignes de définition de clés,
  si bien que le commentaire explicatif peut encore nommer la clé), et il exige que le drapeau
  `estimatorCatalogRoute` actif reste câblé.

### Tests

- Le contrat de siège client épingle également la dégradation sur hôte plus ancien : un hôte qui
  ne déclare pas le siège rejette l'enregistrement à la frontière du slot, et `apply()` doit
  l'avaler et avertir au lieu d'entraîner toutes les entrées de réglages dans sa chute.

## 0.5.2 - 2026-09-20

### Modifié

- Le pipeline de revue à porte humaine (beta) est **retiré**. Sa sémantique est remplacée par le
  conseil : le modèle de bénéfice tarifie toujours chaque passe comme UNE mutation fusionnée,
  mais la bande qu'il calcule (`profitable` / `high-impact` / `slow-payback` / `unpriceable` /
  `not-worth-it`) est désormais publiée comme enregistrement d'audit `reduction-advice` et
  snapshotée sur la route de rapport du conseiller — il ne retient, ne retarde ni ne réécrit
  jamais une réduction. La porte contredisait l'exigence même de la fonction (une réduction ne
  doit jamais bloquer le traitement automatique) et, avec les valeurs livrées (`reviewMode`
  activé plus un seuil high-impact de 4 000 tokens contre un déclencheur fresh de 8 192 tokens),
  détournait 100 % d'un lot frais vers la revue humaine, laissant le chemin automatique en
  pratique désactivé pour quiconque l'avait activé. Les seuils de conseil sont désormais des
  constantes de module (α `0.1`, high-impact `4 000` tokens) : rien n'agit sur eux, ils ne sont
  donc plus des réglages.
- Retirés avec la porte : la file de revue et son adaptateur `storageDomain`, le registre à
  l'échelle du processus, les routes HTTP `review-queue` / `review-decide` et le drapeau de
  déploiement `reviewQueueRoute`, le panneau client `shell.overlay`, les clés de réglages
  `reviewMode` / `reviewTimeoutTurns` / `cacheHitDiscountAlpha` / `reviewHighImpactTokens`,
  et le type d'audit `review-outcome`. Les quatre clés de réglages restent ACCEPTÉES et
  IGNORÉES par les deux décodeurs — un document existant (celui en production porte
  `reviewMode: false`) se charge toujours et rend toujours sa carte de réglages — et
  n'atteignent jamais la politique résolue. La route en lecture seule `GET .../advisor-report`
  sert en outre `lastAdvice`.

### Ajouté

- Épingles de régression pour le retrait : une spec d'intégration hôte pilote exactement les
  réglages qui détournaient tout (`reviewMode: true`, `reviewHighImpactTokens: 1`) et vérifie
  que le lot frais ATERRIT, décrit par un enregistrement de conseil `high-impact` ; une spec de
  contrat de dépréciation épingle accepte-et-ignore pour les clés retirées à la fois sur
  l'analyseur runtime et le décodeur navigateur.

### Retour arrière

- Réinstallez la dernière version qui livre encore la porte : `npm dist-tag add
  dsh-context-compression-improved@0.5.1 dsh-0.1.5 --registry https://registry.npmjs.org/`
  puis `dsh plugin --profile web add dsh-context-compression-improved@0.5.1`.

## 0.5.1 - 2026-09-20

### Corrigé

- La composition concurrente d'overlay de preset d'une même identité n'échoue plus sous Windows.
  La publication est désormais sérialisée par chemin de destination, et lorsque le renommage
  atomique perd encore la course, la destination est confirmée comme portant déjà la clé
  permanente `{mtimeMs, size}` du fichier de staging avant que la publication ne signale le
  succès. Windows `MoveFileEx` signale cette course perdue comme `EPERM`/`EBUSY` là où le
  `rename` POSIX remplace simplement la destination, ce qui faisait lever `standingKeyFor()` au
  démarrage de sessions concurrentes. Une destination qui ne correspond pas échoue toujours
  bruyamment, de sorte qu'une génération silencieusement réutilisée reste interdite.
- Réparations de portes de mise en version et de tests qui masquaient ceci et d'autres portes
  rouges préexistantes : identifiants périmés et une raison d'audit retirée dans les smokes
  empaquetés, une attente d'injection client périmée, et des pièges de spawn propres à Windows
  (`git` et les scripts `node -e` multi-lignes étaient routés via `cmd.exe`, qui réécrivait
  leurs arguments).

## 0.5.0 - 2026-09-20

### Ajouté

- Conseiller de pertinence consultatif (statistiques et suggestions uniquement, désactivé par
  défaut) : à chaque frontière de tour, une passe fire-and-forget résume la sémantique de la
  tâche de queue de la session à partir de l'événement `todo/write` le plus récent (avec repli
  sur le texte utilisateur récent), note de façon incrémentale les candidats historiques de
  résultats d'outils pour la pertinence contenu-commentaires par rapport à la tâche courante,
  et calcule un chiffre de décroissance de préfixe (moyenne de pertinence pondérée par la
  pression de caractères). Les anciens segments de faible pertinence sont marqués
  `recertified` comme suggestions pour de futures décisions d'agressivité d'historique — rien
  ne les consomme à ce stade, et la sortie du conseiller ne peut jamais supprimer, retarder ni
  réécrire une réduction qui doit s'appliquer (épinglé par un test d'invariant dédié).
  Configuration via les clés de réglages `presetOptions.advisor*` (`advisorMode`
  `''|'host'|'direct'`, par défaut `''` ; le canal direct réutilise l'endpoint de l'estimateur ;
  `SideChannel` a gagné un paramètre facultatif d'overrides afin que le transport de
  l'estimateur soit partagé sans partager sa configuration). Observabilité : nouveaux
  enregistrements d'audit `advisor-outcome` (sans contenu, un par phase : summary / scoring /
  decay) et une route HTTP en lecture seule `GET .../advisor-report?sessionId=` (drapeau de
  déploiement facultatif `advisorReportRoute`, à l'image des routes de revue). L'interface
  client est volontairement absente à ce stade.

## 0.4.0 - 2026-09-20

### Corrigé

- Le plugin ne dépend plus de l'identifiant de modèle routé : chaque porte de planification
  décide désormais sur la base de caractères (points de code Unicode via `characterPressure` /
  `pressureCost`) au lieu de comptages de tokenizer exacts, de sorte qu'une route sans tokenizer
  fourni (le `deepseek-flash` en production) applique à nouveau les réécritures au lieu de les
  ignorer silencieusement. Les seuils de tokens conservent leurs noms et valeurs (convertis
  selon la convention documentée 4.0 chars/token, baseline de profil figée intacte) ; les
  chiffres de tokens deviennent de la télémétrie, étiquetés honnêtement par le nouveau champ
  `measurementBasis` sur les enregistrements d'audit de réécriture (`exact-tokenizer` vs
  `characters`, avec `tokenizerId: 'characters'` / `tokenizerRevision: 'chars-per-token-4.0'`
  en cas de dérivation). Retour arrière : `git revert 7a1972a` restaure les portes à tokenizer
  exact comme une unité unique ; confirmez d'abord qu'aucun changement ultérieur n'a
  réintroduit une séparation par identifiant de modèle qui dépendrait de ce commit.

### Ajouté

- Tarification du bénéfice au niveau du lot (R1) : une passe de revue est tarifée comme UNE
  mutation fusionnée — la pénalité de remplissage du KV-cache de queue est payée une fois par
  lot au lieu de par candidat, de sorte que de vrais lots (5×50k avec une queue de 64k)
  atteignent la bande automatique au lieu de tous tomber.
- Correspondance de lignes d'événements originaux (R9a) : la normalisation terminale renvoie des
  lignes pliées portant chacune leur numéro de ligne d'événement original en base 1 ;
  `retrieve` lit les événements bruts, donc les plages imprimées se résolvent vers les bonnes lignes.
- Squelette de document et conservation universelle de la prose (R8/R8b) : les documents
  structurés conservent titres, premières/dernières lignes de section, débuts de listes et
  en-têtes de tableaux ; tout autre texte hors code conserve la tête ET la queue avec un
  marqueur de plage de lignes R9 (la prose n'était auparavant tronquée qu'en tête).
- Pliage de recherche à deux niveaux (R10, corrige D8) : un localisateur L1 sans perte par
  fichier plus un quota de contenu L2 à remplissage d'eau.
- Pliage de fréquence non adjacente (R11) : les répétitions exactes séparées (jusqu'à 8,37 % des
  grands résultats) se plient vers la première occurrence plus un marqueur compté.
- Placeholders de longues chaînes (R12) : les blobs base64/hex/UUID deviennent des résumés de
  longueur avec un préfixe de reconnaissance de 16 caractères.
- Réduction HTML en deux étapes (R13, corrige D9) : `html-slim` puis `html-skeleton`, alignés
  par lignes afin que les numéros de lignes originaux survivent.
- Ancrages R9b : les masques contigus citent les plages de lignes originales, les masques
  dispersés rapportent `lines 1-N scanned, K kept`, et chaque indice de retrieve porte un
  `{"ref":…,"start_line":N,"max_lines":80}` collable.
- Recensement de documents : les résumés de documents omis listent les titres de section au lieu
  d'un histogramme constant `0 error, 0 warn, N info`.

## 0.3.1 - 2026-09-18

### Modifié

- Le package runtime est fusionné dans le package sélecteur : une installation apporte toute la
  pile, la racine du dépôt est la surface d'installation (`name`, `main`, `types`, `exports`
  avec `./pruner` et `./invariant`, `dependencies`, `dsh`), et la chaîne d'outils, les scripts
  et la CI ont été balayés vers le package unique. L'enregistrement vérifié du catalogue
  d'estimateurs (double préfixe, activation à deux canaux protégée, résolution de service par
  requête, lignes de cycle de vie visibles) a été rejoué sur cette ligne avec une garde côté
  hôte ; le schéma de réglages que `ab2175a` avait rétrogradé en `z.any()` est restauré, de
  sorte que les valeurs Custom par défaut quotidiennes sont de nouveau publiées.
- Adaptation au DeepSeek Harness officiel `v0.1.5-rc.2` sur cette branche. Toutes les dev
  dependencies `@deepseek-ai/dsh-*` et l'ensemble épinglé d'hôtes e2e passent de `0.1.1-rc.2` à
  `0.1.5-rc.2` (cordis `4.0.2`, schemastery `3.18.2`), y compris les nouveaux packages scindés
  (`dsh-session-projection`, `dsh-session-persistence`, `dsh-atomic-write`, `dsh-home-paths`,
  `dsh-sandbox` et apparentés) et la pile client `dsh-client-store`.
- Les opérations de remplacement de surface utilisent désormais la forme v3
  `startSeq`/`endSeq` avec des valeurs `SessionSeq` brandées ; les manifestes
  `compaction/prune` conservent les champs durables `start`/`end`. Les événements sont résolus
  depuis les nœuds de surface par recherche de seq au lieu d'un indexage de tableau.
- Le bundle client n'importe plus le `@deepseek-ai/dsh-client-runtime` supprimé : les types de
  réglages proviennent désormais de `@deepseek-ai/dsh-client-ui-settings` et les hooks de
  session de `@deepseek-ai/dsh-client-ui-session`. `engines.dsh >=0.1.5-alpha.1 <0.2.0-0` est
  déclaré dans les deux manifestes de packages et dans `dsh.plugin.json`.
- Harness 0.1.5 n'expose plus l'`agentPreset` de session au navigateur, si bien que le client ne
  peut plus détecter les sessions Minimal-only ; le sélecteur reste sélectionnable et la vieille
  bannière d'indisponibilité est inatteignable.
- Batteries de tests mises à jour pour la sémantique 0.1.5 : le démarrage des plugins cordis
  exige `.await()`, le Token Meter exige un `SessionProjectionRegistry` monté, les événements
  assistant portent `stream: []`, et les espaces de noms de réglages sont de simples chaînes.

### Corrigé

- La carte d'estimateur n'exige plus de clé API sur le canal hôte du Harness. Choisir le canal
  hôte affiche les listes déroulantes live provider/modèle, nomme la route qui s'exécuterait
  réellement (surcharge explicite, sinon la valeur par défaut de session), et ne rend ni champ
  de clé ni second champ de modèle manuel : l'URL de base, le champ texte de modèle et la clé
  en écriture seule appartiennent au seul canal d'endpoint direct.
- Les écritures `presetOptions` sont adressées par chemin. Écrire toute la section la
  remplaçait, si bien que toucher un second champ d'estimateur (un provider, un modèle, un
  endpoint) supprimait `estimatorMode` et chaque override voisin — désactivant silencieusement
  l'estimateur alors que le panneau rapportait une sauvegarde réussie. Chaque champ n'écrit
  désormais que lui-même, `undefined` efface exactement le champ qu'il nomme, et la lecture de
  confirmation valide le même ensemble de champs au lieu du seul mode.
- Nouvelle couverture : `packages/selector/tests/preset-options-write.client.spec.ts` (écrites à
  portée de chemin, préservation des voisins, effacements explicites, patchs sans effet,
  rapport d'écritures non committées) et `packages/selector/tests/estimator-channel.client.spec.tsx`
  (champs par canal, listes déroulantes du catalogue, repli manuel).


### Ajouté

- Nouveau profil `tokenpilot-inspired` : une matrice de capacités inspirée du papier TokenPilot
  superposée aux seuils Balanced, sélectionnable explicitement depuis l'interface de réglages ;
  chaque profil préexistant conserve une politique résolue identique à l'octet près (imposée
  par un test golden à baseline capturée).
- Déduplication des résultats d'outils répétés à l'identique d'octet : un doublon
  surdimensionné est remplacé par un pointeur vers l'événement original en ajout seul de la
  première occurrence (`dedupe-pointer`), avec un index SHA-256 par session (éviction par ordre
  d'insertion de 2 048 entrées, métadonnées hash+seq uniquement).
- Garde de bénéfice net nul : les remplacements dont le texte n'est pas plus petit que
  l'original sont rejetés même lorsque le tokenizer exact rapporte un gain de tokens.
- Exemption de récupération : la sortie des outils de récupération est définitivement exemptée
  de chaque passe de réduction via un ensemble d'exemptions par session unifié, empêchant
  l'oscillation compression-restauration.
- Localisateur de résumé Auto Compact : après `compaction/end`, le checkpoint de résumé atterri
  gagne un bloc Exact Sources (plage de seq masquée, fichiers de débordement, fichiers touchés)
  afin que les détails résumés restent récupérables ; sauté s'il ne peut rien localiser de concret.
- Sémantique d'état de lecture : une lecture historique dont le fichier a ensuite été muté est
  `superseded` et prend le petit placeholder de résultat entier ; un regroupement facultatif
  erreur/warn/info des lignes omises est ajouté aux placeholders historiques.
- Estimateur d'utilité résiduelle facultatif (trois canaux : off / modèle hôte Harness /
  endpoint direct compatible OpenAI) avec backoff exponentiel par session, timeout strict,
  verdicts consultatifs consommés par la passe de pression suivante, et audits
  `estimator-outcome` numériques uniquement. La carte d'estimateur n'apparaît que lorsque le
  nouveau profil est sélectionné ; la clé API est en écriture seule dans les réglages et
  n'entre jamais dans la politique figée, les audits ou les journaux.
- Nouveaux enregistrements d'audit : `summary-locator` et `estimator-outcome` ; l'enregistrement
  de réécriture couvre la déduplication via le réducteur `dedupe-pointer`. Les listes blanches
  de champs d'audit sont inchangées.
- Textes en chinois simplifié et en anglais pour le nouveau profil et la carte d'estimateur ;
  couverture unitaire et golden sous `packages/runtime/tests/tokenpilot/`.

- Porte orthogonale de compression en squelette de code (`codeSkeleton.enabled`, désactivée par
  défaut) : la première exposition d'un résultat d'outil de code source frais surdimensionné
  peut conserver un squelette imports-et-déclarations avec corps elidés et lignes d'erreur
  préservées, avec repli sur l'élagage de tête d'origine. La porte est indépendante de chaque
  profil et subordonnée à la mesure par tokenizer exact.
- Interrupteur dans l'interface de réglages pour la porte, dans la section de réglages du
  sélecteur, avec textes en chinois simplifié et en anglais.
- Parité de décodage navigateur/runtime pour la nouvelle section, tests de contrat de
  confirmation à l'écriture pour `saveCodeSkeleton`, et extension de la matrice de parité de
  document complet.

### Modifié

- Ajout d'une base flat-config ESLint (`pnpm lint`, imposée en CI) et d'une boucle TDD
  `pnpm test:watch` ; suppression des imports morts et durcissement de deux chemins d'erreur
  révélés par la base lint.
- Ce dépôt est désormais maintenu comme fork amélioré de
  `WilliamShi666/dsh-context-compression-selector` ; la documentation est livrée en anglais,
  chinois simplifié, japonais et coréen.

## 0.1.0 - 2026-09-03

### Ajouté

- Version stable de l'intégration du tokenizer DeepSeek V4 Flash Vision pour
  `deepseek-v4-flash-vision-exp`, y compris le comptage exact de texte et des estimations
  bornées de tokens d'image.
- Seuil Auto Compact piloté par le modèle et configurable par l'utilisateur dans la section de
  réglages du sélecteur.
- Liaison du seuil Auto Compact aux filigranes History / micro-compact de chaque profil
  standard et aux paramètres de compression associés.

### Modifié

- L'éditeur de seuil utilise désormais une entrée numérique directe ; le curseur et les boutons
  à valeurs rapides fixes ont été supprimés.
- L'accès aux événements de session du runtime prend en charge à la fois l'accesseur `events`
  établi du Harness et la nouvelle API publique `snapshotEvents()`.

## 0.1.0-beta.4 - 2026-09-02

### Corrigé

- Prise en charge de l'API publique officielle DeepSeek Harness `dsh-v0.1.2-alpha.5` tout en
  conservant la compatibilité avec la plage de peers `0.1.1-rc.2` existante. Le plugin possède
  désormais les deux petits assistants de valeurs immuables que le Harness plus récent
  n'exporte plus, et utilise le même littéral d'espace de noms public `context-compression`
  accepté par les deux implémentations de Settings. Aucun code du cœur du Harness n'est modifié.

## 0.1.0-beta.3 - 2026-09-01

### Périmètre

C'est une mise en version par étapes. Le comptage exact de tokens de **classe texte** pour
`deepseek-v4-flash-vision-exp`, les estimations bornées au mieux d'**images de classe vision**,
et le travail seuil/UI/audit de l'Auto Compact sont livrés. La mesure exacte d'images reste
**BLOQUÉE EN AMONT** : la couture de mesure actuelle n'expose ni les dimensions d'images de
requête projetées de l'adaptateur ni la position sérialisée absolue, si bien que les estimations
ne peuvent pas être promues en `exact-tokenizer`.

### Ajouté

- Prise en charge DeepSeek V4 Flash Vision pour `deepseek-v4-flash-vision-exp` via un tokenizer
  officiel séparément empaqueté, épinglé à la révision `6821d6ad3681a4b137b066b76094fa82ebd0a380`
  de `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`. Texte, reasoning, arguments d'appels d'outils
  et résultats d'outils purement textuels sont comptés exactement ; les candidats résultats
  d'outils portant des images restent en fail-open.
- L'arithmétique des tokens d'image de vision est portée ligne par ligne depuis le
  `inference/image_processor.py` officiel (patch size 14, downsample 3, plafond de 384 tokens,
  min pixels 147456, clamp d'aspect 8:1 et padding d'alignement dépendant de la position),
  validée contre des fixtures golden générées en exécutant l'implémentation Python officielle.
  Des dimensions intrinsèques valides produisent désormais `tokenizer-estimate` au point médian
  des quatre résidus d'alignement avec une borne supérieure de 384 tokens par image ; les
  dimensions mal formées ou non évaluables utilisent un repli documenté de 256 tokens. Les
  surfaces mixtes texte/image agrègent le texte exact et les images estimées sans les promouvoir
  en exact.
- Réglage `autoCompact.thresholdPercent` (par défaut 80, entier 50–90, pas 1) avec un contrat de
  validation partagé entre l'interface de réglages, le schéma persisté et le résolveur runtime.
  L'éditeur vit dans la section de réglages du sélecteur context-compression.
- Liaison History des profils standard au filigrane Auto Compact : `A = floor(C × a)` remet à
  l'échelle le déclencheur History, la récupération minimale et la queue de tokens récents ;
  `D = floor(A × 0.875)` remplace le ratio fixe de pression de capacité 0,7 comme porte de
  dernière chance du micro-compact ; un lot doit justifier sa rupture de cache en ramenant la
  requête complète sous l'échéance. Les valeurs par défaut à 80 % reproduisent exactement les
  chiffres précédents.
- L'overlay de preset écrit le seuil enregistré dans la composition `compaction-basic` générée
  comme `thresholdRatio` (avec `retainRatio` épinglé à 0,16) et, depuis la même lecture, dans la
  configuration de déploiement du runtime du plugin comme `autoCompactThresholdPercent`, de sorte
  qu'une même génération permanente ne fait jamais tourner Auto Compact et micro compact sur
  deux seuils différents. Tout changement d'identité de génération — seuil, source ou chemins de
  modules, y compris à longueur égale — produit une nouvelle génération de composition
  permanente. Les tampons déterministes dérivés de l'identité utilisent une fenêtre entière-seconde
  de 8 hex ; des identités à préfixe égal peuvent entrer en collision dans cette première
  fenêtre sur un système de fichiers grossier, si bien que l'overlay observe la clé réelle
  `mtimeMs+size` du fichier de staging et escalade vers des fenêtres de hachage ultérieures
  avant le renommage atomique. Contenu, permissions et tampon unique final sont complets avant
  publication ; les sessions déjà en marche gardent leur politique figée.
- Les audits `policy-resolved` enregistrent désormais les faits de coordination Auto Compact
  (pourcentage de seuil, `A`, `D`, source du paramètre — y compris `deployment-override`/`mixed`
  lorsque la configuration de déploiement remplace les filigranes History liés), le
  provider/modèle routé et l'identité du tokenizer fourni.
- Les réglages persistés rejettent les sections présentes-mais-invalides (`profile: null`,
  `custom: null`, propre-propriété `undefined`) avant qu'un défaut de schéma puisse les
  absorber ; un document stocké mal formé fige la session sans perte (`profile: off`, audité
  comme `settingsInvalidFallback: lossless-off`) au lieu d'activer silencieusement la valeur
  par défaut avec perte Balanced. Le décodeur navigateur applique la même règle et canonise les
  documents hérités Custom v1/v2 vers le même document v3 que produit le résolveur runtime.
- Le planificateur History renvoie un résultat discriminé, et les audits `component-evaluation`
  distinguent la taxonomie complète des sauts : `below-profile-trigger`, `below-micro-deadline`,
  `exact-tokenizer-unavailable`, `no-safe-candidates` (seulement de la sortie d'outils de
  récupération ou des résultats déjà nettoyés), `protected-working-set` (tout ce qui est dans
  la queue protégée), `insufficient-reclaim` et `cannot-reach-deadline-target` (avec les
  nombres de tokens atteint/requis), `adaptive-cost-rejected`, et `recovery-tool-unavailable`.

### Limitations connues

- Les images ne revendiquent jamais de comptages exacts. L'expansion officielle dépend de la
  position absolue dans le prompt (prompt système, cadrage du gabarit de chat, handles
  d'images de l'adaptateur) et de la projection finale des images de requête de l'adaptateur
  (y compris les surcharges `imagePixelBudget`/`imageDetail` par route et la reprojection de
  plafond d'octets), aucune n'étant exposée par la couture de mesure actuelle. Les estimations
  intrinsèques/par défaut peuvent donc différer matériellement de la comptabilité du
  fournisseur. Les demandes de capacités amont restent : dimensions d'images de requête
  projetées et position sérialisée absolue exposées aux extensions de mesure de tokens.
- History saute le lot entier dès qu'un candidat résultat d'outil manque de comptage exact,
  y compris les candidats portant des images, alors même que les candidats texte voisins sont
  individuellement exacts.
- Custom reste en mode tokens manuel ; ses paramètres History ne suivent pas le filigrane
  Auto Compact.
- Une interface de répartition des tokens de vision n'est pas livrée ; les estimations d'images
  et le diagnostic d'alignement intrinsèque sont disponibles sur la vue de tokens mesurés,
  tandis que les preuves de réécriture avec perte exigent toujours des comptages exacts.

### Différé

- Champ `modality` d'audit et SHA-256 de l'artefact tokenizer dans les enregistrements d'audit
  (les audits portent déjà le provider/modèle routé et l'identité du tokenizer).
- Publication de la taxonomie des raisons de saut du runtime (désormais complète) comme table
  de documentation destinée à l'utilisateur.
- Affichage des filigranes A/D pour le profil Custom et un avertissement au-delà de D ; Custom
  reste entièrement manuel.
- Interface de répartition des tokens de vision et promotion des estimations d'images en
  mesure exacte.

## 0.1.0-beta.2 - 2026-08-28

### Corrigé

- Résoudre la route du tokenizer officiel DeepSeek V4 Flash afin que Fresh et Aggregate
  puissent évaluer les résultats d'outils pour les modèles V4 pris en charge.
- Exécuter Cache Strict History à la véritable frontière de requête dès que sa condition
  configurée de pression de capacité est remplie ; déclencher la condition de capacité à 70 %
  d'utilisation du contexte routé.
- Désactiver l'élagage Harness natif tête/milieu/queue des résultats d'outils dès qu'un profil
  du sélecteur est actif, laissant le sélecteur comme seul compacteur de résultats d'outils.

### Modifié

- Protéger les 10 derniers appels d'outils de l'agent et une fenêtre de queue de résultats
  d'outils de 64 000 tokens avant que History/microcompact ne réécrive des résultats plus anciens.

## 0.1.0-beta.1 - 2026-08-27

### Ajouté

- Bundle produit DeepSeek Harness en une seule installation, adossé à un package runtime séparé
  en version exacte.
- Sélecteur de profil web avec réglages stables par preset et une exception Minimal intégrée
  explicite.
- Fresh, Aggregate, History consciente des routines/de la capacité, élagage natif des résultats
  d'outils et TailTrim Custom désactivé par défaut.
- Protocole TailTrim d'événements standard utilisant `compaction/prune` plus un remplacement
  récupérable de `user/message`.
- Outil de récupération `context_compression_retrieve` détenu par le plugin.
- Enregistrements d'audit structurés et sans contenu : politique, évaluation, réécriture,
  échec et auto-compact natif.
- Actifs tokenizer officiels DeepSeek V4 épinglés avec validation SHA-256 à l'exécution et
  licence amont.
- Tests de régression e2e de composants sur API publique, preset/Minimal et préfixes de cache
  parent/fork/spawn.

### Compatibilité

- Vérifié contre les packages publics DeepSeek Harness `dsh-v0.1.1-rc.2`.
- Le mappage exact des tokenizers est actuellement limité à `deepseek-v4-flash` et
  `deepseek-v4-pro`.

### Limitations connues

- L'History adaptative échoue fermée lorsque les preuves publiques de route/cache au niveau
  requête sont incomplètes ; la pression de capacité reste une sécurité distincte.
- Les tests de préfixe de cache prouvent l'héritage de fork natif et des préfixes sérialisés
  identiques, pas une allocation de cache propre au fournisseur ni un hit de cache DeepSeek
  garanti.
- Les instantanés de réglages et les décisions de première exposition sont propres au processus
  du runtime monté.
