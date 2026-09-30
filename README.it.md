# dsh-context-compression-improved

> Un fork migliorato di [dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector) — un selettore verificabile di compressione del contesto dei risultati degli strumenti per DeepSeek Harness — con l'aggiunta di un **gate di compressione degli scheletri di codice** ortogonale.

[English](README.md) · [中文说明](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Registro delle modifiche](CHANGELOG.it.md) · [Guida all'installazione](docs/installation.it.md)

> [!NOTE]
> **Cosa aggiunge questo fork rispetto all'upstream 0.1.0:**
>
> - Un **gate di compressione degli scheletri di codice** ortogonale (`codeSkeleton.enabled`, disattivato per impostazione predefinita): alla prima esposizione di un risultato strumento di codice sorgente fresco e troppo grande è possibile conservare uno scheletro di import e dichiarazioni — corpi elisi, righe di errore preservate — prima che escano i riduttori regolari.
> - Un interruttore per quel gate nella stessa sezione di impostazioni del selettore, indipendente da ogni profilo di compressione.
> - Una baseline ESLint collegata alla CI, un ciclo TDD `test:watch` e documentazione in inglese, cinese semplificato, giapponese e coreano.

> [!IMPORTANT]
> Questo progetto supporta **solo modelli DeepSeek**. La misura senza perdita e la compressione con perdita dipendono dai tokenizer DeepSeek ufficiali inclusi (`deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`). Tutto il resto fallisce in modo aperto (fail-open) e conserva i risultati degli strumenti originali. Vedere il [README upstream](https://github.com/WilliamShi666/dsh-context-compression-selector#model-support-and-safety) per il modello di sicurezza completo.

## Che cos'è

Le attività degli agenti di lunga durata accumulano grandi quantità di output degli strumenti. Questo plugin della community aggiunge politiche selezionabili e verificabili per ridurre questo contesto di risultati degli strumenti senza modificare il core di DeepSeek Harness:

- **Fresh** precomprime un nuovo segmento di risultato strumento divenuto troppo grande prima che il modello lo riceva.
- **Aggregate** precomprime nuovamente il materiale fresco quando continua a superare il proprio budget.
- **History / micro-compact** sostituisce i vecchi risultati degli strumenti idonei preservando il contesto di lavoro recente.
- **TailTrim** è un percorso facoltativo di riduzione della coda, solo per Custom.
- **Native** conserva il taglio testa/centro/coda in stile Harness come profilo esplicito.
- **Scheletro di codice (nuovo, gate ortogonale)** — vedere sotto.

Ogni decisione viene registrata: fase, riduttore, trigger, motivo del salto e conteggi esatti dei token dove disponibili.

## Gate dello scheletro di codice (nuovo)

Quando il gate è attivo, un **risultato strumento di codice sorgente fresco** troppo grande (per esempio un grande `read_file`) tenta prima una riduzione a scheletro: import e dichiarazioni di tipi/funzioni/classi vengono conservati, i corpi delle funzioni vengono elisi con un marcatore e le righe di errore all'interno dei corpi elisi vengono preservate. Se lo scheletro non può essere prodotto o verificato, il risultato torna all'originale potatura della testa — il gate non può mai peggiorare il contesto.

Proprietà:

- **Ortogonale**: indipendente dal profilo selezionato (`balanced`, `savings`, `cache-strict`, `adaptive`, `custom`, `off`, `native`). Tutti i profili ricevono il gate.
- **Disattivato per impostazione predefinita**: `codeSkeleton: { enabled: false }` finché non lo si attiva.
- **Vincolato alla misura**: richiede il tokenizer DeepSeek esatto; senza di esso il plugin fallisce in modo aperto (fail-open).
- **Congelato per sessione**: come tutte le impostazioni del selettore, le modifiche interessano solo le sessioni osservate da quel momento in poi.
- **Analisi rigorosa**: `codeSkeleton` deve essere esattamente `{ enabled: boolean }`; i valori malformati generano un errore lato runtime e appaiono come illeggibili nell'interfaccia del browser.

## UI delle impostazioni

Scegliere un profilo di compressione, impostare il livello di attivazione dell'Auto Compact e attivare la compressione a scheletro di codice nella stessa sezione di impostazioni. L'interruttore salva alla modifica e mostra lo stato salvato al ricaricamento.

![UI delle impostazioni di Context Compression Selector](docs/assets/context-compression-selector-settings.png)

## Installazione

**Consigliato: installare da npm.** Un dist-tag per linea Harness — `dsh-0.2.0` per la linea 0.2.0 (questo ramo), `dsh-0.1.7` per la linea 0.1.7, `dsh-0.1.5` per la linea 0.1.5, `dsh-0.1.2` per la linea 0.1.2.

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

Dai sorgenti (alternativa — i nomi interni dei pacchetti restano volutamente quelli dell'upstream):

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

Poi pacchettizzare il pacchetto selettore e aggiungerlo a un profilo Harness — la procedura completa, inclusi verifica e disinstallazione, si trova nella [guida all'installazione](docs/installation.md).

## Sviluppo

```sh
pnpm install --frozen-lockfile
pnpm lint          # ESLint baseline (also enforced in CI)
pnpm typecheck     # runtime + selector + tests tsc, plus the bundle step
pnpm test          # full vitest suite
pnpm test:watch    # TDD loop: write the failing regression first, then make it pass
pnpm build
pnpm verify:release
```

I contributi seguono la disciplina upstream: aggiungere prima la regressione che fallisce, mantenere ogni modifica di produzione all'interno di questo repository e spiegare separatamente le prove «triggered», «enabled but skipped» e fail-open. Vedere [CONTRIBUTING.md](CONTRIBUTING.md).

## Compatibilità

- Compilato e testato contro la release ufficiale DeepSeek Harness `dsh-v0.2.0-rc.1`; i peer dichiarano `>=0.2.0-rc.1 <0.2.1-0` e il plugin usa solo API pubbliche di plugin e profilo. Le linee precedenti restano servite dai propri dist-tag (`dsh-0.1.7`, `dsh-0.1.5`, `dsh-0.1.2`).
- Richiede Node `^22.19.0 || >=24` e pnpm `11.7.0`.
- Il plugin usa solo API di estensione pubbliche del Harness e non modifica il codice del core del Harness. Progetto comunitario non ufficiale, non affiliato né approvato da DeepSeek.

## Crediti e licenza

- Progetto upstream e lavori precedenti: [WilliamShi666/dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector) di WilliamShi666 (MIT).
- Aggiunte del fork (gate dello scheletro di codice, tooling, documentazione localizzata): drscrewdriver.
- MIT — vedere [LICENSE](LICENSE) (nota di copyright upstream conservata) e [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) per la provenienza dei tokenizer inclusi.
