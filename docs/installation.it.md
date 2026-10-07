# Installare dsh-context-compression-improved

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md) · [Français](installation.fr.md) · [Deutsch](installation.de.md) · [Italiano](installation.it.md) · [Русский](installation.ru.md) · [Español](installation.es.md)

Questa guida installa il fork dai sorgenti. Il fork è pubblicato anche su npm come
`dsh-context-compression-improved` con il dist-tag `latest`: un'unica versione copre tutte le linee Harness supportate (0.1.0-rc.2 a 0.2.0-rc.2); il nome del pacchetto
resta volutamente quello dell'upstream. Il runtime, che un tempo era un secondo pacchetto,
ora ne fa parte, quindi una sola installazione porta con sé l'intera pila.

## Prerequisiti

- Node `^22.19.0 || >=24` e pnpm `11.7.0` (`corepack enable` adotta la versione bloccata dal campo `packageManager`).
- Un'installazione di DeepSeek Harness entro l'enumerazione peer a 15 rc del plugin (`0.1.0-rc.2` a `0.2.0-rc.2`).
- Una rotta di modello DeepSeek. La compressione con perdita — incluso il gate dello scheletro di codice — decide sulla base dei caratteri, quindi non resta alcun requisito di rotta con tokenizer incluso; quando esiste un tokenizer incluso i suoi conteggi esatti vengono registrati come telemetria, e le altre rotte falliscono in modo aperto (fail-open) conservando i risultati degli strumenti originali.
- Git.

## 1. Compilare dai sorgenti

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` impacchetta entrambe le facce di libreria di ogni pacchetto (`tsdown`). Eseguire prima `pnpm test` se si vuole la suite completa sulla propria macchina prima di installare.

## 2. Pacchettizzare il pacchetto d'ingresso del Bundle

Il pacchetto selettore è l'unico ingresso del Bundle; il runtime lo segue come dipendenza a versione esatta:

```sh
cd packages/selector
pnpm pack
# → dsh-context-compression-improved-0.9.0.tgz
cd ../..
```

`pnpm pack` fa passare il bundle attraverso l'hook `prepack`, quindi il tarball corrisponde sempre al proprio checkout.

## 3. Aggiungerlo a un profilo Harness

Il pacchetto selettore dichiara il campo di manifest Bundle del Harness `dsh.bundle.patch`, quindi `dsh plugin add` è il percorso di installazione Bundle fuori albero standard:

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.9.0.tgz
dsh --profile web --dump-config
```

Riavviare il profilo selezionato dopo l'installazione. Il dump della configurazione dovrebbe elencare il Bundle selettore come attivo. **Non** installare né collegare separatamente i pacchetti selettore e runtime — il runtime viene installato automaticamente.

## 4. Attivare il gate dello scheletro di codice

Aprire le impostazioni di DeepSeek Harness → **Context compression selector**:

1. Scegliere un profilo di compressione (il gate è ortogonale a tutti).
2. Regolare facoltativamente il livello di attivazione dell'Auto Compact (50–90%, predefinito 80%).
3. Impostare **Code skeleton compression** su **On**. L'interruttore salva alla modifica.

Come tutte le impostazioni del selettore, il valore viene congelato quando una sessione lo osserva per la prima volta — il gate interessa le sessioni osservate da quel momento, mai un'attività già in corso.

## 5. Facoltativo: il relevance advisor consultivo

Il plugin può mantenere statistiche su quanto è ancora rilevante la cronologia della sessione — solo consultivo, non decide e non blocca nulla. È disattivato per impostazione predefinita; si attiva modificando la sezione `presetOptions` delle impostazioni della compressione del contesto (JSON delle impostazioni, in questo giro nessuna scheda nell'interfaccia):

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

`advisorMode: "host"` chiama il servizio `llm` del harness; `"direct"` riutilizza l'endpoint
`estimatorBaseUrl` / `estimatorApiKey` / `estimatorModel` dell'estimatore. Ad ogni confine di
turno l'advisor (1) riassume l'attività corrente dall'evento `todo/write` più recente,
(2) assegna in modo incrementale punteggi di rilevanza contenuto-e-commenti ai risultati
strumento storici e (3) registra una figura di decadimento del prefisso. I risultati
emergono come record di audit `advisor-outcome` e, con il flag di deployment
`advisorReportRoute: true`, attraverso una rotta HTTP di sola lettura
`GET .../advisor-report?sessionId=`. Ciò che l'advisor riporta non può mai sopprimere,
ritardare o riscrivere alcuna riduzione destinata ad atterrare.

## 6. Aggiornare o rimuovere

```sh
# update: pull, rebuild, repack, and add the new tarball again
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.9.0.tgz

# remove
dsh plugin --profile web remove dsh-context-compression-improved
```

## Risoluzione dei problemi

- **Bundle non attivo nel dump**: riavviare il profilo; confermare di aver aggiunto il pacchetto d'ingresso selettore (non il runtime) e che la versione del Harness rientri nell'intervallo di peer compatibile.
- **I risultati strumento non vengono mai compressi a scheletro**: il gate è disattivato per impostazione predefinita; controllare l'interruttore. La compressione si applica solo ai risultati strumento freschi, troppo grandi e di codice sorgente (le decisioni girano sulla base dei caratteri; nessun requisito di rotta con tokenizer esatto), e ogni salto viene registrato con il proprio motivo nella traccia di audit.
- **L'interruttore appare come illeggibile**: la sezione `codeSkeleton` memorizzata non ha superato la decodifica rigorosa del browser (deve essere esattamente `{ enabled: boolean }`). Rimuovere la sezione malformata ripristina i predefiniti.
- **L'aggiornamento fallisce al passo di upgrade**: il plugin segue la semantica dei pacchetti npm; rimuovere prima la vecchia versione se il proprio build del Harness rifiuta un upgrade da tarball a tarball.
