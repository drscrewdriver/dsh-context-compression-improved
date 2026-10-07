# Registro de cambios

> [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [日本語](CHANGELOG.ja.md) · [한국어](CHANGELOG.ko.md)

Todos los cambios notables se registran en este archivo. El proyecto sigue el versionado semántico a partir de `0.1.0`.

## 0.9.0 - 2026-10-08

### Añadido

- **Una versión para todas las líneas de Harness**: 0.9.0 es una única versión que atiende
  los 15 rc desde 0.1.0-rc.2 hasta 0.2.0-rc.2 (seis líneas de host). El esquema de
  dist-tag por línea se retira — tras publicar, `latest`, `dsh-0.1.2`, `dsh-0.1.5`,
  `dsh-0.1.7` y `dsh-0.2.0` apuntarán todos a 0.9.0.
- **Cinturón de ajustes de tres generaciones**: al arrancar, el plugin detecta qué cara de
  ajustes expone el host — el servicio heredado `settings.register` (0.1.0-0.1.5) o la
  configuración volátil gestionada por el loader + `configForms` (0.1.7+/0.2.0) — y arma
  solo la superficie cliente correspondiente (`settings.section` vs `configForms`), más la
  tarjeta `plugins.bundle.config` en 0.1.7+.
- **Puente de ajustes**: en líneas heredadas las herramientas leen y escriben a través de
  un namespace de ajustes escribible por arriendo (resultados de herramienta envueltos); en
  líneas modernas leen el documento configForms directamente y las escrituras del puente
  devuelven 409 por diseño.
- La tarjeta `plugins.bundle.config` renderiza el componente completo de ajustes mediante un
  `useCompression` construido por clausura (la cadena de detalle de paquete no tiene
  hookContext, así que la inyección de hooks a nivel de entry no está disponible allí).

### Corregido

- La sonda de generación ya no guarda en caché una respuesta provisional en tiempo de wire:
  la ausencia del servicio de ajustes durante la composición de filas (antes de que existan
  los servicios del host) se re-resuelve cuando el servicio se inyecta realmente — el brazo
  de arriendo heredado estaba muerto en 0.1.0.
- El validador de tail-trim compara el source kind del reemplazo contra el escritor gateado
  por generación en lugar de un id de plugin codificado, así ya no rechaza su propia salida
  heredada envuelta.
- El brazo cliente configForms resuelve el servicio desde la propiedad `.configForms` del
  Context propietario inyectado; usar el Context crudo como handle hacía que `get()`
  devolviera `undefined` y el límite de slot del host abdicara la sección de ajustes en una
  celda muerta en 0.1.7.

### Cambiado

- Todos los rangos peer `@deepseek-ai/dsh-*` y `engines.dsh` enumeran explícitamente los
  15 rc, de modo que ninguna compuerta engine/peer bloquea la instalación en línea alguna.


## 0.8.0-beta.1 - 2026-09-30

### Cambiado

- Línea de compatibilidad con Harness 0.2.0: los 23 rangos de peers `@deepseek-ai/dsh-*` pasan a
  `>=0.2.0-rc.1 <0.2.1-0`, y `engines.dsh` sigue en los tres manifiestos (raíz, paquete selector
  y manifiesto del plugin). `publishConfig.tag` pasa a ser `dsh-0.2.0`; la línea 0.1.7 sigue
  atendida desde `dsh-0.1.7` (ahora `0.7.0-beta.1`), y las líneas 0.1.5/0.1.2 desde sus propios
  dist-tag.
- 39 de los 41 overrides fijados y 46 de las 48 dev-dependencies pasan a `0.2.0-rc.1`;
  `@deepseek-ai/dsh-agent-presets` (`0.1.6-alpha.2`) y `@deepseek-ai/dsh-code-runtime`
  (`0.1.5-rc.3`) conservan sus fijaciones — ninguno de los dos paquetes tiene una versión en la
  línea 0.2.0.
- Puertas de publicación reorientadas: la fijación de harness del e2e de instalación empaquetada
  ahora clona el árbol oficial `dsh-v0.2.0-rc.1` (`4878cdab`), y la prueba de contrato de los
  artefactos construidos aserta el slot de cliente `configForms` (renombrado desde
  `settingsScope` en la línea 0.1.7).

## 0.6.5 - 2026-09-29

### Corregido

- Alineación de dev-dependencies con la línea Harness 0.1.7: 46 de las 48 dev-dependencies
  `@deepseek-ai/dsh-*` pasan de la fijación precisa `0.1.5-rc.2` a la fijación precisa
  `0.1.7-rc.2`, y `pnpm-lock.yaml` se regeneró desde un árbol limpio. Typecheck, build, test,
  lint y `verify:release` se ejecutan ahora contra la base real 0.1.7-rc.2 en lugar de validar
  las adaptaciones 0.1.7 con entradas 0.1.5 (un verde falso). Dos paquetes no tienen ninguna
  versión en la línea 0.1.7 y conservan sus valores fijados en la instalación:
  `@deepseek-ai/dsh-agent-presets` (`0.1.6-alpha.2`) y `@deepseek-ai/dsh-code-runtime`
  (`0.1.5-rc.3`). `react-dom` obtiene una dev-dependency explícita `^18.2.0` para que una
  resolución fresca no pueda emparejar React-DOM 19 con React 18 en las suites de pruebas.
- La costura de ajustes del host de pruebas se reconstruyó contra el host real 0.1.7:
  `SettingsProvider` ya no existe en `@deepseek-ai/dsh-settings` (sustituido por los
  `SettingsForms` declarativos), mientras que el plugin conserva la lectura heredada
  `ctx.settings.get(ns)` como alternativa a la forma del host. Las especificaciones montan ahora
  una copia vendored del proveedor 0.1.5-rc.2 (`tests/helpers/legacy-settings/`) para ejercitar
  exactamente esa alternativa, y el registrador de namespaces heredados estrecha el servicio en
  la costura. La prueba en vivo del harness de DeepSeek registra el proveedor a través de la
  costura del adaptador 0.1.7 en lugar del plugin autocontenido `llm-deepseek` eliminado.
- Adaptaciones de pruebas reveladas por la base real: las fixtures del motor de compactación
  pasan `headroomTokens: 0` (0.1.7-rc.2 define por omisión un margen de compactación de 65536
  tokens, que se traga las ventanas de sonda de 1k tokens de las fixtures), y la aserción de
  activos de resultados de herramientas sigue la forma de mensaje de primera clase
  `role: 'tool'` (sin bloque de contenido `tool-result` envolvente).
- Puertas de publicación refijadas a la versión oficial 0.1.7: `verify-release.mjs` y el e2e
  empaquetado asertan ahora peers del selector `>=0.1.7-rc.1 <0.2.0-0`, y el clon oficial del
  harness del e2e empaquetado aserta el tag `dsh-v0.1.7-rc.2` (commit `477b4f42`, árbol
  `e3e63253`).
- `packages/selector/dsh.plugin.json` ahora lleva la versión de publicación (0.6.5; cada 0.6.x
  anterior la enviaba congelada en 0.1.0) y declara el rango honesto del motor
  `>=0.1.7-rc.1 <0.2.0-0`.
- La deuda de lint de las adaptaciones manuales de 0.6.3 está saldada: imports/locales sin uso
  eliminados en `src/index.ts`, `src/client/index.ts`, `src/pruner.ts` y tres especificaciones
  de host; el barrido de restos de staging de la generación vigente ahora se acota al almacén de
  la propia especificación para que una especificación que publique en paralelo no pueda
  hacerlo fallar.

## 0.6.4 - 2026-09-26

### Corregido

- El vinculador de locale del cliente es eager: cambiar la locale del host ahora vuelve a
  renderizar la interfaz de ajustes de compresión sin un remount.
- Publicada desde un stash y nunca confirmada en ninguna rama (el árbol de trabajo que la
  publicó se perdió); compat/0.1.7 restauró el contenido exacto en 0.6.5 y lo verificó byte a
  byte contra el tarball del registro antes de continuar.

## 0.5.4 - 2026-09-20

### Corregido

- La superficie de instalación declara `@deepseek-ai/schemastery` como dependencia de ejecución.
  El runtime empaquetado la importa incondicionalmente (`import z from '@deepseek-ai/schemastery'`
  en `packages/selector/lib/index.js`, `lib/pruner.js` y `lib/advisor-state.js`), pero 0.5.3 no
  la declaraba en ningún lugar que lea una instalación consumidora: el manifiesto raíz enviado
  solo listaba `@huggingface/tokenizers` y `js-yaml`, y `packages/selector/package.json` la
  declaraba como peer, algo que ningún gestor de paquetes consulta para un paquete anidado que
  instala. La resolución dependía, por tanto, de que un paquete instalado sin relación alguna
  izara `@deepseek-ai/schemastery` al perfil. En una instalación limpia, la importación caía al
  fallback de módulos compartidos de la instalación de Harness en `$DSH_HOME/profiles/node_modules`;
  cuando ese fallback no contenía ningún paquete construido, cada entrada del plugin fallaba al
  cargarse y el host arrancaba sin la capa Bundle. Ambos manifiestos fijan ahora `3.18.2`, la
  versión contra la que esta publicación se construye y prueba, y el paquete selector ya no
  reclama una obligación de peer que no tiene.

### Añadido

- `verify:release` deriva las dependencias de la superficie de instalación de los
  especificadores desnudos que importan los archivos del runtime empaquetado, en lugar de
  nombrar a mano `@huggingface/tokenizers` y `js-yaml`. Qué paquetes viajan con el plugin y
  cuáles aporta la instalación de Harness es una lista revisada, y una importación cuyo
  proveedor no esté en ningún manifiesto hace fallar la puerta con el nombre faltante. La
  puerta se añadió como control negativo contra los manifiestos sin corregir, donde fallaba en
  `@deepseek-ai/schemastery`.

## 0.5.3 - 2026-09-20

### Corregido

- El parche del Bundle ya no establece la bandera retirada de la ruta de revisión.
  `reviewQueueRoute` se eliminó del esquema Config del plugin cuando se retiró la puerta de
  revisión, pero permaneció en `packages/selector/cordis.patch.yml`, donde anunciaba una ruta
  que nunca puede registrarse. Los hosts toleran hoy la clave desconocida (el plugin carga y
  sirve — verificado en un host en vivo), de modo que es un defecto de configuración obsoleta y
  no una rotura, pero rompería en cualquier host que valide estrictamente la configuración de
  los plugins.
- Los artefactos generados están fijados a LF (`packages/selector/lib/** text eol=lf`). Con
  `core.autocrlf=true`, cada checkout reescribía los `lib/**` confirmados a CRLF, de modo que
  cualquier cambio de rama o merge dejaba todo el directorio de artefactos marcado como
  modificado solo por diferencias de EOL. Nunca se confirmó nada desde ese estado, pero hacía
  que cada árbol pareciera sucio y podía ocultar un cambio real de un artefacto.

### Añadido

- Un fijado de contrato de control negativo sobre el parche del Bundle: falla cuando una clave
  de configuración retirada está establecida en el parche (asertado en las líneas que
  establecen claves, de modo que el comentario explicativo aún pueda nombrar la clave), y
  exige que la bandera viva `estimatorCatalogRoute` siga cableada.

### Pruebas

- El contrato del asiento de cliente también fija la degradación en hosts más antiguos: un host
  que no declara el asiento rechaza el registro en el límite del slot, y `apply()` debe
  tragárselo y avisar en lugar de arrastrar consigo todas las entradas de ajustes.

## 0.5.2 - 2026-09-20

### Cambiado

- El conducto de revisión con puerta humana (beta) queda **retirado**. Su semántica se
  sustituye por el consejo: el modelo de beneficio sigue tasando cada pasada como UNA mutación
  fusionada, pero la banda que calcula (`profitable` / `high-impact` / `slow-payback` /
  `unpriceable` / `not-worth-it`) se publica ahora como registro de auditoría `reduction-advice`
  y se instantanea en la ruta del informe del asesor — nunca retiene, retrasa ni reescribe una
  reducción. La puerta contradecía el propio requisito de la función (una reducción jamás debe
  bloquear el procesamiento automático) y, con los valores enviados (`reviewMode` activado más
  un umbral high-impact de 4 000 tokens frente a un disparador fresh de 8 192 tokens), desviaba
  el 100 % de un lote fresh hacia la revisión humana, dejando el camino automático apagado en
  la práctica para quien lo hubiera activado. Los umbrales del consejo son ahora constantes de
  módulo (α `0.1`, high-impact `4 000` tokens): nada actúa sobre ellos, así que ya no son
  ajustes.
- Retirados con la puerta: la cola de revisión y su adaptador `storageDomain`, el registro a
  nivel de proceso, las rutas HTTP `review-queue` / `review-decide` y la bandera de
  despliegue `reviewQueueRoute`, el panel de cliente `shell.overlay`, las claves de ajustes
  `reviewMode` / `reviewTimeoutTurns` / `cacheHitDiscountAlpha` / `reviewHighImpactTokens`,
  y el tipo de auditoría `review-outcome`. Las cuatro claves de ajustes siguen siendo ACEPTADAS
  e IGNORADAS por ambos decodificadores — un documento existente (el vivo lleva
  `reviewMode: false`) sigue cargándose y sigue renderizando su tarjeta de ajustes — y nunca
  alcanzan la política resuelta. La ruta de solo lectura `GET .../advisor-report` sirve además
  `lastAdvice`.

### Añadido

- Fijados de regresión para el retiro: una especificación de integración de host conduce
  exactamente los ajustes que antes desviaban todo (`reviewMode: true`,
  `reviewHighImpactTokens: 1`) y aserta que el lote fresh ATERRIZA, descrito por un registro de
  consejo `high-impact`; una especificación de contrato de desuso fija accept-and-ignore para
  las claves retiradas tanto en el analizador del runtime como en el decodificador del
  navegador.

### Reversión

- Reinstale la última versión que aún envía la puerta: `npm dist-tag add
  dsh-context-compression-improved@0.5.1 dsh-0.1.5 --registry https://registry.npmjs.org/`
  y luego `dsh plugin --profile web add dsh-context-compression-improved@0.5.1`.

## 0.5.1 - 2026-09-20

### Corregido

- La composición concurrente del overlay de preset de una misma identidad ya no falla en
  Windows. La publicación ahora se serializa por ruta de destino, y cuando el renombrado
  atómico aún pierde la carrera, se confirma que el destino ya lleva la clave permanente
  `{mtimeMs, size}` del archivo de staging antes de que la publicación informe de éxito.
  Windows `MoveFileEx` informa de esa carrera perdida como `EPERM`/`EBUSY`, donde el `rename`
  de POSIX simplemente reemplaza el destino, lo que hacía que `standingKeyFor()` lanzara durante
  el arranque concurrente de sesiones. Un destino que no coincida sigue fallando ruidosamente,
  de modo que una generación reutilizada en silencio sigue prohibida.
- Reparaciones de puertas de publicación y de pruebas que ocultaban esto y otras puertas rojas
  preexistentes: identificadores obsoletos y una razón de auditoría retirada en los smokes
  empaquetados, una expectativa de client-inject obsoleta y trampas de spawn solo de Windows
  (`git` y los scripts `node -e` multilínea se enrutaban por `cmd.exe`, que reescribía sus
  argumentos).

## 0.5.0 - 2026-09-20

### Añadido

- Asesor de relevancia consultivo (solo estadísticas y sugerencias, desactivado por omisión):
  en cada frontera de turno, una pasada fire-and-forget resume la semántica de la tarea de cola
  de la sesión a partir del evento `todo/write` más reciente (con alternativa en el texto de
  usuario reciente), puntúa incrementalmente los candidatos históricos de resultados de
  herramientas por relevancia de contenido y comentarios frente a la tarea actual, y calcula
  una cifra de decaimiento de prefijo (media de relevancia ponderada por la presión de
  caracteres). Los segmentos antiguos de baja relevancia se marcan `recertified` como
  sugerencias para futuras decisiones de agresividad del historial — nada los consume en esta
  ronda, y la salida del asesor nunca puede suprimir, retrasar ni reescribir una reducción que
  vaya a aplicarse (fijado por una prueba de invariante dedicada). Configuración mediante las
  claves de ajustes `presetOptions.advisor*` (`advisorMode` `''|'host'|'direct'`, por omisión
  `''`; el canal directo reutiliza el endpoint del estimador; `SideChannel` ganó un parámetro
  opcional de overrides para que el transporte del estimador se comparta sin compartir su
  configuración). Observabilidad: nuevos registros de auditoría `advisor-outcome` (sin
  contenido, uno por fase: summary / scoring / decay) y una ruta HTTP de solo lectura
  `GET .../advisor-report?sessionId=` (bandera de despliegue opcional `advisorReportRoute`, al
  molde de las rutas de revisión). La interfaz de cliente está deliberadamente ausente en esta
  ronda.

## 0.4.0 - 2026-09-20

### Corregido

- El plugin ya no depende del id del modelo enrutado: cada puerta de planificación decide ahora
  sobre la base de caracteres (puntos de código Unicode vía `characterPressure` /
  `pressureCost`) en lugar de recuentos exactos del tokenizer, de modo que una ruta sin
  tokenizer incluido (el `deepseek-flash` en vivo) vuelve a aterrizar reescrituras en lugar de
  saltárselas en silencio. Los umbrales de tokens conservan nombres y valores (convertidos con
  la convención documentada de 4.0 chars/token, la base del perfil congelada intacta); las
  cifras de tokens se vuelven telemetría, etiquetadas honestamente por el nuevo campo
  `measurementBasis` en los registros de auditoría de reescritura (`exact-tokenizer` frente a
  `characters`, con `tokenizerId: 'characters'` / `tokenizerRevision: 'chars-per-token-4.0'`
  cuando se deriva). Reversión: `git revert 7a1972a` restaura las puertas de tokenizer exacto
  como una sola unidad; confirme primero que ningún cambio posterior reintrodujo una división
  por id de modelo que dependa de este commit.

### Añadido

- Tasación del beneficio a nivel de lote (R1): una pasada de revisión se tasa como UNA mutación
  fusionada — la penalidad de rellenar el KV-cache de cola se paga una vez por lote en lugar de
  por candidato, de modo que lotes reales (5×50k con una cola de 64k) alcanzan la banda
  automática en lugar de caerse todos.
- Mapeo de líneas de eventos originales (R9a): la normalización terminal devuelve líneas
  plegadas que llevan cada una su número de línea del evento original en base 1; `retrieve`
  lee los eventos crudos, así que los rangos impresos se resuelven en las líneas correctas.
- Esqueleto de documentos y conservación universal de la prosa (R8/R8b): los documentos
  estructurados conservan encabezados, primeras/últimas líneas de sección, inicios de listas y
  cabeceras de tablas; cualquier otro texto que no sea código conserva cabeza Y cola con un
  marcador de rango de líneas R9 (la prosa antes se truncaba solo por la cabeza).
- Plegado de búsqueda de dos niveles (R10, corrige D8): un localizador L1 sin pérdida por
  archivo más una cuota de contenido L2 de llenado de agua.
- Plegado de frecuencia no adyacente (R11): las repeticiones exactas separadas (hasta el 8,37 %
  de los resultados grandes) se pliegan a la primera ocurrencia más un marcador contado.
- Marcadores de posición de cadenas largas (R12): los blobs base64/hex/UUID se convierten en
  resúmenes de longitud con un prefijo de reconocimiento de 16 caracteres.
- Reducción HTML en dos etapas (R13, corrige D9): `html-slim` y luego `html-skeleton`,
  alineados por líneas para que los números de línea originales sobrevivan.
- Anclajes R9b: las máscaras contiguas citan rangos de líneas originales, las máscaras
  dispersas informan `lines 1-N scanned, K kept`, y cada pista de retrieve lleva un
  `{"ref":…,"start_line":N,"max_lines":80}` pegable.
- Censo de documentos: los resúmenes de documentos omitidos listan encabezados de sección en
  lugar de un constante histograma `0 error, 0 warn, N info`.

## 0.3.1 - 2026-09-18

### Cambiado

- El paquete de runtime se fusiona en el paquete selector: una instalación trae toda la pila,
  la raíz del repositorio es la superficie de instalación (`name`, `main`, `types`, `exports`
  con `./pruner` y `./invariant`, `dependencies`, `dsh`), y la cadena de herramientas, los
  scripts y la CI se barrieron hacia el paquete único. El registro verificado del catálogo del
  estimador (doble prefijo, activación de dos canales custodiada, resolución del servicio por
  petición, líneas de ciclo de vida visibles) se repitió en esta línea con una guarda del lado
  del host; el esquema de ajustes que `ab2175a` había degradado a `z.any()` queda restaurado,
  de modo que los valores Custom por omisión del día a día se vuelven a publicar.
- Adaptación al DeepSeek Harness oficial `v0.1.5-rc.2` en esta rama. Todas las dev-dependencies
  `@deepseek-ai/dsh-*` y el conjunto de hosts e2e fijado pasan de `0.1.1-rc.2` a `0.1.5-rc.2`
  (cordis `4.0.2`, schemastery `3.18.2`), incluidos los nuevos paquetes divididos
  (`dsh-session-projection`, `dsh-session-persistence`, `dsh-atomic-write`, `dsh-home-paths`,
  `dsh-sandbox` y relacionados) y la pila de cliente `dsh-client-store`.
- Las operaciones de reemplazo de superficie usan ahora la forma v3 `startSeq`/`endSeq` con
  valores `SessionSeq` marcados; los manifiestos `compaction/prune` conservan los campos
  duraderos `start`/`end`. Los eventos se resuelven desde los nodos de superficie mediante
  búsqueda por seq en lugar de indexación de arreglos.
- El bundle de cliente ya no importa el eliminado `@deepseek-ai/dsh-client-runtime`: los tipos
  de ajustes vienen ahora de `@deepseek-ai/dsh-client-ui-settings` y las fusiones de hooks de
  sesión de `@deepseek-ai/dsh-client-ui-session`. `engines.dsh >=0.1.5-alpha.1 <0.2.0-0` se
  declara en ambos manifiestos de paquetes y en `dsh.plugin.json`.
- Harness 0.1.5 ya no expone al navegador el `agentPreset` de la sesión, de modo que el cliente
  ya no puede detectar sesiones solo-Minimal; el selector sigue siendo seleccionable y el viejo
  banner de indisponibilidad es inalcanzable.
- Baterías de pruebas actualizadas a la semántica de 0.1.5: los arranques de plugins cordis
  requieren `.await()`, el Token Meter requiere un `SessionProjectionRegistry` montado, los
  eventos de asistente llevan `stream: []`, y los namespaces de ajustes son cadenas simples.

### Corregido

- La tarjeta del estimador ya no exige una clave API en el canal de host del Harness. Elegir el
  canal de host muestra los desplegables en vivo de proveedor/modelo, nombra la ruta que
  realmente correría (override explícito, si no el predeterminado de la sesión), y no renderiza
  ni un campo de clave ni una segunda entrada manual de modelo: la URL base, el campo de texto
  del modelo y la clave de solo escritura pertenecen únicamente al canal de endpoint directo.
- Las escrituras de `presetOptions` se dirigen por ruta. Escribir la sección entera la
  reemplazaba, de modo que tocar un segundo campo del estimador (un proveedor, un modelo, un
  endpoint) borraba `estimatorMode` y cada override vecino — apagando en silencio el estimador
  mientras el panel informaba de un guardado exitoso. Ahora cada campo escribe solo sí mismo,
  `undefined` borra exactamente el campo que nombra, y la lectura de confirmación valida el
  mismo conjunto de campos en lugar del modo solamente.
- Nueva cobertura: `packages/selector/tests/preset-options-write.client.spec.ts` (escrituras
  acotadas por ruta, conservación de vecinos, borrados explícitos, parches sin efecto, informe
  de escrituras sin confirmar) y `packages/selector/tests/estimator-channel.client.spec.tsx`
  (campos por canal, desplegables del catálogo, alternativa manual).


### Añadido

- Nuevo perfil `tokenpilot-inspired`: una matriz de capacidades inspirada en el artículo de
  TokenPilot superpuesta a los umbrales Balanced, seleccionable explícitamente desde la
  interfaz de ajustes; cada perfil preexistente conserva una política resuelta idéntica byte a
  byte (impuesta por una prueba golden con base capturada).
- Deduplicación idéntica byte a byte de resultados de herramientas repetidos: un duplicado
  excesivo se reemplaza por un puntero al evento original de solo adición de la primera
  ocurrencia (`dedupe-pointer`), con un índice SHA-256 por sesión (desalojo por orden de
  inserción de 2 048 entradas, metadatos solo hash+seq).
- Guardia de ahorro neto nulo: los reemplazos cuyo texto no es más pequeño que el original se
  rechazan incluso cuando el tokenizer exacto informa de un ahorro de tokens.
- Exención de recuperación: la salida de las herramientas de recuperación queda exenta de forma
  permanente de cada pasada de reducción mediante un conjunto unificado de exenciones por
  sesión, evitando la oscilación comprimir-restaurar.
- Localizador de resumen de Auto Compact: tras `compaction/end`, el punto de control del resumen
  aterrizado gana un bloque Exact Sources (rango de seq ensombrecido, archivos de derrame,
  archivos tocados) para que los detalles resumidos sigan siendo recuperables; se salta si no
  localizaría nada concreto.
- Semántica del estado de lectura: una lectura histórica cuyo archivo mutó después queda
  `superseded` y toma el pequeño marcador del resultado entero; un agrupamiento opcional de
  error/warn/info de las líneas omitidas se añade a los marcadores históricos.
- Estimador opcional de utilidad residual (tres canales: off / modelo de host del Harness /
  endpoint directo compatible con OpenAI) con backoff exponencial por sesión, tiempo límite
  estricto, veredictos consultivos que consume la siguiente pasada de presión, y auditorías
  `estimator-outcome` solo numéricas. La tarjeta del estimador aparece solo mientras el nuevo
  perfil está seleccionado; la clave API es de solo escritura en los ajustes y nunca entra en
  la política congelada, las auditorías ni los registros.
- Nuevos registros de auditoría: `summary-locator` y `estimator-outcome`; el registro de
  reescritura cubre la deduplicación mediante el reductor `dedupe-pointer`. Las listas
  permitidas de campos de auditoría no cambian.
- Textos en chino simplificado e inglés para el nuevo perfil y la tarjeta del estimador;
  cobertura unitaria y golden bajo `packages/runtime/tests/tokenpilot/`.

- Puerta ortogonal de compresión de esqueletos de código (`codeSkeleton.enabled`, desactivada
  por omisión): la primera exposición de un resultado de herramienta de código fuente fresco
  excesivamente grande puede conservar un esqueleto de imports y declaraciones con cuerpos
  elididos y líneas de error preservadas, retrocediendo al recorte de cabeza original. La
  puerta es independiente de cada perfil y está supeditada a la medición con tokenizer exacto.
- Interruptor en la interfaz de ajustes para la puerta, en la sección de ajustes del selector,
  con textos en chino simplificado e inglés.
- Paridad de decodificación navegador/runtime para la nueva sección, pruebas de contrato de
  confirmación al escribir para `saveCodeSkeleton`, y una extensión de la matriz de paridad del
  documento completo.

### Cambiado

- Se añadió una base de configuración plana de ESLint (`pnpm lint`, impuesta en la CI) y un
  bucle TDD `pnpm test:watch`; se eliminaron imports muertos y se endurecieron dos rutas de
  error reveladas por la base de lint.
- Este repositorio se mantiene ahora como un fork mejorado de
  `WilliamShi666/dsh-context-compression-selector`; la documentación se envía en inglés, chino
  simplificado, japonés y coreano.

## 0.1.0 - 2026-09-03

### Añadido

- Versión estable de la integración del tokenizer DeepSeek V4 Flash Vision para
  `deepseek-v4-flash-vision-exp`, incluidos el recuento exacto de texto y estimaciones
  acotadas de tokens de imagen.
- Umbral de Auto Compact configurable por el usuario y dirigido por el modelo en la sección de
  ajustes del selector.
- Vinculación del umbral de Auto Compact con las marcas de agua de History / micro-compact de
  cada perfil estándar y los parámetros de compresión relacionados.

### Cambiado

- El editor del umbral usa ahora una única entrada numérica directa; el deslizador y los
  botones fijos de valores rápidos se eliminaron.
- El acceso a los eventos de sesión del runtime admite tanto el accessor `events` establecido
  del Harness como la más reciente API pública `snapshotEvents()`.

## 0.1.0-beta.4 - 2026-09-02

### Corregido

- Soporte de la API pública oficial `dsh-v0.1.2-alpha.5` de DeepSeek Harness manteniendo la
  compatibilidad con el rango de peers `0.1.1-rc.2` existente. El plugin posee ahora los dos
  pequeños ayudantes de valores inmutables que el Harness más reciente ya no exporta, y usa el
  mismo literal de namespace público `context-compression` que aceptan ambas implementaciones
  de Settings. No se modifica ningún código del núcleo del Harness.

## 0.1.0-beta.3 - 2026-09-01

### Alcance

Esta es una publicación por etapas. Se entregan el recuento exacto de tokens de **clase texto**
para `deepseek-v4-flash-vision-exp`, las estimaciones acotadas de mejor esfuerzo de **imágenes
de clase visión**, y el trabajo de umbral/interfaz/auditoría de Auto Compact. La medición exacta
de imágenes sigue **BLOQUEADA EN EL ORIGEN**: la costura de medición actual no expone ni las
dimensiones proyectadas de las imágenes de la petición del adaptador ni la posición
serializada absoluta, de modo que las estimaciones no pueden promoverse a `exact-tokenizer`.

### Añadido

- Soporte de DeepSeek V4 Flash Vision para `deepseek-v4-flash-vision-exp` mediante un tokenizer
  oficial empaquetado por separado, fijado a la revisión
  `6821d6ad3681a4b137b066b76094fa82ebd0a380` de `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`.
  Texto, reasoning, argumentos de llamadas a herramientas y resultados de herramientas de puro
  texto se cuentan exactamente; los candidatos de resultados de herramientas con imágenes
  siguen en fail-open.
- La aritmética de tokens de imágenes de visión se portó línea por línea desde el
  `inference/image_processor.py` oficial (tamaño de parche 14, submuestreo 3, techo de 384
  tokens, min pixels 147456, fijación de proporción 8:1 y relleno de alineación dependiente de
  la posición), validada contra fixtures golden generadas ejecutando la implementación Python
  oficial. Las dimensiones intrínsecas válidas producen ahora `tokenizer-estimate` en el punto
  medio de los cuatro residuos de alineación con un límite superior de 384 tokens por imagen;
  las dimensiones mal formadas o no evaluables usan una alternativa documentada de 256 tokens.
  Las superficies mixtas de texto/imagen agregan el texto exacto y las imágenes estimadas sin
  promoverlas a exactas.
- Ajuste `autoCompact.thresholdPercent` (por omisión 80, entero 50–90, paso 1) con un único
  contrato de validación compartido entre la interfaz de ajustes, el esquema persistido y el
  resolvedor del runtime. El editor vive dentro de la sección de ajustes del selector
  context-compression.
- Enlace de History de los perfiles estándar con la marca de agua de Auto Compact:
  `A = floor(C × a)` reescala el disparador de History, la recuperación mínima y la cola de
  tokens recientes; `D = floor(A × 0.875)` sustituye a la razón fija de presión de capacidad
  0.7 como puerta de última oportunidad del micro-compact; un lote debe justificar su ruptura
  de caché devolviendo la petición completa por debajo del plazo. Los valores por omisión al
  80 % reproducen exactamente las cifras anteriores.
- El overlay de preset escribe el umbral guardado en la composición `compaction-basic` generada
  como `thresholdRatio` (con `retainRatio` fijado en 0.16) y, desde la misma lectura, en la
  configuración de despliegue del runtime del plugin como `autoCompactThresholdPercent`, de
  modo que una misma generación permanente nunca ejecute Auto Compact y micro compact sobre dos
  umbrales distintos. Cualquier cambio de identidad de generación — umbral, fuente o rutas de
  módulos, incluidos los de igual longitud — produce una nueva generación de la composición
  permanente. Los sellos deterministas derivados de la identidad usan una ventana de segundo
  entero de 8 dígitos hexadecimales; las identidades de prefijo igual pueden colisionar en esa
  primera ventana en un sistema de archivos tosco, así que el overlay observa la clave real
  `mtimeMs+size` del archivo de staging y escala a ventanas de hash posteriores antes del
  renombrado atómico. Contenido, permisos y el sello único final están completos antes de la
  publicación; las sesiones ya en marcha conservan su política congelada.
- Las auditorías `policy-resolved` registran ahora los hechos de coordinación de Auto Compact
  (porcentaje de umbral, `A`, `D`, fuente del parámetro — incluidos `deployment-override`/`mixed`
  cuando la configuración de despliegue reemplaza las marcas de agua de History enlazadas), el
  proveedor/modelo enrutado y la identidad del tokenizer incluido.
- Los ajustes persistidos rechazan las secciones presentes-pero-no-válidas (`profile: null`,
  `custom: null`, propiedad propia `undefined`) antes de que un valor por omisión del esquema
  pueda absorberlas; un documento almacenado mal formado congela la sesión sin pérdida
  (`profile: off`, auditado como `settingsInvalidFallback: lossless-off`) en lugar de activar
  en silencio el valor por omisión con pérdida Balanced. El decodificador del navegador aplica
  la misma regla y canoniza los documentos heredados Custom v1/v2 al mismo documento v3 que
  produce el resolvedor del runtime.
- El planificador de History devuelve un resultado discriminado, y las auditorías
  `component-evaluation` distinguen la taxonomía completa de omisiones: `below-profile-trigger`,
  `below-micro-deadline`, `exact-tokenizer-unavailable`, `no-safe-candidates` (solo salida de
  herramientas de recuperación o resultados ya despejados), `protected-working-set` (todo lo que
  está dentro de la cola protegida), `insufficient-reclaim` y `cannot-reach-deadline-target`
  (con los números de tokens alcanzado/requerido), `adaptive-cost-rejected`, y
  `recovery-tool-unavailable`.

### Limitaciones conocidas

- Las imágenes nunca reclaman recuentos exactos. La expansión oficial depende de la posición
  absoluta en el prompt (prompt de sistema, enmarcado de la plantilla de chat, manejadores de
  imagen del adaptador) y de la proyección final de las imágenes de la petición del adaptador
  (incluidos los overrides `imagePixelBudget`/`imageDetail` por ruta y la reproyección del
  tope de bytes), nada de lo cual está expuesto por la costura de medición actual. Las
  estimaciones intrínsecas/por omisión pueden por tanto diferir materialmente de la contabilidad
  del proveedor. Las peticiones de capacidades al origen siguen siendo: dimensiones proyectadas
  de las imágenes de la petición y la posición serializada absoluta expuestas a las extensiones
  de medición de tokens.
- History salta el lote entero en cuanto algún candidato de resultado de herramienta carece de
  recuento exacto, incluidos los candidatos con imágenes, aunque los candidatos de texto
  vecinos sean individualmente exactos.
- Custom sigue en modo de tokens manual; sus parámetros de History no siguen la marca de agua
  de Auto Compact.
- No se envía una interfaz de desglose de tokens de visión; las estimaciones de imágenes y el
  diagnóstico de alineación intrínseca están disponibles en la vista de tokens medidos, mientras
  que las pruebas de reescritura con pérdida siguen requiriendo recuentos exactos.

### Diferido

- Campo `modality` de auditoría y el SHA-256 del artefacto del tokenizer dentro de los
  registros de auditoría (las auditorías ya llevan el proveedor/modelo enrutado y la identidad
  del tokenizer).
- Publicación de la (ya completa) taxonomía de razones de omisión del runtime como tabla de
  documentación orientada al usuario.
- Visualización de las marcas de agua A/D para el perfil Custom y un aviso por encima de D;
  Custom sigue siendo totalmente manual.
- Interfaz de desglose de tokens de visión y promoción de las estimaciones de imágenes a
  medición exacta.

## 0.1.0-beta.2 - 2026-08-28

### Corregido

- Resolver la ruta del tokenizer oficial DeepSeek V4 Flash para que Fresh y Aggregate puedan
  evaluar los resultados de herramientas de los modelos V4 admitidos.
- Ejecutar Cache Strict History en el límite real de petición en cuanto se cumpla su condición
  configurada de presión de capacidad; disparar la condición de capacidad al 70 % de utilización
  del contexto enrutado.
- Desactivar la poda nativa de cabeza/medio/cola de resultados de herramientas del Harness
  siempre que un perfil del selector esté activo, dejando el selector como el único compactador
  de resultados de herramientas.

### Cambiado

- Proteger las 10 llamadas a herramientas más recientes del agente y una ventana de cola de
  resultados de herramientas de 64 000 tokens antes de que History/microcompact reescriba
  resultados más antiguos.

## 0.1.0-beta.1 - 2026-08-27

### Añadido

- Product Bundle de DeepSeek Harness de una sola instalación apoyado en un paquete de runtime
  separado de versión exacta.
- Selector de perfil web con ajustes estables por preset y una excepción Minimal integrada
  explícita.
- Fresh, Aggregate, History consciente de rutina/capacidad, poda nativa de resultados de
  herramientas y TailTrim Custom desactivado por omisión.
- Protocolo TailTrim de eventos estándar usando `compaction/prune` más un reemplazo recuperable
  de `user/message`.
- Herramienta de recuperación `context_compression_retrieve` propiedad del plugin.
- Registros de auditoría estructurados y sin contenido para política, evaluación, reescritura,
  fallos y auto-compact nativo.
- Activos del tokenizer oficial DeepSeek V4 fijados con validación SHA-256 en el runtime y
  licencia del origen.
- Pruebas de regresión e2e de componentes sobre la API pública, preset/Minimal y prefijos de
  caché parent/fork/spawn.

### Compatibilidad

- Verificado contra los paquetes públicos `dsh-v0.1.1-rc.2` de DeepSeek Harness.
- El mapeo exacto de tokenizers está limitado actualmente a `deepseek-v4-flash` y
  `deepseek-v4-pro`.

### Limitaciones conocidas

- La History adaptativa ordinaria falla cerrada cuando la evidencia pública de ruta/caché a
  nivel de petición está incompleta; la presión de capacidad sigue siendo una anulación de
  seguridad separada.
- Las pruebas de prefijos de caché prueban la herencia nativa del fork y prefijos serializados
  idénticos, no una asignación de caché específica del proveedor ni un acierto garantizado en
  la caché de DeepSeek.
- Las instantáneas de ajustes y las decisiones de primera exposición son locales al proceso del
  runtime montado.
