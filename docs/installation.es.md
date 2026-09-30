# Instalación de dsh-context-compression-improved

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md) · [Français](installation.fr.md) · [Deutsch](installation.de.md) · [Italiano](installation.it.md) · [Русский](installation.ru.md) · [Español](installation.es.md)

Esta guía instala el fork desde el código fuente. El fork también está publicado en npm como
`dsh-context-compression-improved` bajo el dist-tag `dsh-0.1.5`; el nombre del paquete
permanece deliberadamente como el del upstream. El runtime, que antes era un segundo paquete,
ahora forma parte de él, de modo que una sola instalación trae toda la pila.

## Requisitos previos

- Node `^22.19.0 || >=24` y pnpm `11.7.0` (`corepack enable` toma la versión fijada del campo `packageManager`).
- Una instalación de DeepSeek Harness compatible con el rango de peers `0.1.1-rc.2` (verificado contra la versión oficial `dsh-v0.1.2-alpha.5`).
- Una ruta de modelo DeepSeek. La compresión con pérdida — incluida la puerta de esqueleto de código — decide sobre la base de caracteres, de modo que ya no queda ningún requisito de ruta con tokenizer incluido; cuando existe un tokenizer incluido, sus recuentos exactos se registran como telemetría, y las demás rutas fallan de forma abierta (fail-open) y conservan los resultados de herramientas originales.
- Git.

## 1. Compilar desde el código fuente

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` empaqueta ambas caras de biblioteca de cada paquete (`tsdown`). Ejecute antes `pnpm test` si quiere la suite completa en su máquina antes de instalar.

## 2. Empaquetar el paquete de entrada del Bundle

El paquete selector es la única entrada del Bundle; el runtime lo acompaña como dependencia de versión exacta:

```sh
cd packages/selector
pnpm pack
# → dsh-context-compression-improved-0.1.0.tgz
cd ../..
```

`pnpm pack` pasa el bundle por el hook `prepack`, de modo que el tarball siempre coincide con su checkout.

## 3. Añadirlo a un perfil de Harness

El paquete selector declara el campo de manifiesto Bundle del Harness `dsh.bundle.patch`, por lo que `dsh plugin add` es la ruta de instalación Bundle fuera del árbol estándar:

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.1.0.tgz
dsh --profile web --dump-config
```

Reinicie el perfil seleccionado tras la instalación. El volcado de configuración debería listar el Bundle selector como activo. **No** instale ni conecte por separado los paquetes selector y runtime — el runtime se instala automáticamente.

## 4. Activar la puerta de esqueleto de código

Abra los ajustes de DeepSeek Harness → **Context compression selector**:

1. Elija un perfil de compresión (la puerta es ortogonal a todos).
2. Ajuste opcionalmente el nivel de disparo de Auto Compact (50–90 %, 80 % por omisión).
3. Ponga **Code skeleton compression** en **On**. El interruptor guarda con cada cambio.

Como todos los ajustes del selector, el valor se congela cuando una sesión lo observa por primera vez — la puerta afecta a las sesiones observadas a partir de ese momento, nunca a una tarea que ya esté en marcha.

## 5. Opcional: el asesor de relevancia consultivo

El plugin puede mantener estadísticas sobre lo pertinente que sigue siendo el historial de la sesión — solo consultivo, nunca decide ni bloquea nada. Viene desactivado; actívelo editando la sección `presetOptions` de los ajustes de compresión de contexto (JSON de ajustes, sin tarjeta en la interfaz por ahora):

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

`advisorMode: "host"` llama al servicio `llm` del harness; `"direct"` reutiliza el endpoint
`estimatorBaseUrl` / `estimatorApiKey` / `estimatorModel` del estimador. En cada frontera de
turno el asesor (1) resume la tarea actual a partir del evento `todo/write` más reciente,
(2) puntúa de forma incremental los resultados de herramientas históricos por relevancia de
contenido y comentarios, y (3) registra una cifra de decaimiento de prefijo. Los resultados
aparecen como registros de auditoría `advisor-outcome` y, con la bandera de despliegue
`advisorReportRoute: true`, mediante una ruta HTTP de solo lectura
`GET .../advisor-report?sessionId=`. Lo que el asesor informa nunca puede suprimir, retrasar
ni reescribir una reducción que deba aplicarse.

## 6. Actualizar o eliminar

```sh
# update: pull, rebuild, repack, and add the new tarball again
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.1.0.tgz

# remove
dsh plugin --profile web remove dsh-context-compression-improved
```

## Solución de problemas

- **El Bundle no aparece activo en el volcado**: reinicie el perfil; confirme que añadió el paquete de entrada del selector (no el runtime) y que la versión del Harness está dentro del rango de peers compatible.
- **Los resultados de herramientas nunca se comprimen a esqueleto**: la puerta viene desactivada; revise el interruptor. La compresión solo se aplica a resultados de herramientas frescos, excesivos y de código fuente (las decisiones corren sobre la base de caracteres; no hay requisito de ruta con tokenizer exacto), y cada omisión queda registrada con su motivo en la traza de auditoría.
- **El interruptor aparece como ilegible**: la sección `codeSkeleton` almacenada no superó el decodificado estricto del navegador (debe ser exactamente `{ enabled: boolean }`). Eliminar la sección mal formada restaura los valores por omisión.
- **La actualización falla en el paso de upgrade**: el plugin sigue la semántica de paquetes de npm; elimine primero la versión antigua si su build del Harness rechaza un upgrade de tarball a tarball.
