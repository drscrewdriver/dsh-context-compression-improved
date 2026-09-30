# Installation de dsh-context-compression-improved

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md) · [Français](installation.fr.md) · [Deutsch](installation.de.md) · [Italiano](installation.it.md) · [Русский](installation.ru.md) · [Español](installation.es.md)

Ce guide installe le fork depuis les sources. Le fork est aussi publié sur npm sous le
nom `dsh-context-compression-improved` avec le dist-tag `dsh-0.1.5` ; le nom du package
reste volontairement celui de l'amont. Le runtime, qui constituait autrefois un second
package, en fait désormais partie : une seule installation apporte toute la pile.

## Prérequis

- Node `^22.19.0 || >=24` et pnpm `11.7.0` (`corepack enable` retient la version épinglée du champ `packageManager`).
- Une installation de DeepSeek Harness compatible avec la plage de peers `0.1.1-rc.2` (vérifié contre la version officielle `dsh-v0.1.2-alpha.5`).
- Une route de modèle DeepSeek. La compression avec perte — y compris la porte squelette de code — décide sur la base de caractères, de sorte qu'aucune exigence de route avec tokenizer fourni ne subsiste ; lorsqu'un tokenizer fourni existe, ses comptages exacts sont enregistrés comme télémétrie, et les autres routes échouent en mode ouvert (fail-open) et conservent les résultats d'outils originaux.
- Git.

## 1. Construire depuis les sources

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` empaquette les deux facettes de bibliothèque de chaque package (`tsdown`). Exécutez d'abord `pnpm test` si vous voulez la suite complète sur votre machine avant d'installer.

## 2. Empaqueter le package d'entrée du Bundle

Le package sélecteur est la seule entrée Bundle ; le runtime l'accompagne comme dépendance en version exacte :

```sh
cd packages/selector
pnpm pack
# → dsh-context-compression-improved-0.1.0.tgz
cd ../..
```

`pnpm pack` fait passer le bundle par le hook `prepack`, de sorte que le tarball correspond toujours à votre checkout.

## 3. L'ajouter à un profil Harness

Le package sélecteur déclare le champ de manifeste Bundle du Harness `dsh.bundle.patch`, donc `dsh plugin add` est le chemin d'installation Bundle hors arbre standard :

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.1.0.tgz
dsh --profile web --dump-config
```

Redémarrez le profil sélectionné après l'installation. Le dump de configuration devrait lister le Bundle sélecteur comme actif. N'installez **pas** et ne câblez **pas** séparément les packages sélecteur et runtime — le runtime est installé automatiquement.

## 4. Activer la porte squelette de code

Ouvrez les réglages de DeepSeek Harness → **Context compression selector** :

1. Choisissez un profil de compression (la porte est orthogonale à tous).
2. Ajustez éventuellement le niveau de déclenchement de l'Auto Compact (50–90 %, 80 % par défaut).
3. Réglez **Code skeleton compression** sur **On**. L'interrupteur enregistre à chaque modification.

Comme tous les réglages du sélecteur, la valeur est figée lorsqu'une session l'observe pour la première fois — la porte n'affecte que les sessions nouvellement observées, jamais une tâche déjà en cours.

## 5. Facultatif : le conseiller de pertinence consultatif

Le plugin peut conserver des statistiques sur la pertinence restante de l'historique de la session — à titre consultatif uniquement, il ne décide ni ne bloque quoi que ce soit. Il est désactivé par défaut ; activez-le en éditant la section `presetOptions` des réglages de compression de contexte (JSON de réglages, pas de carte dans l'UI à ce stade) :

```json
"presetOptions": {
  "advisorMode": "host",
  "advisorRefreshTurns": 8,
  "advisorScoreThreshold": 0.35,
  "advisorSampleLimit": 16,
  "advisorMinTokens": 250,
  "advisorTimeoutMs": 8000
}
```

`advisorMode: "host"` appelle le service `llm` du harness ; `"direct"` réutilise l'endpoint
`estimatorBaseUrl` / `estimatorApiKey` / `estimatorModel` de l'estimateur. À chaque frontière
de tour, le conseiller (1) résume la tâche courante à partir de l'événement `todo/write` le
plus récent, (2) note de façon incrémentale les résultats d'outils historiques pour leur
pertinence contenu-commentaires, et (3) enregistre un chiffre de décroissance de préfixe.
Les résultats apparaissent comme enregistrements d'audit `advisor-outcome` et, avec le
drapeau de déploiement `advisorReportRoute: true`, via une route HTTP en lecture seule
`GET .../advisor-report?sessionId=`. Ce que le conseiller rapporte ne peut jamais
supprimer, retarder ni réécrire une réduction qui doit s'appliquer.

## 6. Mettre à jour ou supprimer

```sh
# update: pull, rebuild, repack, and add the new tarball again
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.1.0.tgz

# remove
dsh plugin --profile web remove dsh-context-compression-improved
```

## Dépannage

- **Bundle inactif dans le dump** : redémarrez le profil ; confirmez que vous avez ajouté le package d'entrée sélecteur (pas le runtime) et que la version du Harness est dans la plage de peers compatible.
- **Les résultats d'outils ne sont jamais compressés en squelette** : la porte est désactivée par défaut ; vérifiez l'interrupteur. La compression ne s'applique qu'aux résultats d'outils frais, surdimensionnés et de code source (les décisions s'exécutent sur la base de caractères ; aucune exigence de route à tokenizer exact), et chaque omission est enregistrée avec sa raison dans la piste d'audit.
- **L'interrupteur apparaît comme illisible** : la section `codeSkeleton` stockée a échoué au décodage strict du navigateur (elle doit être exactement `{ enabled: boolean }`). Supprimer la section mal formée restaure les valeurs par défaut.
- **La mise à jour échoue à l'étape de mise à niveau** : le plugin suit la sémantique des packages npm ; supprimez d'abord l'ancienne version si votre build du Harness refuse une mise à niveau de tarball à tarball.
