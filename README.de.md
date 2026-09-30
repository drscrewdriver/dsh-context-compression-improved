# dsh-context-compression-improved

> Ein verbesserter Fork von [dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector) — ein prüfbarer Selektor zur Kontextkompression von Tool-Ergebnissen für den DeepSeek Harness — ergänzt um ein orthogonales **Gate zur Komprimierung von Code-Skeletten**.

[English](README.md) · [中文说明](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Änderungsprotokoll](CHANGELOG.de.md) · [Installationsanleitung](docs/installation.de.md)

> [!NOTE]
> **Was dieser Fork zusätzlich zum Upstream 0.1.0 bietet:**
>
> - Ein orthogonales **Gate zur Komprimierung von Code-Skeletten** (`codeSkeleton.enabled`, standardmäßig aus): Bei der ersten Exposition eines übermäßigen frischen Quellcode-Tool-Ergebnisses kann ein Skelett aus Imports und Deklarationen behalten werden — Funktionskörper ausgelassen, Fehlerzeilen bewahrt — bevor die regulären Reducer laufen.
> - Ein Schalter für dieses Gate im selben Selektor-Einstellungsbereich, unabhängig von jedem Kompressionsprofil.
> - Eine in die CI integrierte ESLint-Baseline, eine `test:watch`-TDD-Schleife und Dokumentation in Englisch, vereinfachtem Chinesisch, Japanisch und Koreanisch.

> [!IMPORTANT]
> Dieses Projekt unterstützt **ausschließlich DeepSeek-Modelle**. Verlustfreie Messung und verlustbehaftete Kompression hängen von den mitgelieferten offiziellen DeepSeek-Tokenizern ab (`deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`). Alles andere fällt offen aus (fail-open) und behält die ursprünglichen Tool-Ergebnisse bei. Das vollständige Sicherheitsmodell finden Sie im [Upstream-README](https://github.com/WilliamShi666/dsh-context-compression-selector#model-support-and-safety).

## Was es ist

Langlaufende Agent-Aufgaben sammeln große Mengen an Tool-Ausgaben an. Dieses Community-Plugin fügt auswählbare, prüfbare Richtlinien hinzu, um diesen Tool-Ergebnis-Kontext zu reduzieren, ohne den Kern des DeepSeek Harness zu verändern:

- **Fresh** komprimiert ein neu übermäßiges Tool-Ergebnis-Segment vor, bevor das Modell es erhält.
- **Aggregate** komprimiert frisches Material erneut vor, wenn es weiterhin sein Budget überschreitet.
- **History / micro-compact** ersetzt geeignete alte Tool-Ergebnisse und bewahrt den kürzlichen Arbeitskontext.
- **TailTrim** ist ein optionaler Endreduktionspfad, der nur im Custom-Modus verfügbar ist.
- **Native** bewahrt das Harness-typische Kürzen von Kopf/Mitte/Ende als ein explizites Profil.
- **Code-Skelett (neu, orthogonales Gate)** — siehe unten.

Jede Entscheidung wird protokolliert: Phase, Reducer, Auslöser, Überspringungsgrund und exakte Token-Zahlen, wo verfügbar.

## Code-Skelett-Gate (neu)

Ist das Gate aktiviert, versucht ein übermäßiges **frisches Quellcode-Tool-Ergebnis** (zum Beispiel ein großes `read_file`) zuerst eine Skelett-Reduktion: Imports und Typ-/Funktions-/Klassendeklarationen bleiben erhalten, Funktionskörper werden mit einem Marker ausgelassen und Fehlerzeilen innerhalb ausgelassener Körper bleiben bewahrt. Wenn das Skelett nicht erzeugt oder verifiziert werden kann, fällt das Ergebnis auf die ursprüngliche Kopf-Kürzung zurück — das Gate kann den Kontext nie verschlechtern.

Eigenschaften:

- **Orthogonal**: unabhängig vom gewählten Profil (`balanced`, `savings`, `cache-strict`, `adaptive`, `custom`, `off`, `native`). Alle Profile erhalten das Gate.
- **Standardmäßig aus**: `codeSkeleton: { enabled: false }`, bis Sie es einschalten.
- **Messungsgebunden**: erfordert den exakten DeepSeek-Tokenizer; ohne ihn fällt das Plugin offen aus (fail-open).
- **Sitzungsfixiert**: wie alle Selektor-Einstellungen wirken Änderungen nur auf neu beobachtete Sitzungen.
- **Streng geparst**: `codeSkeleton` muss exakt `{ enabled: boolean }` sein; fehlerhafte Werte werfen auf der Runtime-Seite einen Fehler und erscheinen im Browser-UI als unlesbar.

## Einstellungs-UI

Wählen Sie ein Kompressionsprofil, stellen Sie den Auto-Compact-Auslösepegel ein und schalten Sie die Code-Skelett-Kompression im selben Einstellungsbereich um. Der Schalter speichert bei jeder Änderung und zeigt den gespeicherten Zustand beim Neuladen.

![Einstellungs-UI des Context Compression Selector](docs/assets/context-compression-selector-settings.png)

## Installation

**Empfohlen: Installation über npm.** Ein Dist-Tag pro Harness-Linie — `dsh-0.2.0` für die 0.2.0-Linie (dieser Zweig), `dsh-0.1.7` für die 0.1.7-Linie, `dsh-0.1.5` für die 0.1.5-Linie, `dsh-0.1.2` für die 0.1.2-Linie.

```sh
dsh plugin --profile web add dsh-context-compression-improved@dsh-0.2.0
# DSH 0.1.7 line:
# dsh plugin --profile web add dsh-context-compression-improved@dsh-0.1.7
# DSH 0.1.5 line:
# dsh plugin --profile web add dsh-context-compression-improved@dsh-0.1.5
# DSH 0.1.2 line:
# dsh plugin --profile web add dsh-context-compression-improved@dsh-0.1.2
dsh --profile web --dump-config
```

Aus dem Quellcode (Alternative — die internen Paketnamen bleiben absichtlich die des Upstreams):

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

Packen Sie anschließend das Selektor-Paket und fügen Sie es einem Harness-Profil hinzu — die komplette Anleitung inklusive Verifikation und Deinstallation finden Sie in der [Installationsanleitung](docs/installation.md).

## Entwicklung

```sh
pnpm install --frozen-lockfile
pnpm lint          # ESLint baseline (also enforced in CI)
pnpm typecheck     # runtime + selector + tests tsc, plus the bundle step
pnpm test          # full vitest suite
pnpm test:watch    # TDD loop: write the failing regression first, then make it pass
pnpm build
pnpm verify:release
```

Beiträge folgen der Upstream-Disziplin: zuerst die fehlgeschlagene Regression hinzufügen, jede Produktionsänderung in diesem Repository halten und „triggered“, „enabled but skipped“ und Fail-open-Belege getrennt erklären. Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Kompatibilität

- Gegen die offizielle DeepSeek Harness `dsh-v0.2.0-rc.1`-Veröffentlichung gebaut und getestet; die Peers deklarieren `>=0.2.0-rc.1 <0.2.1-0`, und das Plugin nutzt ausschließlich öffentliche Plugin- und Profil-APIs. Frühere Linien werden weiterhin über ihre eigenen Dist-Tags bedient (`dsh-0.1.7`, `dsh-0.1.5`, `dsh-0.1.2`).
- Erfordert Node `^22.19.0 || >=24` und pnpm `11.7.0`.
- Das Plugin nutzt nur öffentliche Harness-Erweiterungs-APIs und verändert keinen Harness-Kerncode. Inoffizielles Community-Projekt, weder mit DeepSeek verbunden noch von ihm unterstützt.

## Danksagungen und Lizenz

- Upstream-Projekt und frühere Arbeiten: [WilliamShi666/dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector) von WilliamShi666 (MIT).
- Fork-Ergänzungen (Code-Skelett-Gate, Tooling, lokalisierte Dokumentation): drscrewdriver.
- MIT — siehe [LICENSE](LICENSE) (Upstream-Copyright-Hinweis beibehalten) und [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) zur Herkunft der mitgelieferten Tokenizer.
