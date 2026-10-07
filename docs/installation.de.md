# dsh-context-compression-improved installieren

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md) · [Français](installation.fr.md) · [Deutsch](installation.de.md) · [Italiano](installation.it.md) · [Русский](installation.ru.md) · [Español](installation.es.md)

Diese Anleitung installiert den Fork aus dem Quellcode. Der Fork ist außerdem auf npm als
`dsh-context-compression-improved` unter dem Dist-Tag `latest` — eine einzige Version deckt alle unterstützten Harness-Linien ab (0.1.0-rc.2 bis 0.2.0-rc.2) veröffentlicht; der Paketname
bleibt absichtlich der des Upstreams. Die Runtime, die früher ein zweites Paket war, ist jetzt
Teil davon — eine Installation bringt den gesamten Stapel mit.

## Voraussetzungen

- Node `^22.19.0 || >=24` und pnpm `11.7.0` (`corepack enable` übernimmt die fixierte Version aus `packageManager`).
- Eine DeepSeek-Harness-Installation innerhalb der 15-rc-Peer-Aufzählung des Plugins (`0.1.0-rc.2` bis `0.2.0-rc.2`).
- Eine DeepSeek-Modellroute. Verlustbehaftete Kompression — einschließlich des Code-Skelett-Gates — entscheidet auf Zeichenbasis, daher verbleibt keine Anforderung an eine Route mit mitgeliefertem Tokenizer; wenn ein mitgelieferter Tokenizer existiert, werden seine exakten Zählungen als Telemetrie erfasst, und andere Routen fallen offen aus (fail-open) und behalten die ursprünglichen Tool-Ergebnisse.
- Git.

## 1. Aus dem Quellcode bauen

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` bündelt beide Bibliotheksflächen jedes Pakets (`tsdown`). Führen Sie zuvor `pnpm test` aus, wenn Sie die komplette Suite vor der Installation auf Ihrem Rechner laufen lassen wollen.

## 2. Das Bundle-Eingangspaket packen

Das Selektor-Paket ist der einzige Bundle-Eingang; die Runtime kommt als Abhängigkeit in exakter Version mit:

```sh
cd packages/selector
pnpm pack
# → dsh-context-compression-improved-0.9.0.tgz
cd ../..
```

`pnpm pack` leitet das Bundle durch den `prepack`-Hook, daher entspricht das Tarball immer Ihrem Checkout.

## 3. Zu einem Harness-Profil hinzufügen

Das Selektor-Paket deklariert das Harness-Bundle-Manifestfeld `dsh.bundle.patch`, daher ist `dsh plugin add` der standardmäßige außerbaumartige Bundle-Installationspfad:

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.9.0.tgz
dsh --profile web --dump-config
```

Starten Sie das ausgewählte Profil nach der Installation neu. Der Konfigurationsdump sollte das Selektor-Bundle als aktiv listen. Installieren und verdrahten Sie Selektor- und Runtime-Paket **nicht** separat — die Runtime wird automatisch installiert.

## 4. Das Code-Skelett-Gate einschalten

Öffnen Sie die DeepSeek-Harness-Einstellungen → **Context compression selector**:

1. Wählen Sie ein Kompressionsprofil (das Gate ist zu allen orthogonal).
2. Passen Sie optional den Auto-Compact-Auslösepegel an (50–90 %, Standard 80 %).
3. Stellen Sie **Code skeleton compression** auf **On**. Der Schalter speichert bei jeder Änderung.

Wie alle Selektor-Einstellungen wird der Wert fixiert, sobald eine Sitzung ihn erstmals beobachtet — das Gate wirkt auf neu beobachtete Sitzungen, niemals auf eine bereits laufende Aufgabe.

## 5. Optional: der beratende Relevanz-Advisor

Das Plugin kann Statistiken darüber führen, wie relevant der Sitzungsverlauf noch ist — rein beratend, es entscheidet und blockiert nichts. Es ist standardmäßig aus; aktivieren Sie es, indem Sie den Abschnitt `presetOptions` der Kontextkompressions-Einstellungen bearbeiten (Einstellungs-JSON, in dieser Runde keine UI-Karte):

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

`advisorMode: "host"` ruft den Harness-`llm`-Dienst auf; `"direct"` wiederverwendet den
`estimatorBaseUrl` / `estimatorApiKey` / `estimatorModel`-Endpunkt des Estimators. An jeder
Turn-Grenze (1) fasst der Advisor die aktuelle Aufgabe aus dem letzten `todo/write`-Ereignis
zusammen, (2) bewertet historische Tool-Ergebnisse inkrementell auf Inhalts- und
Kommentar-Relevanz und (3) erfasst eine Prefix-Decay-Kennzahl. Ergebnisse erscheinen als
`advisor-outcome`-Audit-Einträge und, mit dem Deployment-Flag `advisorReportRoute: true`,
über eine schreibgeschützte HTTP-Route `GET .../advisor-report?sessionId=`. Was der Advisor
meldet, kann niemals eine Reduktion unterdrücken, verzögern oder umschreiben, die ansonsten
greifen würde.

## 6. Aktualisieren oder entfernen

```sh
# update: pull, rebuild, repack, and add the new tarball again
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.9.0.tgz

# remove
dsh plugin --profile web remove dsh-context-compression-improved
```

## Fehlerbehebung

- **Bundle im Dump nicht aktiv**: Starten Sie das Profil neu; bestätigen Sie, dass Sie das Selektor-Eingangspaket (nicht die Runtime) hinzugefügt haben und die Harness-Version im kompatiblen Peer-Bereich liegt.
- **Tool-Ergebnisse werden nie skelettkomprimiert**: Das Gate ist standardmäßig aus; prüfen Sie den Schalter. Kompression greift nur bei frischen, übermäßigen Quellcode-Tool-Ergebnissen (Entscheidungen laufen auf Zeichenbasis; keine Anforderung an eine exakte Tokenizer-Route), und jeder Übersprung wird mit Grund in der Audit-Spur protokolliert.
- **Der Schalter erscheint als unlesbar**: Der gespeicherte `codeSkeleton`-Abschnitt hat die strenge Browser-Dekodierung nicht bestanden (er muss exakt `{ enabled: boolean }` sein). Das Entfernen des fehlerhaften Abschnitts stellt die Standardwerte wieder her.
- **Die Aktualisierung scheitert am Upgrade-Schritt**: Das Plugin folgt der npm-Paketsemantik; entfernen Sie zuerst die alte Version, wenn Ihr Harness-Build ein Tarball-zu-Tarball-Upgrade verweigert.
