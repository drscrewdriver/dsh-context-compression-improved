# Registro delle modifiche

> [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [日本語](CHANGELOG.ja.md) · [한국어](CHANGELOG.ko.md)

Tutte le modifiche rilevanti sono annotate in questo file. Il progetto segue il versionamento semantico dopo `0.1.0`.

## 0.8.0-beta.1 - 2026-09-30

### Modificato

- Linea di compatibilità Harness 0.2.0: tutti i 23 intervalli di peer `@deepseek-ai/dsh-*` sono
  passati a `>=0.2.0-rc.1 <0.2.1-0`, e `engines.dsh` segue in tutti e tre i manifesti (radice,
  pacchetto selettore, manifest del plugin). `publishConfig.tag` diventa `dsh-0.2.0`; la linea
  0.1.7 resta servita da `dsh-0.1.7` (ora `0.7.0-beta.1`), le linee 0.1.5/0.1.2 dai propri
  dist-tag.
- 39 dei 41 override bloccati e 46 delle 48 dev-dependencies passano a `0.2.0-rc.1`;
  `@deepseek-ai/dsh-agent-presets` (`0.1.6-alpha.2`) e `@deepseek-ai/dsh-code-runtime`
  (`0.1.5-rc.3`) conservano il loro blocco — nessuno dei due pacchetti ha una release sulla
  linea 0.2.0.
- Porte di rilascio riorientate: il pin harness dell'e2e con installazione pacchettizzata ora
  clona l'albero ufficiale `dsh-v0.2.0-rc.1` (`4878cdab`), e il test di contratto degli
  artefatti costruiti asserisce lo slot client `configForms` (rinominato da `settingsScope`
  sulla linea 0.1.7).

## 0.6.5 - 2026-09-29

### Corretto

- Allineamento delle dev-dependencies alla linea Harness 0.1.7: 46 delle 48 `@deepseek-ai/dsh-*`
  dev-dependencies passano dal pin preciso `0.1.5-rc.2` al pin preciso `0.1.7-rc.2`,
  e `pnpm-lock.yaml` è stato rigenerato da un albero pulito. Typecheck, build, test, lint e
  `verify:release` girano ora contro la vera baseline 0.1.7-rc.2 invece di validare le
  adattazioni 0.1.7 su input 0.1.5 (un verde falso). Due pacchetti non hanno alcuna release
  sulla linea 0.1.7 e conservano i valori bloccati all'installazione:
  `@deepseek-ai/dsh-agent-presets` (`0.1.6-alpha.2`) e `@deepseek-ai/dsh-code-runtime`
  (`0.1.5-rc.3`). `react-dom` ottiene una dev-dependency esplicita `^18.2.0` così che una
  risoluzione pulita non possa abbinare React-DOM 19 a React 18 nelle suite di test.
- La cucitura delle impostazioni dell'host di test è stata ricostruita contro il vero host
  0.1.7: `SettingsProvider` non esiste più in `@deepseek-ai/dsh-settings` (sostituito dai
  `SettingsForms` dichiarativi), mentre il plugin conserva la lettura legacy
  `ctx.settings.get(ns)` come fallback alla forma dell'host. Le spec montano ora una copia
  vendored del provider 0.1.5-rc.2 (`tests/helpers/legacy-settings/`) per esercitare esattamente
  quel fallback, e il registrar dei namespace legacy restringe il servizio alla cucitura. Il
  test live del harness DeepSeek registra il provider attraverso la cucitura dell'adattatore
  0.1.7 invece del plugin autonomo `llm-deepseek` rimosso.
- Adattamenti dei test emersi dalla vera baseline: le fixture del motore di compaction passano
  `headroomTokens: 0` (0.1.7-rc.2 imposta per default un headroom di compaction di 65536 token,
  che ingoia le finestre di sonda da 1k token delle fixture), e l'asserzione degli asset dei
  risultati strumento segue la forma di messaggio di primo livello `role: 'tool'` (nessun
  blocco di contenuto `tool-result` avvolgente).
- Porte di rilascio ribloccate sulla release ufficiale 0.1.7: `verify-release.mjs` e l'e2e
  pacchettizzato asseriscono ora peer del selettore `>=0.1.7-rc.1 <0.2.0-0`, e il clone
  ufficiale del harness dell'e2e pacchettizzato asserisce il tag `dsh-v0.1.7-rc.2`
  (commit `477b4f42`, albero `e3e63253`).
- `packages/selector/dsh.plugin.json` ora riporta la versione di rilascio (0.6.5; ogni 0.6.x
  precedente la spediva congelata a 0.1.0) e dichiara l'onesto intervallo del motore
  `>=0.1.7-rc.1 <0.2.0-0`.
- Il debito di lint dagli adattamenti manuali 0.6.3 è stato estinto: import/locali inutilizzati
  rimossi in `src/index.ts`, `src/client/index.ts`, `src/pruner.ts` e tre spec host; la
  scansione dei residui di staging della generazione in corso ora è limitata allo store della
  spec stessa, così che una spec che pubblica in parallelo non possa farla fallire.

## 0.6.4 - 2026-09-26

### Corretto

- Il binder di locale del client è eager: cambiare la locale dell'host ora ri-renderizza
  l'interfaccia delle impostazioni di compressione senza un remount.
- Rilasciata da uno stash e mai committata su alcun ramo (l'albero di lavoro che l'ha
  pubblicata è andato perso); compat/0.1.7 ha ripristinato il contenuto esatto in 0.6.5 e l'ha
  verificato byte per byte contro il tarball del registry prima di continuare.

## 0.5.4 - 2026-09-20

### Corretto

- La superficie di installazione dichiara `@deepseek-ai/schemastery` come dipendenza runtime. Il
  runtime pacchettizzato la importa incondizionatamente (`import z from '@deepseek-ai/schemastery'`
  in `packages/selector/lib/index.js`, `lib/pruner.js` e `lib/advisor-state.js`), ma 0.5.3 non la
  dichiarava da nessuna parte leggibile da un'installazione consumatrice: il manifest radice
  spedito elencava solo `@huggingface/tokenizers` e `js-yaml`, e
  `packages/selector/package.json` la dichiarava come peer, che nessun gestore di pacchetti
  consulta per un pacchetto annidato che installa. La risoluzione dipendeva quindi da un
  pacchetto installato non correlato che issasse `@deepseek-ai/schemastery` nel profilo. In
  un'installazione pulita l'import ricadeva nel fallback dei moduli condivisi dell'installazione
  Harness in `$DSH_HOME/profiles/node_modules`; quando quel fallback non conteneva alcun
  pacchetto costruito, ogni voce di plugin falliva il caricamento e l'host si avviava senza lo
  strato Bundle. Entrambi i manifesti ora bloccano `3.18.2`, la versione contro cui questa
  release è costruita e testata, e il pacchetto selettore non rivendica più un obbligo di peer
  che non ha.

### Aggiunto

- `verify:release` deriva le dipendenze della superficie di installazione dagli identificatori
  nudi importati dai file del runtime pacchettizzato, invece di nominare a mano
  `@huggingface/tokenizers` e `js-yaml`. Quali pacchetti viaggiano con il plugin e quali
  fornisce l'installazione Harness è una lista rivista, e un import il cui fornitore non è in
  alcun manifest fa fallire la porta con il nome mancante. La porta è stata aggiunta come
  controllo negativo contro i manifest non corretti, dove falliva su `@deepseek-ai/schemastery`.

## 0.5.3 - 2026-09-20

### Corretto

- La patch del Bundle non imposta più il flag della rotta di review ritirata. `reviewQueueRoute`
  era stata rimossa dallo schema Config del plugin quando la gate di review è stata ritirata,
  ma era rimasta in `packages/selector/cordis.patch.yml`, dove pubblicizzava una rotta che non
  può mai registrarsi. Gli host oggi tollerano la chiave sconosciuta (il plugin si carica e
  serve — verificato su un host live), quindi è un difetto di configurazione stantia piuttosto
  che una rottura, ma romperebbe su qualsiasi host che validi rigorosamente la configurazione
  dei plugin.
- Gli artefatti generati sono bloccati su LF (`packages/selector/lib/** text eol=lf`). Con
  `core.autocrlf=true` ogni checkout riscriveva i `lib/**` committati in CRLF, così che ogni
  cambio di ramo o merge lasciava l'intera directory degli artefatti segnalata come modificata
  con differenze di solo EOL. Nulla è mai stato committato da quello stato, ma rendeva ogni
  albero sporco all'apparenza e poteva nascondere una vera modifica a un artefatto.

### Aggiunto

- Un pin di contratto a controllo negativo sulla patch del Bundle: fallisce quando una chiave di
  configurazione ritirata è impostata nella patch (asserito sulle righe che impostano chiavi,
  così il commento esplicativo può ancora nominare la chiave), e richiede che il flag live
  `estimatorCatalogRoute` resti cablato.

### Test

- Il contratto del posto client blocca anche la degradazione su host più vecchi: un host che
  non dichiara il posto rifiuta la registrazione al confine dello slot, e `apply()` deve
  ingoiarla e avvisare invece di trascinare giù con sé ogni voce di impostazioni.

## 0.5.2 - 2026-09-20

### Modificato

- La pipeline di review con cancello umano (beta) è **ritirata**. La sua semantica è sostituita
  dal consiglio: il modello di beneficio prezza ancora ogni passata come UNA mutazione fusa,
  ma la banda che calcola (`profitable` / `high-impact` / `slow-payback` / `unpriceable` /
  `not-worth-it`) è ora pubblicata come record di audit `reduction-advice` e istantaneizzata
  sulla rotta del report dell'advisor — non trattiene, ritarda o riscrive mai una riduzione. La
  gate contraddiceva il requisito stesso della funzione (una riduzione non deve mai bloccare
  l'elaborazione automatica) e, con i default spediti (`reviewMode` attivo più una soglia
  high-impact di 4.000 token contro un trigger fresh di 8.192 token), dirottava il 100% di un
  lotto fresh verso la review umana, lasciando il percorso automatico di fatto spento per chi
  l'avesse attivata. Le soglie del consiglio sono ora costanti di modulo (α `0.1`, high-impact
  `4.000` token): nulla agisce su di esse, quindi non sono più impostazioni.
- Ritirati con la gate: la coda di review e il suo adattatore `storageDomain`, il registro a
  livello di processo, le rotte HTTP `review-queue` / `review-decide` e il flag di deployment
  `reviewQueueRoute`, il pannello client `shell.overlay`, le chiavi di impostazioni
  `reviewMode` / `reviewTimeoutTurns` / `cacheHitDiscountAlpha` / `reviewHighImpactTokens`
  e il tipo di audit `review-outcome`. Le quattro chiavi di impostazioni restano ACCETTATE e
  IGNORATE da entrambi i decodificatori — un documento esistente (quello live porta
  `reviewMode: false`) si carica ancora e rende ancora la sua scheda di impostazioni — e non
  raggiungono mai la policy risolta. La rotta di sola lettura `GET .../advisor-report` serve
  inoltre `lastAdvice`.

### Aggiunto

- Pin di regressione per il ritiro: una spec di integrazione host guida esattamente le
  impostazioni che dirottavano tutto (`reviewMode: true`, `reviewHighImpactTokens: 1`) e
  asserisce che il lotto fresh ATTERRA, descritto da un record di consiglio `high-impact`; una
  spec di contratto di deprecazione blocca accept-and-ignore per le chiavi ritirate sia sul
  parser runtime sia sul decodificatore browser.

### Rollback

- Reinstallare l'ultima release che spedisce ancora la gate: `npm dist-tag add
  dsh-context-compression-improved@0.5.1 dsh-0.1.5 --registry https://registry.npmjs.org/`
  poi `dsh plugin --profile web add dsh-context-compression-improved@0.5.1`.

## 0.5.1 - 2026-09-20

### Corretto

- La composizione concorrente dell'overlay di preset di una stessa identità non fallisce più
  su Windows. La pubblicazione ora è serializzata per percorso di destinazione, e quando la
  rinomina atomica perde comunque la gara si conferma che la destinazione porti già la chiave
  permanente `{mtimeMs, size}` del file di staging prima che la pubblicazione riporti successo.
  Windows `MoveFileEx` riporta la gara persa come `EPERM`/`EBUSY` dove il `rename` POSIX
  sostituisce semplicemente la destinazione, il che faceva lanciare `standingKeyFor()` durante
  l'avvio concorrente delle sessioni. Una destinazione che non corrisponde fallisce comunque
  rumorosamente, così una generazione riutilizzata in silenzio resta vietata.
- Riparazioni a porte di rilascio e test che nascondevano questo e altre porte rosse
  preesistenti: identificatori stanti e una ragione di audit ritirata negli smoke pacchettizzati,
  un'attesa di client-inject stantia e trappole di spawn solo-Windows (`git` e gli script
  `node -e` multilinea erano instradati attraverso `cmd.exe`, che riscriveva i loro argomenti).

## 0.5.0 - 2026-09-20

### Aggiunto

- Relevance advisor consultivo (solo statistiche e suggerimenti, spento per default): a ogni
  confine di turno una passata fire-and-forget riassume la semantica della tail-task della
  sessione dall'evento `todo/write` più recente (con fallback sul recente testo utente),
  assegna in modo incrementale punteggi di rilevanza contenuto-e-commenti ai candidati storici
  di risultati strumento rispetto all'attività corrente, e calcola una cifra di decadimento del
  prefisso (media di rilevanza pesata per pressione di caratteri). I vecchi segmenti a bassa
  rilevanza vengono marcati `recertified` come suggerimenti per future decisioni di
  aggressività della history — nulla li consuma in questo giro, e l'output dell'advisor non può
  mai sopprimere, ritardare o riscrivere alcuna riduzione destinata ad atterrare (bloccato da
  un test di invariante dedicato). Configurazione tramite le chiavi di impostazioni
  `presetOptions.advisor*` (`advisorMode` `''|'host'|'direct'`, default `''`; il canale direct
  riusa l'endpoint dell'estimatore; `SideChannel` ha ottenuto un parametro opzionale di
  override così che il trasporto dell'estimatore sia condiviso senza condividere la sua
  configurazione). Osservabilità: nuovi record di audit `advisor-outcome` (senza contenuto, uno
  per fase: summary / scoring / decay) e una rotta HTTP di sola lettura
  `GET .../advisor-report?sessionId=` (flag di deployment opzionale `advisorReportRoute`,
  sullo stampo delle rotte di review). L'interfaccia client è volutamente assente in questo giro.

## 0.4.0 - 2026-09-20

### Corretto

- Il plugin non dipende più dall'id del modello instradato: ogni gate di pianificazione decide
  ora sulla base dei caratteri (code point Unicode via `characterPressure` / `pressureCost`)
  invece dei conteggi esatti del tokenizer, così che una rotta senza tokenizer incluso (il
  `deepseek-flash` live) faccia atterrare di nuovo le riscritture invece di saltarle in
  silenzio. Le soglie di token conservano nomi e valori (convertiti con la convenzione
  documentata 4.0 chars/token, baseline del profilo congelata intatta); le cifre di token
  diventano telemetria, etichettate onestamente dal nuovo campo `measurementBasis` sui record
  di audit di riscrittura (`exact-tokenizer` vs `characters`, con
  `tokenizerId: 'characters'` / `tokenizerRevision: 'chars-per-token-4.0'` quando derivato).
  Rollback: `git revert 7a1972a` ripristina le gate a tokenizer esatto come un'unica unità;
  confermare prima che nessuna modifica successiva abbia reintrodotto una spaccatura per id
  modello che dipenda da questo commit.

### Aggiunto

- Prezzatura del beneficio a livello di lotto (R1): una passata di review è prezzata come UNA
  mutazione fusa — la penalità di riempimento del KV-cache di coda si paga una volta per lotto
  invece che per candidato, così che lotti reali (5×50k con una coda da 64k) raggiungano la
  banda automatica invece di cadere tutti.
- Mappatura delle righe degli eventi originali (R9a): la normalizzazione terminale restituisce
  righe ripiegate che portano ciascuna il loro numero di riga dell'evento originale in base 1;
  `retrieve` legge gli eventi grezzi, quindi gli intervalli stampati si risolvono sulle righe giuste.
- Scheletro dei documenti e conservazione universale della prosa (R8/R8b): i documenti
  strutturati conservano titoli, prime/ultime righe di sezione, inizi di elenchi e intestazioni
  di tabelle; ogni altro testo non codice conserva testa E coda con un marcatore di intervallo
  di righe R9 (la prosa prima veniva troncata solo in testa).
- Ripiegamento della ricerca a due livelli (R10, corregge D8): un localizzatore L1 senza perdita
  per file più una quota di contenuto L2 a riempimento d'acqua.
- Ripiegamento di frequenza non adiacente (R11): le ripetizioni esatte separate (fino all'8,37%
  dei grandi risultati) si ripiegano sulla prima occorrenza più un marcatore conteggiato.
- Segnaposto per stringhe lunghe (R12): i blob base64/hex/UUID diventano riassunti di lunghezza
  con un prefisso di riconoscimento di 16 caratteri.
- Riduzione HTML in due stadi (R13, corregge D9): `html-slim` poi `html-skeleton`, allineati
  per riga così che i numeri di riga originali sopravvivano.
- Ancoraggi R9b: le maschere contigue citano gli intervalli di riga originali, le maschere
  sparse riportano `lines 1-N scanned, K kept`, e ogni suggerimento di retrieve porta un
  `{"ref":…,"start_line":N,"max_lines":80}` incollabile.
- Censimento dei documenti: i riassunti dei documenti omessi elencano i titoli di sezione
  invece di un costante istogramma `0 error, 0 warn, N info`.

## 0.3.1 - 2026-09-18

### Modificato

- Il pacchetto runtime è stato fuso nel pacchetto selettore: una sola installazione porta tutta
  la pila, la radice del repository è la superficie di installazione (`name`, `main`, `types`,
  `exports` con `./pruner` e `./invariant`, `dependencies`, `dsh`), e toolchain, script e CI
  sono stati trasferiti al pacchetto unico. La registrazione verificata del catalogo
  dell'estimatore (doppio prefisso, attivazione a due canali custodita, risoluzione del
  servizio per richiesta, righe di ciclo di vita visibili) è stata replicata su questa linea
  con una custodia lato host; lo schema delle impostazioni che `ab2175a` aveva degradato a
  `z.any()` è ripristinato, così che i default Custom quotidiani vengono di nuovo pubblicati.
- Adattamento al DeepSeek Harness ufficiale `v0.1.5-rc.2` su questo ramo. Tutte le
  dev dependencies `@deepseek-ai/dsh-*` e il set di host e2e bloccati passano da `0.1.1-rc.2` a
  `0.1.5-rc.2` (cordis `4.0.2`, schemastery `3.18.2`), compresi i nuovi pacchetti divisi
  (`dsh-session-projection`, `dsh-session-persistence`, `dsh-atomic-write`, `dsh-home-paths`,
  `dsh-sandbox` e correlati) e lo stack client `dsh-client-store`.
- Le operazioni di sostituzione di superficie ora usano la forma v3 `startSeq`/`endSeq` con
  valori `SessionSeq` brandizzati; i manifest `compaction/prune` conservano i campi durevoli
  `start`/`end`. Gli eventi vengono risolti dai nodi di superficie tramite lookup per seq
  invece che per indicizzazione dell'array.
- Il bundle client non importa più la rimossa `@deepseek-ai/dsh-client-runtime`: i tipi delle
  impostazioni ora provengono da `@deepseek-ai/dsh-client-ui-settings` e le fusioni degli hook
  di sessione da `@deepseek-ai/dsh-client-ui-session`. `engines.dsh >=0.1.5-alpha.1 <0.2.0-0`
  è dichiarato in entrambi i manifest dei pacchetti e in `dsh.plugin.json`.
- Harness 0.1.5 non espone più al browser l'`agentPreset` della sessione, quindi il client non
  può più rilevare le sessioni Minimal-only; il selettore resta selezionabile e il vecchio
  banner di indisponibilità è irraggiungibile.
- Batterie di test aggiornate alla semantica 0.1.5: gli avvii dei plugin cordis richiedono
  `.await()`, il Token Meter richiede un `SessionProjectionRegistry` montato, gli eventi
  assistant portano `stream: []`, e i namespace delle impostazioni sono semplici stringhe.

### Corretto

- La scheda dell'estimatore non richiede più una chiave API sul canale host del Harness.
  Scegliere il canale host mostra i menu a tendina live provider/modello, nomina la rotta che
  girerebbe davvero (override esplicito, altrimenti il default di sessione), e non rende né un
  campo chiave né un secondo input manuale del modello: URL di base, campo di testo del modello
  e la chiave in sola scrittura appartengono al solo canale dell'endpoint diretto.
- Le scritture di `presetOptions` sono indirizzate per percorso. Scrivere l'intera sezione la
  sostituiva, così che toccare un secondo campo dell'estimatore (un provider, un modello, un
  endpoint) cancellava `estimatorMode` e ogni override adiacente — spegnendo in silenzio
  l'estimatore mentre il pannello riportava un salvataggio riuscito. Ora ogni campo scrive solo
  sé stesso, `undefined` cancella esattamente il campo che nomina, e la lettura di conferma
  valida lo stesso insieme di campi invece del solo modo.
- Nuova copertura: `packages/selector/tests/preset-options-write.client.spec.ts` (scritture a
  portata di percorso, conservazione degli adiacenti, cancellazioni esplicite, patch no-op,
  segnalazione di scritture non committate) e
  `packages/selector/tests/estimator-channel.client.spec.tsx` (campi per canale, menu a tendina
  del catalogo, fallback manuale).


### Aggiunto

- Nuovo profilo `tokenpilot-inspired`: una matrice di capacità ispirata al paper TokenPilot
  sovrapposta alle soglie Balanced, selezionabile esplicitamente dall'interfaccia delle
  impostazioni; ogni profilo preesistente conserva una policy risolta identica byte per byte
  (imposta da un golden test con baseline catturata).
- Deduplicazione byte-identica dei risultati strumento ripetuti: un duplicato sovradimensionato
  è sostituito da un puntatore all'evento originale append-only della prima occorrenza
  (`dedupe-pointer`), con un indice SHA-256 per sessione (evizione per ordine di inserimento
  su 2.048 voci, solo metadati hash+seq).
- Guardia di nessun risparmio netto: le sostituzioni il cui testo non è più piccolo
  dell'originale vengono rifiutate anche quando il tokenizer esatto riporta un risparmio di token.
- Esenzione per il recupero: l'output dei tool di recupero è permanentemente esente da ogni
  passata di riduzione tramite un insieme unificato di esenzioni per sessione, impedendo
  l'oscillazione compressione-ripristino.
- Localizzatore del riassunto Auto Compact: dopo `compaction/end`, il checkpoint del riassunto
  atterrato ottiene un blocco Exact Sources (intervallo di seq in ombra, file di spill, file
  toccati) così che i dettagli riassunti restino recuperabili; saltato se non localizzerebbe
  nulla di concreto.
- Semantica dello stato di lettura: una lettura storica il cui file è stato poi mutato è
  `superseded` e prende il piccolo segnaposto dell'intero risultato; un clustering opzionale
  error/warn/info delle righe omesse viene aggiunto ai segnaposto storici.
- Estimatore opzionale di utilità residua (tre canali: off / modello host del Harness /
  endpoint diretto compatibile OpenAI) con backoff esponenziale per sessione, timeout rigoroso,
  verdetto consultivi consumati dalla successiva passata di pressione, e audit
  `estimator-outcome` solo numerici. La scheda dell'estimatore appare solo mentre il nuovo
  profilo è selezionato; la chiave API è in sola scrittura nelle impostazioni e non entra mai
  nella policy congelata, negli audit o nei log.
- Nuovi record di audit: `summary-locator` e `estimator-outcome`; il record di riscrittura
  copre la deduplicazione tramite il riduttore `dedupe-pointer`. Le allowlist dei campi di
  audit sono invariate.
- Testi in cinese semplificato e inglese per il nuovo profilo e la scheda dell'estimatore;
  copertura unitaria e golden sotto `packages/runtime/tests/tokenpilot/`.

- Gate ortogonale di compressione a scheletro di codice (`codeSkeleton.enabled`, spento per
  default): la prima esposizione di un risultato strumento di codice sorgente fresco e
  sovradimensionato può conservare uno scheletro di import e dichiarazioni con corpi elisi e
  righe di errore preservate, ricadendo sulla potatura della testa originale. La gate è
  indipendente da ogni profilo e vincolata alla misura con tokenizer esatto.
- Interruttore nell'interfaccia delle impostazioni per la gate, nella sezione delle impostazioni
  del selettore, con testi in cinese semplificato e inglese.
- Parità di decodifica browser/runtime per la nuova sezione, test di contratto di conferma in
  scrittura per `saveCodeSkeleton` e un'estensione della matrice di parità dell'intero documento.

### Modificato

- Aggiunta una baseline flat-config ESLint (`pnpm lint`, imposta in CI) e un ciclo TDD
  `pnpm test:watch`; rimossi import morti e induriti due percorsi di errore emersi dalla
  baseline di lint.
- Questo repository è ora mantenuto come fork migliorato di
  `WilliamShi666/dsh-context-compression-selector`; la documentazione viene spedita in inglese,
  cinese semplificato, giapponese e coreano.

## 0.1.0 - 2026-09-03

### Aggiunto

- Release stabile dell'integrazione del tokenizer DeepSeek V4 Flash Vision per
  `deepseek-v4-flash-vision-exp`, compresi il conteggio esatto del testo e stime limitate dei
  token delle immagini.
- Soglia Auto Compact configurabile dall'utente e guidata dal modello nella sezione delle
  impostazioni del selettore.
- Collegamento della soglia Auto Compact alle soglie water-mark History / micro-compact di ogni
  profilo standard e ai parametri di compressione correlati.

### Modificato

- L'editor della soglia ora usa un unico input numerico diretto; lo slider e i pulsanti fissi
  a valori rapidi sono stati rimossi.
- L'accesso agli eventi di sessione del runtime supporta sia l'accessor `events` consolidato
  del Harness sia la più recente API pubblica `snapshotEvents()`.

## 0.1.0-beta.4 - 2026-09-02

### Corretto

- Supporto della API pubblica ufficiale DeepSeek Harness `dsh-v0.1.2-alpha.5` conservando la
  compatibilità con il già esistente intervallo di peer `0.1.1-rc.2`. Il plugin possiede ora i
  due piccoli helper a valori immutabili che il Harness più recente non esporta più, e usa lo
  stesso letterale di namespace pubblico `context-compression` accettato da entrambe le
  implementazioni di Settings. Nessun codice del core del Harness viene modificato.

## 0.1.0-beta.3 - 2026-09-01

### Ambito

Questa è una release a stadi. Vengono consegnati il conteggio esatto di token di **classe
testo** per `deepseek-v4-flash-vision-exp`, le stime limitate del migliore sforzo per ** immagini
di classe vision**, e il lavoro su soglia/UI/audit dell'Auto Compact. La misura esatta delle
immagini resta **BLOCCATA UPSTREAM**: la attuale cucitura di misura non espone né le dimensioni
proiettate delle immagini della richiesta dell'adattatore né la posizione serializzata assoluta,
quindi le stime non possono essere promosse a `exact-tokenizer`.

### Aggiunto

- Supporto DeepSeek V4 Flash Vision per `deepseek-v4-flash-vision-exp` tramite un tokenizer
  ufficiale bundlato separatamente, bloccato alla revisione
  `6821d6ad3681a4b137b066b76094fa82ebd0a380` di `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`.
  Testo, reasoning, argomenti delle tool call e risultati strumento di puro testo vengono
  contati esattamente; i candidati risultati strumento con immagini restano fail-open.
- L'aritmetica dei token delle immagini vision è portata riga per riga dal
  `inference/image_processor.py` ufficiale (patch size 14, downsample 3, tetto di 384 token,
  min pixels 147456, clamp di aspetto 8:1 e padding di allineamento dipendente dalla posizione),
  validata contro fixture golden generate eseguendo l'implementazione Python ufficiale.
  Dimensioni intrinseche valide ora producono `tokenizer-estimate` al punto medio di tutti e
  quattro i residui di allineamento con un tetto di 384 token per immagine; le dimensioni
  malformate o non valutabili usano un fallback documentato di 256 token. Le superfici miste
  testo/immagine aggregano il testo esatto e le immagini stimate senza promuoverle a esatte.
- Impostazione `autoCompact.thresholdPercent` (default 80, intero 50–90, passo 1) con un unico
  contratto di validazione condiviso tra interfaccia delle impostazioni, schema persistito e
  resolver runtime. L'editor vive dentro la sezione di impostazioni del selettore
  context-compression.
- Collegamento History dei profili standard alla water-mark Auto Compact: `A = floor(C × a)`
  ridimensiona il trigger History, il recupero minimo e la coda di token recenti;
  `D = floor(A × 0.875)` sostituisce il fisso rapporto di pressione di capacità 0.7 come gate di
  ultima possibilità del micro-compact; un lotto deve giustificare la sua rottura di cache
  riportando la richiesta completa sotto la scadenza. I default all'80% riproducono esattamente
  i numeri precedenti.
- L'overlay dei preset scrive la soglia salvata nella composizione `compaction-basic` generata
  come `thresholdRatio` (con `retainRatio` bloccato a 0.16) e, dalla stessa lettura, nella
  configurazione di deployment del runtime del plugin come `autoCompactThresholdPercent`, così
  che una stessa generazione permanente non esegua mai Auto Compact e micro compact su due
  soglie diverse. Qualunque cambio di identità della generazione — soglia, sorgente o percorsi
  dei moduli, comprese quelle a pari lunghezza — produce una nuova generazione della
  composizione permanente. I timbri deterministici derivati dall'identità usano una finestra di
  un secondo intero a 8 cifre esadecimali; identità a prefisso uguale possono collidere in
  quella prima finestra su un filesystem grossolano, quindi l'overlay osserva la vera chiave
  `mtimeMs+size` del file di staging e scala a finestre di hash successive prima della rinomina
  atomica. Contenuto, permessi e timbro univoco finale sono completi prima della pubblicazione;
  le sessioni già in corso conservano la loro policy congelata.
- Gli audit `policy-resolved` registrano ora i fatti di coordinamento Auto Compact (percentuale
  di soglia, `A`, `D`, sorgente del parametro — inclusi `deployment-override`/`mixed` quando la
  configurazione di deployment sostituisce le water-mark History collegate), il provider/modello
  instradato e l'identità del tokenizer incluso.
- Le impostazioni persistite rifiutano le sezioni presenti-ma-non-valide (`profile: null`,
  `custom: null`, proprietà propria `undefined`) prima che un default dello schema possa
  assorbirle; un documento memorizzato malformato congela la sessione senza perdita
  (`profile: off`, audito come `settingsInvalidFallback: lossless-off`) invece di attivare in
  silenzio il default con perdita Balanced. Il decodificatore browser applica la stessa regola e
  canonizza i documenti legacy Custom v1/v2 allo stesso documento v3 che produce il resolver
  runtime.
- Il pianificatore History restituisce un esito discriminato, e gli audit `component-evaluation`
  distinguono la tassonomia completa dei salti: `below-profile-trigger`, `below-micro-deadline`,
  `exact-tokenizer-unavailable`, `no-safe-candidates` (solo output di tool di recupero o
  risultati già sgomberati), `protected-working-set` (tutto ciò che sta nella coda protetta),
  `insufficient-reclaim` e `cannot-reach-deadline-target` (con i numeri di token
  raggiunto/richiesto), `adaptive-cost-rejected`, e `recovery-tool-unavailable`.

### Limitazioni note

- Le immagini non rivendicano mai conteggi esatti. L'espansione ufficiale dipende dalla
  posizione assoluta nel prompt (prompt di sistema, incorniciatura del chat template, handle
  delle immagini dell'adattatore) e dalla proiezione finale delle immagini della richiesta
  dell'adattatore (inclusi gli override `imagePixelBudget`/`imageDetail` per rotta e la
  riproiezione del tetto di byte), nessuna delle quali è esposta dalla attuale cucitura di
  misura. Le stime intrinseche/default possono quindi differire materialmente dalla contabilità
  del fornitore. Le richieste di capacità upstream restano: dimensioni proiettate delle immagini
  della richiesta e posizione serializzata assoluta esposte alle estensioni di misura dei token.
- La History salta l'intero lotto appena un candidato risultato strumento manca di un conteggio
  esatto, compresi i candidati con immagini, benché i candidati testuali adiacenti siano
  individualmente esatti.
- Custom resta in modalità token manuale; i suoi parametri History non seguono la water-mark
  Auto Compact.
- Un'interfaccia di ripartizione dei token vision non viene spedita; le stime delle immagini e
  la diagnostica di allineamento intrinseco sono disponibili sulla vista dei token misurati,
  mentre le prove di riscrittura con perdita richiedono ancora conteggi esatti.

### Rinviato

- Campo `modality` degli audit e lo SHA-256 dell'artefatto tokenizer dentro i record di audit
  (gli audit portano già il provider/modello instradato e l'identità del tokenizer).
- Pubblicazione della (ormai completa) tassonomia delle ragioni di salto del runtime come
  tabella di documentazione rivolta all'utente.
- Visualizzazione delle water-mark A/D per il profilo Custom e un avviso oltre D; Custom resta
  completamente manuale.
- Interfaccia di ripartizione dei token vision e promozione delle stime delle immagini a misura
  esatta.

## 0.1.0-beta.2 - 2026-08-28

### Corretto

- Risolvere la rotta del tokenizer ufficiale DeepSeek V4 Flash così che Fresh e Aggregate
  possano valutare i risultati strumento per i modelli V4 supportati.
- Eseguire la Cache Strict History al vero confine di richiesta appena la sua condizione
  configurata di pressione di capacità è soddisfatta; innescare la condizione di capacità al
  70% di utilizzo del contesto instradato.
- Disattivare la potatura nativa testa/centro/coda dei risultati strumento del Harness appena
  un profilo del selettore è attivo, lasciando il selettore come unico compattatore dei
  risultati strumento.

### Modificato

- Proteggere le 10 tool call più recenti dell'agente e una finestra di coda dei risultati
  strumento di 64.000 token prima che History/microcompact riscriva risultati più vecchi.

## 0.1.0-beta.1 - 2026-08-27

### Aggiunto

- Product Bundle DeepSeek Harness a installazione unica appoggiato a un pacchetto runtime
  separato a versione esatta.
- Selettore di profilo web con impostazioni stabili per preset e un'eccezione Minimal
  integrata esplicita.
- Fresh, Aggregate, History consapevole di routine/capacità, potatura nativa dei risultati
  strumento e TailTrim Custom spento per default.
- Protocollo TailTrim su eventi standard usando `compaction/prune` più la sostituzione
  recuperabile di `user/message`.
- Tool di recupero `context_compression_retrieve` di proprietà del plugin.
- Record di audit strutturati e senza contenuto per policy, valutazione, riscrittura, fallimenti
  e auto-compact nativo.
- Asset tokenizer ufficiali DeepSeek V4 bloccati con validazione SHA-256 a runtime e licenza
  upstream.
- Test di regressione e2e a componenti su API pubblica, preset/Minimal e prefissi di cache
  parent/fork/spawn.

### Compatibilità

- Verificato contro i pacchetti pubblici DeepSeek Harness `dsh-v0.1.1-rc.2`.
- La mappatura esatta dei tokenizer è attualmente limitata a `deepseek-v4-flash` e
  `deepseek-v4-pro`.

### Limitazioni note

- La History adattiva ordinaria fallisce in chiusura quando le prove pubbliche di rotta/cache a
  livello di richiesta sono incomplete; la pressione di capacità resta una superata di sicurezza
  separata.
- I test sui prefissi di cache provano l'ereditarietà nativa del fork e prefissi serializzati
  identici, non un'allocazione di cache specifica del fornitore né un hit garantito sulla cache
  DeepSeek.
- Gli snapshot delle impostazioni e le decisioni di prima esposizione sono locali al processo
  del runtime montato.
