# Änderungsprotokoll

> [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [日本語](CHANGELOG.ja.md) · [한국어](CHANGELOG.ko.md)

Alle nennenswerten Änderungen werden in dieser Datei festgehalten. Das Projekt folgt nach `0.1.0` der semantischen Versionierung.

## 0.9.0 - 2026-10-08

### Hinzugefügt

- **Eine Version für jede Harness-Linie**: 0.9.0 ist eine einzelne Veröffentlichung, die
  alle 15 rc von 0.1.0-rc.2 bis 0.2.0-rc.2 (sechs Host-Linien) bedient. Das
  linienweise dist-tag-Schema wird eingestellt — nach der Veröffentlichung zeigen
  `latest`, `dsh-0.1.2`, `dsh-0.1.5`, `dsh-0.1.7` und `dsh-0.2.0` alle auf 0.9.0.
- **Drei-Generationen-Einstellungs-Taille**: Beim Start erkennt das Plugin, welche
  Einstellungsfläche der Host bereitstellt — den Legacy-Dienst `settings.register`
  (0.1.0-0.1.5) oder loader-verwaltete volatile Konfiguration + `configForms`
  (0.1.7+/0.2.0) — und aktiviert nur die passende Client-Fläche (`settings.section` vs.
  `configForms`), auf 0.1.7+ zusätzlich die Karte `plugins.bundle.config`.
- **Einstellungsbrücke**: Auf Legacy-Linien lesen und schreiben Tools über einen
  leaseschreibbaren Einstellungs-Namespace (umhüllte Tool-Ergebnisse); auf modernen
  Linien lesen sie das configForms-Dokument direkt, und Bridge-Schreibvorgänge liefern
  by design 409.
- Die Karte `plugins.bundle.config` rendert die vollständige Einstellungskomponente über
  ein closure-erzeugtes `useCompression` (die Paketdetail-Kette hat kein hookContext,
  daher ist entry-level Hook-Injection dort nicht verfügbar).

### Behoben

- Der Generierungs-Probe cached keine vorläufige Antwort mehr zur Wire-Zeit: Das Fehlen
  des settings-Dienstes während der Row-Komposition (vor Existenz der Host-Dienste) wird
  bei der tatsächlichen Injection neu entschieden — der Legacy-Lease-Arm war zuvor auf
  0.1.0 tot.
- Der Tail-Trim-Validator vergleicht die source kind des Ersatzes mit dem
  generationsgesteuerten Schreiber statt mit einer hartcodierten Plugin-id und verwirft
  seine eigene Legacy-Umhüllungs-Ausgabe nicht mehr.
- Der configForms-Client-Arm löst den Dienst über die `.configForms`-Eigenschaft des
  injizierten Owner-Context auf; der rohe Context als Handle ließ `get()` `undefined`
  zurückgeben, und die Host-Slot-Grenze stufte die Einstellungssektion auf 0.1.7 in eine
  tote Zelle ab.

### Geändert

- Alle `@deepseek-ai/dsh-*`-Peer-Bereiche und `engines.dsh` zählen die 15 rc explizit auf,
  sodass kein Engine-/Peer-Gate die Installation auf einer Host-Linie blockiert.


## 0.8.0-beta.1 - 2026-09-30

### Geändert

- Harness-0.2.0-Kompatibilitätslinie: alle 23 `@deepseek-ai/dsh-*`-Peer-Bereiche auf
  `>=0.2.0-rc.1 <0.2.1-0` angehoben, und `engines.dsh` zieht in allen drei Manifesten nach
  (Root, Selektor-Paket, Plugin-Manifest). `publishConfig.tag` wird zu `dsh-0.2.0`; die
  0.1.7-Linie wird weiterhin über `dsh-0.1.7` (nun `0.7.0-beta.1`) beliefert, die
  0.1.5/0.1.2-Linien über ihre eigenen Dist-Tags.
- 39 der 41 fixierten Overrides und 46 der 48 Dev-Dependencies auf `0.2.0-rc.1` gehoben;
  `@deepseek-ai/dsh-agent-presets` (`0.1.6-alpha.2`) und `@deepseek-ai/dsh-code-runtime`
  (`0.1.5-rc.3`) behalten ihre Fixierung — keines der beiden Pakete hat eine
  0.2.0-Linien-Veröffentlichung.
- Release-Gates neu ausgerichtet: das Harness-Pin des E2E mit gepackter Installation checkt nun
  den offiziellen `dsh-v0.2.0-rc.1`-Baum aus (`4878cdab`), und der Vertragstest der gebauten
  Artefakte prüft den Client-Slot `configForms` (umbenannt von `settingsScope` auf der
  0.1.7-Linie).

## 0.6.5 - 2026-09-29

### Behoben

- Ausrichtung der Dev-Dependencies auf die Harness-0.1.7-Linie: 46 der 48 `@deepseek-ai/dsh-*`
  Dev-Dependencies wechseln von der präzisen `0.1.5-rc.2`-Fixierung zur präzisen
  `0.1.7-rc.2`-Fixierung, und `pnpm-lock.yaml` wurde aus einem sauberen Baum regeneriert.
  Typecheck, Build, Test, Lint und `verify:release` laufen nun gegen die echte
  0.1.7-rc.2-Basis, statt die 0.1.7-Anpassungen gegen 0.1.5-Eingaben zu validieren (ein falsches
  Grün). Zwei Pakete haben überhaupt keine 0.1.7-Linien-Veröffentlichung und behalten ihre
  installierzeitigen Fixierungen: `@deepseek-ai/dsh-agent-presets` (`0.1.6-alpha.2`) und
  `@deepseek-ai/dsh-code-runtime` (`0.1.5-rc.3`). `react-dom` erhält eine explizite
  `^18.2.0`-Dev-Dependency, damit eine frische Auflösung React-DOM 19 nicht mit React 18 unter
  den Testsuiten paaren kann.
- Die Settings-Naht des Test-Hosts wurde gegen den echten 0.1.7-Host neu gebaut:
  `SettingsProvider` existiert in `@deepseek-ai/dsh-settings` nicht mehr (ersetzt durch die
  deklarativen `SettingsForms`), während das Plugin den Legacy-Lesezugriff `ctx.settings.get(ns)`
  als Host-Form-Fallback behält. Die Specs mounten nun eine vendored Kopie des
  0.1.5-rc.2-Providers (`tests/helpers/legacy-settings/`), um genau diesen Fallback zu
  üben, und der Legacy-Namespace-Registrar verengt den Dienst an der Naht. Der Live-Test des
  DeepSeek-Harness registriert den Provider über die 0.1.7-Adapter-Naht statt über das
  entfernte in sich geschlossene `llm-deepseek`-Plugin.
- Durch die echte Basis aufgedeckte Test-Anpassungen: die Compaction-Engine-Fixtures übergeben
  `headroomTokens: 0` (0.1.7-rc.2 setzt standardmäßig einen Compaction-Headroom von 65536
  Tokens, der die 1k-Token-Sondenfenster der Fixtures verschluckt), und die
  Tool-Result-Asset-Assertion folgt der erstklassigen `role: 'tool'`-Nachrichtenform (kein
  umhüllender `tool-result`-Inhaltsblock mehr).
- Release-Gates erneut auf die offizielle 0.1.7-Veröffentlichung fixiert: `verify-release.mjs`
  und das gepackte E2E prüfen nun Selektor-Peers `>=0.1.7-rc.1 <0.2.0-0`, und der
  offizielle-Harness-Klon des gepackten E2E prüft den Tag `dsh-v0.1.7-rc.2` (Commit `477b4f42`,
  Baum `e3e63253`).
- `packages/selector/dsh.plugin.json` trägt nun die Release-Version (0.6.5; jedes frühere
  0.6.x lieferte sie fixiert auf 0.1.0) und deklariert den ehrlichen Engine-Bereich
  `>=0.1.7-rc.1 <0.2.0-0`.
- Lint-Schulden aus den manuellen 0.6.3-Anpassungen getilgt: ungenutzte Imports/Lokale in
  `src/index.ts`, `src/client/index.ts`, `src/pruner.ts` und drei Host-Specs entfernt; der
  Scan der Staging-Reste der laufenden Generation wird nun auf den eigenen Store der Spec
  beschränkt, damit eine nebenläufig publizierende Spec ihn nicht zum Scheitern bringen kann.

## 0.6.4 - 2026-09-26

### Behoben

- Der Locale-Binder des Clients ist eager: ein Wechsel der Host-Locale rendert die
  Kompressions-Einstellungs-UI nun ohne Remount neu.
- Aus einem Stash veröffentlicht und nie in einen Zweig committet (der Arbeitsbaum, der sie
  veröffentlichte, ging verloren); compat/0.1.7 stellte den exakten Inhalt in 0.6.5 wieder her
  und verifizierte ihn byteweise gegen den Registry-Tarball, bevor es weiterging.

## 0.5.4 - 2026-09-20

### Behoben

- Die Installationsfläche deklariert `@deepseek-ai/schemastery` als Laufzeit-Abhängigkeit. Die
  gepackte Runtime importiert sie bedingungslos (`import z from '@deepseek-ai/schemastery'` in
  `packages/selector/lib/index.js`, `lib/pruner.js` und `lib/advisor-state.js`), aber 0.5.3
  deklarierte sie nirgends, wo eine konsumierende Installation sie liest: das ausgelieferte
  Root-Manifest listete nur `@huggingface/tokenizers` und `js-yaml`, und
  `packages/selector/package.json` führte sie als Peer, was kein Paketmanager für ein
  verschachteltes Paket konsultiert, das er installiert. Die Auflösung hing daher von einem
  unrelated installierten Paket ab, das `@deepseek-ai/schemastery` ins Profil hob. Bei einer
  sauberen Installation fiel der Import auf den Shared-Module-Fallback der
  Harness-Installation unter `$DSH_HOME/profiles/node_modules` zurück; enthielt dieser Fallback
  kein gebautes Paket, scheiterte jeder Plugin-Einstieg am Laden und der Host startete ohne die
  Bundle-Schicht. Beide Manifeste fixieren nun `3.18.2`, die Version, gegen die diese
  Veröffentlichung gebaut und getestet ist, und das Selektor-Paket behauptet keine
  Peer-Verpflichtung mehr, die es nicht hat.

### Hinzugefügt

- `verify:release` leitet die Abhängigkeiten der Installationsfläche aus den nackten
  Spezifizierern ab, die die gepackten Runtime-Dateien importieren, statt
  `@huggingface/tokenizers` und `js-yaml` von Hand zu nennen. Welche Pakete mit dem Plugin
  ausgeliefert werden und welche die Harness-Installation bereitstellt, ist eine geprüfte
  Liste, und ein Import, dessen Anbieter in keinem der Manifeste steht, lässt das Gate mit dem
  fehlenden Namen scheitern. Das Gate wurde als Negativkontrolle gegen die unfixierten
  Manifeste hinzugefügt, bei denen es an `@deepseek-ai/schemastery` scheiterte.

## 0.5.3 - 2026-09-20

### Behoben

- Der Bundle-Patch setzt das eingestellte Review-Route-Flag nicht mehr. `reviewQueueRoute` war
  aus dem Config-Schema des Plugins entfernt worden, als das Review-Gate eingestellt wurde,
  blieb aber in `packages/selector/cordis.patch.yml` stehen, wo es eine Route bewarb, die sich
  nie registrieren kann. Hosts tolerieren den unbekannten Schlüssel heute (das Plugin lädt und
  dient — auf einem Live-Host verifiziert), dies ist also ein veralteter Konfigurationsdefekt
  statt eines Bruchs, würde aber auf jedem Host brechen, der die Plugin-Konfiguration streng
  validiert.
- Generierte Artefakte sind auf LF fixiert (`packages/selector/lib/** text eol=lf`). Mit
  `core.autocrlf=true` schrieb jeder Checkout die committeten `lib/**` auf CRLF um, sodass
  jeder Zweigwechsel oder Merge das gesamte Artefaktverzeichnis als modifiziert meldete, allein
  wegen EOL-Unterschieden. Aus diesem Zustand wurde nie etwas committet, aber jeder Baum sah
  schmutzig aus, und ein echter Artefaktwechsel hätte sich dahinter verbergen können.

### Hinzugefügt

- Eine Negativkontroll-Vertragsfixierung auf den Bundle-Patch: er scheitert, wenn ein
  eingestellter Config-Schlüssel im Patch gesetzt ist (geprüft auf schlüsselsetzenden Zeilen,
  der erklärende Kommentar darf den Schlüssel weiterhin nennen), und verlangt, dass das
  Live-Flag `estimatorCatalogRoute` verdrahtet bleibt.

### Tests

- Der Client-Sitz-Vertrag fixiert auch die Verschlechterung auf älteren Hosts: ein Host, der den
  Sitz nicht deklariert, weist die Registrierung an der Slot-Grenze zurück, und `apply()` muss
  sie schlucken und warnen, statt jeden Einstellungseintrag mit in den Abgrund zu reißen.

## 0.5.2 - 2026-09-20

### Geändert

- Die Review-Pipeline mit menschlichem Gate (Beta) wird **eingestellt**. Ihre Semantik wird
  durch Rat ersetzt: das Nutzenmodell preist jede Runde weiterhin als EINE zusammengeführte
  Mutation, aber das von ihm berechnete Band (`profitable` / `high-impact` / `slow-payback` /
  `unpriceable` / `not-worth-it`) wird nun als `reduction-advice`-Audit-Eintrag veröffentlicht
  und auf der Advisor-Report-Route als Snapshot abgelegt — es hält, verzögert oder schreibt
  nie eine Reduktion zurück. Das Gate widersprach der eigenen Anforderung der Funktion (eine
  Reduktion darf die automatische Verarbeitung nie blockieren) und leitete mit den
  ausgelieferten Defaults (`reviewMode` an plus ein High-Impact-Schwellwert von 4.000 Tokens
  gegen einen Fresh-Trigger von 8.192 Tokens) 100 % eines Fresh-Batches in die menschliche
  Review um, sodass der automatische Pfad für jeden, der sich eingeschaltet hatte, faktisch
  aus war. Die Ratsschwellen sind nun Modulkonstanten (α `0.1`, High-Impact `4.000` Tokens):
  nichts wirkt auf sie, sie sind also keine Einstellungen mehr.
- Mit dem Gate entfernt: die Review-Queue und ihr `storageDomain`-Adapter, die prozessweite
  Registrierung, die HTTP-Routen `review-queue` / `review-decide` und das
  Deployment-Flag `reviewQueueRoute`, das Client-Panel `shell.overlay`, die
  Einstellungsschlüssel `reviewMode` / `reviewTimeoutTurns` / `cacheHitDiscountAlpha` /
  `reviewHighImpactTokens` und die Audit-Art `review-outcome`. Die vier
  Einstellungsschlüssel werden von beiden Dekodern weiterhin AKZEPTIERT und IGNORIERT — ein
  bestehendes Dokument (das Live-Dokument trägt `reviewMode: false`) lädt weiter und rendert
  weiter seine Einstellungskarte — und erreichen nie die aufgelöste Richtlinie. Die
  schreibgeschützte Route `GET .../advisor-report` liefert zusätzlich `lastAdvice`.

### Hinzugefügt

- Regressionsfixierungen für die Einstellung: eine Host-Integrations-Spec fährt genau die
  Einstellungen, die früher alles umlenkten (`reviewMode: true`, `reviewHighImpactTokens: 1`),
  und bestätigt, dass der Fresh-Batch LANDET, beschrieben durch einen
  `high-impact`-Ratseintrag; eine Deprecation-Vertrags-Spec fixiert accept-and-ignore für die
  eingestellten Schlüssel sowohl im Runtime-Parser als auch im Browser-Dekoder.

### Rollback

- Installieren Sie die letzte Veröffentlichung erneut, die das Gate noch ausliefert:
  `npm dist-tag add
  dsh-context-compression-improved@0.5.1 dsh-0.1.5 --registry https://registry.npmjs.org/`
  dann `dsh plugin --profile web add dsh-context-compression-improved@0.5.1`.

## 0.5.1 - 2026-09-20

### Behoben

- Die nebenläufige Preset-Overlay-Komposition einer Identität scheitert unter Windows nicht
  mehr. Die Veröffentlichung ist nun pro Zielpfad serialisiert, und wenn das atomare Umbenennen
  das Rennen dennoch verliert, wird bestätigt, dass das Ziel bereits den
  `{mtimeMs, size}`-Standingschlüssel dieser Staging-Datei trägt, bevor die Veröffentlichung
  Erfolg meldet. Windows `MoveFileEx` meldet das verlorene Rennen als `EPERM`/`EBUSY`, wo
  POSIX `rename` das Ziel einfach ersetzt, wodurch `standingKeyFor()` beim nebenläufigen
  Sitzungsstart warf. Ein nicht passendes Ziel scheitert weiterhin laut, sodass eine still
  wiederverwendete Generation verboten bleibt.
- Release-Gate- und Testreparaturen, die dies und andere vorbestehende rote Gates versteckt
  hatten: veraltete Bezeichner und ein eingestellter Audit-Grund in den gepackten Smokes, eine
  veraltete Client-Inject-Erwartung und Windows-spezifische Spawn-Fallen (`git` und mehrzeilige
  `node -e`-Skripte wurden über `cmd.exe` geroutet, das ihre Argumente umschrieb).

## 0.5.0 - 2026-09-20

### Hinzugefügt

- Beratender Relevanz-Advisor (nur Statistiken und Vorschläge, standardmäßig aus): an jeder
  Turn-Grenze fasst eine Fire-and-forget-Runde die Tail-Task-Semantik der Sitzung aus dem
  letzten `todo/write`-Ereignis zusammen (mit Fallback auf kürzlichen Benutzertext), bewertet
  historische Tool-Result-Kandidaten inkrementell auf Inhalts- und Kommentar-Relevanz gegen
  die aktuelle Aufgabe und berechnet eine Prefix-Decay-Kennzahl (zeichendruckgewichtetes
  Relevanzmittel). Relevanzarme alte Segmente werden als `recertified` markiert — Vorschläge
  für spätere Entscheidungen zur History-Aggressivität; nichts verbraucht sie in dieser Runde,
  und die Advisor-Ausgabe kann nie eine Reduktion unterdrücken, verzögern oder umschreiben,
  die ansonsten landen würde (durch einen dedizierten Invariantentest fixiert). Konfiguration
  über die Einstellungsschlüssel `presetOptions.advisor*` (`advisorMode` `''|'host'|'direct'`,
  Standard `''`; der direkte Kanal verwendet den Estimator-Endpoint erneut; `SideChannel`
  erhielt einen optionalen Overrides-Parameter, sodass der Estimator-Transport geteilt wird,
  ohne seine Konfiguration zu teilen). Observierbarkeit: neue `advisor-outcome`-Audit-Einträge
  (inhaltsfrei, einer pro Phase: summary / scoring / decay) und eine schreibgeschützte
  HTTP-Route `GET .../advisor-report?sessionId=` (Opt-in-Deployment-Flag `advisorReportRoute`,
  Spiegelbild der Review-Routen). Client-UI bleibt in dieser Runde bewusst aus.

## 0.4.0 - 2026-09-20

### Behoben

- Das Plugin hängt nicht mehr von der gerouteten Modell-ID ab: jedes Planungs-Gate entscheidet
  nun auf Zeichenbasis (Unicode-Codepunkte über `characterPressure` / `pressureCost`) statt
  über exakte Tokenizer-Zählungen, sodass eine Route ohne gebündelten Tokenizer (das Live-
  `deepseek-flash`) Rewrites wieder landen lässt, statt sie still zu überspringen.
  Token-Schwellwerte behalten Namen und Werte (umgerechnet nach der dokumentierten
  4.0-chars/token-Konvention, fixierte Profilbasis unangetastet); Token-Zahlen werden zu
  Telemetrie, ehrlich gekennzeichnet durch das neue Feld `measurementBasis` in den
  Rewrite-Audit-Einträgen (`exact-tokenizer` vs. `characters`, mit
  `tokenizerId: 'characters'` / `tokenizerRevision: 'chars-per-token-4.0'` bei Ableitung).
  Rollback: `git revert 7a1972a` stellt die exakten Tokenizer-Gates als eine Einheit wieder
  her; zuvor bestätigen, dass keine spätere Änderung eine davon abhängige Modell-ID-Spaltung
  wieder eingeführt hat.

### Hinzugefügt

- Batchweite Nutzenpreisbildung (R1): eine Review-Runde wird als EINE zusammengeführte Mutation
  preisgegeben — die Strafe für das Nachfüllen des Tail-KV-Cache wird einmal pro Batch statt
  pro Kandidat gezahlt, sodass echte Batches (5×50k mit einem 64k-Tail) das automatische Band
  erreichen statt alle zu verwerfen.
- Zeilenzuordnung zu Ursprungsereignissen (R9a): die terminale Normalisierung gibt gefaltete
  Zeilen zurück, die jeweils ihre 1-basierte Ursprungsereignis-Zeilennummer tragen; `retrieve`
  liest rohe Ereignisse, sodass gedruckte Bereiche sich zu den richtigen Zeilen auflösen.
- Dokument-Skelett und universeller Prosaerhalt (R8/R8b): strukturierte Dokumente behalten
  Überschriften, erste/letzte Zeilen von Abschnitten, Listenanfänge und Tabellenköpfe; jeder
  andere Nicht-Code-Text behauptet Kopf UND Ende mit einem R9-Zeilenbereichsmarker (Prosa wurde
  zuvor nur am Kopf abgeschnitten).
- Zweistufiges Suchfalten (R10, behebt D8): ein verlustfreier L1-Lokator pro Datei plus ein
  wassergefülltes L2-Inhaltskontingent.
- Nicht-adjazentes Häufigkeitsfalten (R11): getrennte exakte Wiederholungen (bis zu 8,37 %
  großer Resultate) falten zum ersten Auftreten plus einem gezählten Marker.
- Lange-String-Platzhalter (R12): base64/hex/UUID-Blobs werden zu Längenzusammenfassungen mit
  einem 16-Zeichen-Erkennungspräfix.
- Zweistufige HTML-Reduktion (R13, behebt D9): `html-slim`, dann `html-skeleton`, zeilenbündig,
  sodass ursprüngliche Zeilennummern überleben.
- R9b-Anker: zusammenhängende Masken zitieren ursprüngliche Zeilenbereiche, Streumasken melden
  `lines 1-N scanned, K kept`, und jeder Retrieve-Hinweis trägt ein einfügbares
  `{"ref":…,"start_line":N,"max_lines":80}`.
- Dokumentenzensus: Zusammenfassungen ausgelassener Dokumente listen Abschnittsüberschriften
  auf statt eines konstanten `0 error, 0 warn, N info`-Histogramms.

## 0.3.1 - 2026-09-18

### Geändert

- Das Runtime-Paket ist im Selektor-Paket aufgegangen: eine Installation bringt den gesamten
  Stapel mit, der Repository-Root ist die Installationsfläche (`name`, `main`, `types`,
  `exports` mit `./pruner` und `./invariant`, `dependencies`, `dsh`), und Toolchain, Skripte
  und CI wurden auf das einzelne Paket umgezogen. Die verifizierte
  Estimator-Katalog-Registrierung (doppeltes Präfix, bewachte Zwei-Kanal-Aktivierung,
  Anfragebezogene Dienstauflösung, sichtbare Lebenszykluszeilen) wurde mit einer hostseitigen
  Wache auf diese Linie wiederaufgespielt; das Settings-Schema, das `ab2175a` auf `z.any()`
  heruntergestuft hatte, ist wiederhergestellt, sodass die alltäglichen Custom-Defaults wieder
  veröffentlicht werden.
- Anpassung an den offiziellen DeepSeek Harness `v0.1.5-rc.2` auf diesem Zweig. Alle
  `@deepseek-ai/dsh-*`-Dev-Dependencies und der fixierte E2E-Host-Satz wechseln von
  `0.1.1-rc.2` zu `0.1.5-rc.2` (cordis `4.0.2`, schemastery `3.18.2`), einschließlich der neuen
  aufgeteilten Pakete (`dsh-session-projection`, `dsh-session-persistence`, `dsh-atomic-write`,
  `dsh-home-paths`, `dsh-sandbox` und verwandte) und des `dsh-client-store`-Client-Stacks.
- Surface-Replace-Operationen verwenden nun die v3-Form `startSeq`/`endSeq` mit gebrandeten
  `SessionSeq`-Werten; `compaction/prune`-Manifeste behalten die dauerhaften
  `start`/`end`-Felder. Ereignisse werden über Seq-Lookup von Surface-Knoten aufgelöst statt
  über Array-Indizierung.
- Das Client-Bundle importiert die entfernte `@deepseek-ai/dsh-client-runtime` nicht mehr:
  Settings-Typen kommen nun aus `@deepseek-ai/dsh-client-ui-settings`, und die
  Session-Hooks-Merges aus `@deepseek-ai/dsh-client-ui-session`. `engines.dsh
  >=0.1.5-alpha.1 <0.2.0-0` ist in beiden Paketmanifesten und in `dsh.plugin.json` deklariert.
- Harness 0.1.5 exponiert den Sitzungs-`agentPreset` nicht mehr an den Browser, sodass der
  Client Minimal-only-Sitzungen nicht mehr erkennen kann; der Selektor bleibt wählbar, und das
  alte Unavailable-Banner ist unerreichbar.
- Testsuiten für die 0.1.5-Semantik aktualisiert: cordis-Plugin-Starts verlangen `.await()`,
  der Token Meter verlangt ein gemountetes `SessionProjectionRegistry`, Assistant-Ereignisse
  tragen `stream: []`, und Settings-Namespaces sind einfache Strings.

### Behoben

- Die Estimator-Karte verlangt keinen API-Schlüssel mehr auf dem Harness-Host-Kanal. Die Wahl
  des Host-Kanals zeigt die Live-Provider/Model-Dropdowns, benennt die Route, die tatsächlich
  laufen würde (explizite Überschreibung, sonst der Sitzungsstandard), und rendert weder ein
  Schlüsselfeld noch eine zweite manuelle Modelleingabe: Basis-URL, Modell-Textfeld und der
  nur-schreibbare Schlüssel gehören allein zum direkten Endpoint-Kanal.
- `presetOptions`-Schreibvorgänge sind pfadadressiert. Das Schreiben der ganzen Sektion hat sie
  ersetzt, sodass das Anfassen eines zweiten Estimator-Felds (ein Provider, ein Modell, ein
  Endpoint) `estimatorMode` und jeden Nachbar-Override löschte — der Estimator wurde still
  abgeschaltet, während das Panel weiterhin einen erfolgreichen Speichervorgang meldete. Jedes
  Feld schreibt nun nur sich selbst, `undefined` löscht genau das Feld, das es nennt, und die
  Bestätigungslesung validiert denselben Feldsatz statt nur des Modus.
- Neue Abdeckung: `packages/selector/tests/preset-options-write.client.spec.ts`
  (pfadbegrenzte Schreibvorgänge, Nachbarerhaltung, explizite Löschungen, No-op-Patches,
  Meldung uncommitteter Schreibvorgänge) und
  `packages/selector/tests/estimator-channel.client.spec.tsx` (Felder pro Kanal,
  Katalog-Dropdowns, manueller Fallback).


### Hinzugefügt

- Neues Profil `tokenpilot-inspired`: eine vom TokenPilot-Paper inspirierte
  Fähigkeitenmatrix, geschichtet über die Balanced-Schwellwerte, explizit aus der
  Einstellungs-UI wählbar; jedes bestehende Profil behält eine byteidentische aufgelöste
  Richtlinie (erzwungen durch einen Golden-Test mit erfasster Basislinie).
- Byteidentische Deduplizierung wiederholter Tool-Resultate: ein übermäßiges Duplikat wird
  durch einen Zeiger auf das append-only-Ursprungsereignis des ersten Auftretens ersetzt
  (`dedupe-pointer`), mit einem SHA-256-Index pro Sitzung (2048 Einträge, Eviction nach
  Einfügereihenfolge, nur Hash+Seq-Metadaten).
- Guard gegen keinen Nettogewinn: Ersetzungen, deren Text nicht kleiner als das Original ist,
  werden abgelehnt, selbst wenn der exakte Tokenizer eine Token-Ersparnis meldet.
- Recovery-Freistellung: die Ausgabe von Recovery-Tools ist über einen vereinheitlichten
  Freistellungssatz pro Sitzung dauerhaft von jeder Reduktionsrunde ausgenommen und verhindert
  so eine Kompressions-Restauierungs-Oszillation.
- Auto-Compact-Zusammenfassungslokator: nach `compaction/end` erhält den gelandeten
  Zusammenfassungs-Checkpoint einen Exact-Sources-Block (verschatteter Seq-Bereich,
  Spill-Dateien, berührte Dateien), sodass weg-zusammengefasste Details wieder auffindbar
  bleiben; übersprungen, wenn er nichts Konkretes lokalisieren würde.
- Read-State-Semantik: ein historischer Lesevorgang, dessen Datei später mutiert wurde, ist
  `superseded` und nimmt den kleinen Platzhalter des ganzen Resultats; optionales
  error/warn/info-Clustering ausgelassener Zeilen wird an historische Platzhalter angehängt.
- Optionaler Residual-Utility-Estimator (drei Kanäle: off / Harness-Host-Modell / direkter
  OpenAI-kompatibler Endpoint) mit exponentiellem Backoff pro Sitzung, strengem Timeout,
  rein beratenden Urteilen, die die nächste Druckrunde verbraucht, und numerisch-einzelnen
  `estimator-outcome`-Audits. Die Estimator-Karte erscheint nur, solange das neue Profil
  gewählt ist; der API-Schlüssel ist in den Einstellungen nur-schreibbar und gelangt nie in
  die fixierte Richtlinie, Audits oder Protokolle.
- Neue Audit-Einträge: `summary-locator` und `estimator-outcome`; der Rewrite-Eintrag deckt
  die Deduplizierung über den `dedupe-pointer`-Reducer ab. Die Audit-Feld-Allowlists sind
  unverändert.
- Vereinfachte chinesische und englische Texte für das neue Profil und die Estimator-Karte;
  Unit- und Golden-Abdeckung unter `packages/runtime/tests/tokenpilot/`.

- Orthogonales Gate zur Komprimierung von Code-Skeletten (`codeSkeleton.enabled`,
  standardmäßig aus): die erste Exposition eines übermäßigen frischen Quellcode-Tool-Resultats
  kann ein Imports-und-Deklarationen-Skelett mit ausgelassenen Körpern und bewahrten
  Fehlerzeilen behalten und fällt auf die ursprüngliche Kopf-Kürzung zurück. Das Gate ist von
  jedem Profil unabhängig und an die exakte Tokenizer-Messung gebunden.
- Einstellungs-UI-Schalter für das Gate im Selektor-Einstellungsbereich, mit vereinfachten
  chinesischen und englischen Texten.
- Browser/Runtime-Dekode-Parität für die neue Sektion, Confirm-on-write-Vertragstests für
  `saveCodeSkeleton` und eine Erweiterung der Ganzdokument-Paritätsmatrix.

### Geändert

- Eine ESLint-Flat-Config-Baseline hinzugefügt (`pnpm lint`, in CI erzwungen) und eine
  `pnpm test:watch`-TDD-Schleife; tote Imports entfernt und zwei durch die Lint-Baseline
  aufgedeckte Fehlerpfade gehärtet.
- Dieses Repository wird nun als verbesserter Fork von
  `WilliamShi666/dsh-context-compression-selector` gepflegt; die Dokumentation erscheint auf
  Englisch, vereinfachtem Chinesisch, Japanisch und Koreanisch.

## 0.1.0 - 2026-09-03

### Hinzugefügt

- Stabile Veröffentlichung der DeepSeek V4 Flash Vision Tokenizer-Integration für
  `deepseek-v4-flash-vision-exp`, einschließlich exakter Textzählung und begrenzter
  Bild-Token-Schätzungen.
- Benutzerkonfigurierbarer modellgetriebener Auto-Compact-Schwellwert im
  Selektor-Einstellungsbereich.
- Auto-Compact-Schwellwertkopplung an die History-/micro-compact-Wasserzeichen jedes
  Standardprofils und die zugehörigen Kompressionsparameter.

### Geändert

- Der Schwellwert-Editor verwendet nun eine einzige direkte numerische Eingabe; der Slider und
  die fixierten Schnellwert-Buttons wurden entfernt.
- Der Runtime-Zugriff auf Sitzungsereignisse unterstützt sowohl den etablierten
  Harness-`events`-Accessor als auch die neuere öffentliche API `snapshotEvents()`.

## 0.1.0-beta.4 - 2026-09-02

### Behoben

- Unterstützung der offiziellen DeepSeek Harness `dsh-v0.1.2-alpha.5`-öffentlichen API bei
  gleichzeitiger Beibehaltung der Kompatibilität mit dem bestehenden `0.1.1-rc.2`-Peer-Bereich.
  Das Plugin besitzt nun die beiden kleinen unveränderlichen Wert-Helfer, die der neuere
  Harness nicht mehr exportiert, und verwendet dasselbe öffentliche
  `context-compression`-Namespace-Literal, das beide Settings-Implementierungen akzeptieren.
  Kein Harness-Kerncode wird verändert.

## 0.1.0-beta.3 - 2026-09-01

### Umfang

Dies ist eine gestaffelte Veröffentlichung. Exakte **Textklasse**-Token-Zählung für
`deepseek-v4-flash-vision-exp`, nach Bestem bemühte begrenzte **Vision-Klasse-Bild**-Schätzungen
und die Auto-Compact-Schwellwert/UI/Audit-Arbeit werden geliefert. Exakte Bildmessung bleibt
**UPSTREAM BLOCKIERT**: die aktuelle Messungsnaht exponiert weder die projizierten
Request-Bilddimensionen des Adapters noch die absolute serialisierte Position, sodass
Schätzungen nicht zu `exact-tokenizer` befördert werden können.

### Hinzugefügt

- DeepSeek V4 Flash Vision Unterstützung für `deepseek-v4-flash-vision-exp` über einen separat
  gebündelten offiziellen Tokenizer, fixiert auf die Revision
  `6821d6ad3681a4b137b066b76094fa82ebd0a380` von `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`.
  Text, Reasoning, Tool-Call-Argumente und reine Text-Tool-Resultate werden exakt gezählt;
  bildtragende Tool-Result-Kandidaten bleiben fail-open.
- Die Vision-Bild-Token-Arithmetik wurde Zeile für Zeile aus dem offiziellen
  `inference/image_processor.py` portiert (Patchgröße 14, Downsample 3, 384-Token-Obergrenze,
  min pixels 147456, 8:1-Aspect-Klemme und positionsabhängiges Alignment-Padding), validiert
  gegen Golden-Fixtures, die durch Ausführen der offiziellen Python-Implementierung erzeugt
  wurden. Gültige intrinsische Dimensionen erzeugen nun `tokenizer-estimate` am Mittelpunkt
  aller vier Alignment-Residuen mit einer Obergrenze von 384 Tokens pro Bild;
  fehlerhafte oder nicht auswertbare Dimensionen verwenden einen dokumentierten
  256-Token-Fallback. Gemischte Text/Bild-Flächen aggregieren exakten Text und geschätzte
  Bilder, ohne sie zu exakt zu befördern.
- Einstellung `autoCompact.thresholdPercent` (Standard 80, Ganzzahl 50–90, Schritt 1) mit einem
  gemeinsamen Validierungsvertrag über die Einstellungs-UI, das persistierte Schema und den
  Runtime-Resolver. Der Editor lebt innerhalb des
  context-compression-Selektor-Einstellungsbereichs.
- History-Kopplung der Standardprofile an das Auto-Compact-Wasserzeichen: `A = floor(C × a)`
  skaliert den History-Trigger, die Mindestzurückgewinnung und den Recent-Token-Tail um;
  `D = floor(A × 0.875)` ersetzt das fixe Kapazitätsdruckverhältnis 0.7 als
  Letzte-Chance-Gate des Micro-Compacts; ein Batch muss seine Cache-Unterbrechung rechtfertigen,
  indem er die vollständige Anfrage unter die Frist zurückzieht. Defaults bei 80 % reproduzieren
  die bisherigen Zahlen exakt.
- Das Preset-Overlay schreibt den gespeicherten Schwellwert in die generierte
  `compaction-basic`-Komposition als `thresholdRatio` (mit `retainRatio` fixiert auf 0.16) und,
  aus derselben Lesung, in die Deployment-Konfiguration der Plugin-Runtime als
  `autoCompactThresholdPercent`, sodass eine laufende Generation nie Auto Compact und
  Micro Compact auf zwei verschiedenen Schwellwerten betreibt. Jede
  Generationsidentitätsänderung — Schwellwert, Quelle oder Modulpfade, auch bei gleicher Länge —
  erzeugt eine neue Standing-Composition-Generation. Deterministische identitätsabgeleitete
  Stempel nutzen ein 8-hex-Ganzsekundenfenster; gleichpräfixige Identitäten können in diesem
  ersten Fenster auf einem groben Dateisystem kollidieren, sodass das Overlay den echten
  `mtimeMs+size`-Schlüssel der Staging-Datei beobachtet und vor dem atomaren Umbenennen zu
  späteren Hash-Fenstern eskaliert. Inhalt, Berechtigungen und der endgültige eindeutige Stempel
  sind vor der Veröffentlichung vollständig; bereits laufende Sitzungen behalten ihre fixierte
  Richtlinie.
- `policy-resolved`-Audits zeichnen nun die Auto-Compact-Koordinationsfakten auf
  (Schwellwertprozent, `A`, `D`, Parameterquelle — einschließlich
  `deployment-override`/`mixed`, wenn die Deployment-Konfiguration die gekoppelten
  History-Wasserzeichen ersetzt), den gerouteten Provider/das geroutete Modell und die
  Identität des gebündelten Tokenizers.
- Persistierte Einstellungen weisen vorhandene-aber-ungültige Sektionen zurück
  (`profile: null`, `custom: null`, eigenes-Property `undefined`), bevor ein Schema-Default sie
  absorbieren kann; ein fehlerhaftes gespeichertes Dokument friert die Sitzung verlustfrei ein
  (`profile: off`, auditiert als `settingsInvalidFallback: lossless-off`), statt still den
  verlustbehafteten Balanced-Default zu aktivieren. Der Browser-Dekoder wendet dieselbe Regel
  an und kanonisiert Legacy-Custom-v1/v2-Dokumente zu demselben v3-Dokument, das der
  Runtime-Resolver erzeugt.
- Der History-Planer gibt ein diskriminiertes Ergebnis zurück, und
  `component-evaluation`-Audits unterscheiden die vollständige Überspringungstaxonomie:
  `below-profile-trigger`, `below-micro-deadline`, `exact-tokenizer-unavailable`,
  `no-safe-candidates` (nur Recovery-Tool-Ausgabe oder bereits geräumte Resultate),
  `protected-working-set` (alles innerhalb des geschützten Tails), `insufficient-reclaim` und
  `cannot-reach-deadline-target` (mit den erreicht/erforderlich-Token-Zahlen),
  `adaptive-cost-rejected` und `recovery-tool-unavailable`.

### Bekannte Einschränkungen

- Bilder beanspruchen nie exakte Zählungen. Die offizielle Expansion hängt von der absoluten
  Prompt-Position ab (Systemprompt, Chat-Template-Rahmung, Adapter-Bild-Handles) und von der
  finalen Request-Bild-Projektion des Adapters (einschließlich
  `imagePixelBudget`/`imageDetail`-Overrides pro Route und der Byte-Cap-Reprojektion); nichts
  davon wird über die aktuelle Messungsnaht exponiert. Intrinsische/Default-Schätzungen können
  sich daher wesentlich von der Abrechnung des Anbieters unterscheiden. Upstream-Fähigkeitswünsche
  bleiben projizierte Request-Bilddimensionen und die absolute serialisierte Position, exponiert
  an Token-Meter-Erweiterungen.
- History überspringt den ganzen Batch, sobald ein Tool-Result-Kandidat eine exakte Zählung
  fehlt, einschließlich bildtragender Kandidaten, obwohl benachbarte Textkandidaten
  einzeln exakt sind.
- Custom bleibt manueller Token-Modus; seine History-Parameter folgen dem
  Auto-Compact-Wasserzeichen nicht.
- Eine Vision-Token-Aufschlüsselungs-UI wird nicht ausgeliefert; Bildschätzungen und die
  intrinsische Alignment-Diagnose sind auf der gemessenen Token-Ansicht verfügbar, während
  verlustbehaftete Rewrite-Nachweise weiterhin exakte Zählungen erfordern.

### Zurückgestellt

- Audit-Feld `modality` und der Tokenizer-Artefakt-SHA-256 in Audit-Einträgen (die Audits
  tragen bereits den gerouteten Provider/das geroutete Modell und die Tokenizer-Identität).
- Veröffentlichung der (nun vollständigen) Runtime-Taxonomie der Überspringungsgründe als
  benutzerseitige Dokumentationstabelle.
- Anzeige der A/D-Wasserzeichen für das Custom-Profil und einer Warnung oberhalb von D; Custom
  bleibt vollständig manuell.
- Vision-Token-Aufschlüsselungs-UI und Beförderung von Bildschätzungen zu exakter Messung.

## 0.1.0-beta.2 - 2026-08-28

### Behoben

- Die offizielle DeepSeek V4 Flash Tokenizer-Route auflösen, damit Fresh und Aggregate
  Tool-Resultate für die unterstützten V4-Modelle bewerten können.
- Cache Strict History an der echten Anfragegrenze ausführen, sobald seine konfigurierte
  Kapazitätsdruckbedingung erfüllt ist; die Kapazitätsbedingung bei 70 %
  gerouteter-Kontext-Auslastung auslösen.
- Das Harness-native Kopf/Mitte/Tail-Pruning von Tool-Resultaten deaktivieren, sobald ein
  Selektor-Profil aktiv ist, und den Selektor als einzigen Tool-Result-Kompaktor belassen.

### Geändert

- Die neuesten 10 Agent-Tool-Aufrufe und ein 64.000-Token-Tool-Result-Tailfenster schützen,
  bevor History/microcompact ältere Resultate umschreibt.

## 0.1.0-beta.1 - 2026-08-27

### Hinzugefügt

- Einmalinstallations-DeepSeek-Harness-Produktbundle, gestützt auf ein separates
  Runtime-Paket in exakter Version.
- Web-Profil-Selektor mit preset-stabilen Einstellungen und einer expliziten eingebauten
  Minimal-Ausnahme.
- Fresh, Aggregate, routinen-/kapazitätsbewusste History, natives Tool-Result-Pruning und
  standardmäßig ausgeschaltetes Custom TailTrim.
- Standard-Ereignis-TailTrim-Protokoll mit `compaction/prune` plus wiederherstellbarem
  `user/message`-Ersatz.
- Plugin-eigenes Recovery-Tool `context_compression_retrieve`.
- Strukturierte, inhaltsfreie Audit-Einträge für Richtlinie, Bewertung, Rewrite, Fehler und
  nativen Auto-Compact.
- Fixierte offizielle DeepSeek-V4-Tokenizer-Assets mit Laufzeit-SHA-256-Validierung und
  Upstream-Lizenz.
- Public-API-Komponenten-E2E-, Preset/Minimal- und Parent/Fork/Spawn-Cache-Präfix-Regressionstests.

### Kompatibilität

- Verifiziert gegen die öffentlichen DeepSeek-Harness-Pakete `dsh-v0.1.1-rc.2`.
- Exaktes Tokenizer-Mapping ist derzeit auf `deepseek-v4-flash` und `deepseek-v4-pro` beschränkt.

### Bekannte Einschränkungen

- Adaptive gewöhnliche History fällt geschlossen aus, wenn öffentliche Anfrageebenen-Route/
  Cache-Beweise unvollständig sind; Kapazitätsdruck bleibt eine separate Sicherheitsübersteuerung.
- Cache-Präfix-Tests beweisen native Fork-Vererbung und identische serialisierte Präfixe,
  keine anbieterspezifische Cache-Zuteilung und keinen garantierten DeepSeek-Cache-Treffer.
- Settings-Snapshots und First-Exposure-Entscheidungen sind prozesslokal zum gemounteten
  Runtime.
