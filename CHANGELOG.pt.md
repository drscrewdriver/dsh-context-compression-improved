# Registro de mudanças

> [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [日本語](CHANGELOG.ja.md) · [한국어](CHANGELOG.ko.md) · [Français](CHANGELOG.fr.md) · [Deutsch](CHANGELOG.de.md) · [Italiano](CHANGELOG.it.md) · [Русский](CHANGELOG.ru.md) · [Español](CHANGELOG.es.md) · [Português](CHANGELOG.pt.md)

Todas as mudanças notáveis são registradas neste arquivo. O projeto segue o versionamento semântico a partir de `0.1.0`.

## 0.11.4

- i18n: adiciona o locale português (pt-BR) — dicionário em tempo de execução (`Português (Brasil)` na lista de idiomas do seletor), metadados `locale/*.json` do pacote para os dez idiomas, espelhos README/CHANGELOG e links de navegação bidirecionais.

## 0.11.3

- Corrige o ruído de aviso do registro multilíngue: `addLanguage`/`register` agora ignoram benignamente registros duplicados (mesma abordagem do media-lens).
- Corrige um erro de tipo no servidor: `candidates[0]` era `string | undefined` sob `noUncheckedIndexedAccess`; passou a tupla `as const`.

## 0.11.2

- Face de terminal (dsh-tui / paleta de comandos do Desktop, mesma fonte): face somente-leitura (status) dos ajustes de compressão.

## 0.11.0 (2026-11-07)

- sediment: sedimentação ao fim do turno (desligada por padrão, porta `sediment.enabled`) — substituição atômica do turno inteiro com três guardas (somente reason=completed / hierarquia de qualidade de resumo / cauda sempre preservada), pool de proteção por linha, linha de máscara para leituras e escritas grandes, guarda de custo de reescrita (defesa contra repagamento 1:15) e prova de encurtamento antes de cada publicação; curto-circuito de envelhecimento consciente de PTC e laço de retroalimentação K=5 que aperta para modo conservador; canal de dobra com endpoints em camadas e relatório de latência p50/p95/p99.
- shallow: primitivas do par upgrade-discard — seletor de amostra de cabeçalho `type(path)` O(1), `skeleton` com ponto de verificação de divisão (nunca descartável), `discard(ref)` com guarda de cobertura assimétrica por direção e retrieve-como-desfazer; descartes iniciados pelo modelo são contabilizados à parte (`component: shallow-discard`).
- ui/gates: linha de ajustes (mesma seção do codeSkeleton, nove idiomas), bloco de sedimentação no monitor e texto de divulgação; engines/peers migrados para forma de intervalo (`>=0.1.1-rc.2 <0.3.0`) com verificação de formato no verify-release; especificação package-contract single-sourced de scripts/hosts.mjs.

## 0.10.2 (2026-10-28)

- fab: a persistência da posição da bola flutuante do monitor passou a usar fração do viewport ({fx,fy}, 4 decimais) com promessa de seguimento de canto após reinício/maximização/mudança de resolução, substituindo o modelo de pixel absoluto; arquivos {x,y} legados se normalizam ao carregar (migração zero); o módulo puro `src/client/fab-pos.ts` é byte-idêntico ao do dsh-browser-cdp e fixado por specs dedicadas.

## 0.10.0 (2026-10-24)

- hosts: adendo de enumeração declarativa do 0.2.1-rc.3 (18 rc; dif zero no plano de contrato) — enviado junto com o recurso de estatísticas abaixo.
- stats: painel por sessão e persistência — três contagens de economia (estoque atual / acumulado por N chamadas / dinheiro com ponderação de cache) no SQLite com dupla direção de driver e degradação visível; gravação idempotente por chave composta, texto original nunca no banco; contabilização de recall corrigida; recomposição somente-leitura de sessões antigas via jsonl; endpoint paginado `GET /savings/sessions`; comando de painel `/ccip`; novas chaves de painel nos nove idiomas e sanitização do errorMessage auditado.

## 0.9.8 (2026-10-18)

- hosts: adendo de enumeração declarativa do 0.2.1-rc.2 (34/34 peers `@deepseek-ai/*` verificados rc.2 no registro por npm; zero mudança de código, release puramente de metadados).

## 0.9.3 - 2026-10-08

- corrigido o matador de retomada ≤0.1.1: a entrada do loader tool-result-pruner falhava ao importar porque a tabela de módulos do host 0.1.0/0.1.1 não expõe `SessionSeq`/`deriveEventMessage`; as importações nomeadas estáticas morriam no link ESM e derrubavam todo o preset `standard`. Agora são soft-imports de namespace com degradação detectada por feature (SessionSeq → identidade, deriveEventMessage → null mapeado a unavailable).

## 0.9.2 - 2026-10-08

- revertido: a entrada `settings.section` autônoma (上下文压缩选择器, order 17, identidade de componente 0.9.0) volta como único assento de navegação de ajustes; a aba `dsh-family.tab` introduzida no 0.9.1 é removida (decisão do usuário: perm-gate e cci nunca estiveram no escopo de familização). O cartão `plugins.bundle.config` permanece com o adaptador de closure compartilhado (agora só bundle-card).
- os quatro specs de client (settings-seat / code-skeleton / custom-contract / preset-options-write) voltam aos contratos do 0.9.0.

## 0.9.1 - 2026-10-08

- consolidação dos ajustes na aba da família in-section (entrada top-level aposentada; painel só como `dsh-family.tab`, order 55), componente passando pelo adaptador de closure compartilhado `useCompression`; label `tNav` vinculado cedo mantido.
- corrigidos metadados de versão desatualizados em `packages/selector/dsh.plugin.json`.

## 0.9.0 - 2026-10-08

- uma versão para toda a linha Harness: 0.9.0 serve os 15 rc de 0.1.0-rc.2 a 0.2.0-rc.2 (seis linhas); o esquema de dist-tags por linha é aposentado (`latest` e as tags antigas apontam para 0.9.0).
- cintura de ajustes de três gerações: detecção em inicialização da face exposta pelo host (`settings.register` legado vs volatile + `configForms`) e armed só da superfície cliente correspondente, mais o cartão de detalhe `plugins.bundle.config` em 0.1.7+.
- ponte de ajustes (lease para escrever nas linhas legadas; leitura direta do documento configForms nas modernas, gravações pela ponte devolvem 409), correções de sonda de geração/validador de tail-trim/armação configForms e enumeração completa dos peers 15 rc.
## 0.8.0 - 2026-10-02

- Release estável da linha 0.8.0-beta.*: monitor de compressão flutuante, resumo de intenção ao fim do turno, estatísticas de economia com contabilização honesta e locais ja/ko.

## 0.8.0-beta.7 - 2026-10-02

- Sugestão de compressão na zona de esquecimento catastrófico: o snapshot do monitor passa a carregar um bloco `suggestion` quando a ocupação de contexto entra na faixa de risco.
- A observação da ocupação de contexto foi desacoplada do portão de resumo de intenção: a cada turno o postflight observa os tokens ativos vs. a janela, mesmo com o resumo desligado.

## 0.8.0-beta.6 - 2026-10-02

- Vinculação de sessão para o monitor flutuante: um slot `conversation.input.left` deliberadamente invisível carrega o estado da sessão; barra de ocupação de contexto no painel.
- Correção: os specs de client que capturavam a face de ajustes pela presença de `inject` agora se ancoram na sonda de geração.

## 0.8.0-beta.5 - 2026-10-02

- Painel flutuante (FAB) do monitor de compressão: um balão arrastável ao lado da área de entrada abre o estado ao vivo (economia líquida, taxa de acerto de cache, custo, portões recentes).
- O auxiliar de precificação de economia foi movido para `runtime/monitor.ts`, compartilhado pelas rotas de savings e monitor.

## 0.8.0-beta.4 - 2026-10-02

- Resumo de intenção ao fim do turno (mesclado da linha feat/intent-summary): o postflight de fronteira de turno, porta de crescimento dobra o incremento consumido em blocos por papel semântico; override por sessão `/ctx-summary off|on|status`.
- `@deepseek-ai/dsh-commands` entra no conjunto de runtime fornecido pela instalação e os portões de release acompanham o custo de posição.

## 0.8.0-beta.3 - 2026-10-01

- Estatísticas de economia com contabilização honesta (inspiradas no conceito dsh-token-optimizer): toda redução publicada alimenta um livro-razão por sessão com bases exata/estimada separadas e nunca somadas.
- Superfícies: rota somente-leitura `GET /{endpoint,api}/dsh-context-compression-improved/savings` (sempre ativa, só agregados); monitoramento de agregação de uso e cache-hit; estimativa de custo quando a rota resolve para um registro de preço oficial DeepSeek.

## 0.8.0-beta.2 - 2026-10-01

- Dicionários de locale japonês (`ja`) e coreano (`ko`) para a seção de ajustes do seletor, levando a superfície cliente a nove idiomas.

## 0.8.0-beta.1 - 2026-09-30

- Linha de compatibilidade Harness 0.2.0: todos os 23 intervalos peer `@deepseek-ai/dsh-*` movidos para a nova enumeração; 39/41 overrides pinados e 46/48 dev-dependências em `0.2.0-rc.1`.
- Portões de release re-targetados: o pino do harness e2e de instalação empacotada agora verifica o checkout da nova linha.

## 0.6.5 - 2026-09-29

- Alinhamento de dev-dependencies à linha Harness 0.1.7 (46 de 48 pacotes `@deepseek-ai/dsh-*`); a costura de ajustes do test-host foi reconstruída contra o host 0.1.7 real.
- Adaptações de teste reveladas pela linha de base real; portões de release repinados ao 0.1.7 oficial; `packages/selector/dsh.plugin.json` passa a carregar a versão do release; dívida de lint das adaptações manuais do 0.6.3 quitada.

## 0.6.4 - 2026-09-26

- O vinculador de locale do client é eager: trocar o idioma do host agora re-renderiza a seção de ajustes imediatamente.
- Release feito a partir de um stash que nunca foi commitado em nenhum branch (a árvore de trabalho que o publicou); corrigido com o histórico reencaixado.

## 0.5.4 - 2026-09-20

- A superfície de instalação declara `@deepseek-ai/schemastery` como dependência de runtime; o pacote publicado não quebrava só porque o host o fornecia.
- `verify:release` passa a derivar as dependências da superfície de instalação dos especificadores nus usados no código.

## 0.5.3 - 2026-09-20

- O patch Bundle não define mais a flag aposentada `reviewQueueRoute`; artefatos gerados fixados em LF (`packages/selector/lib/ text eol=lf`).
- Pin de contrato negativo no patch Bundle: falha quando uma chave de config aposentada ressurge; o contrato de assento do client também fixa a degradação em hosts antigos que não declaram o serviço.

## 0.5.2 - 2026-09-20

- O pipeline de revisão com porta humana (beta) foi aposentado; sua semântica é substituída pelo caminho determinístico de redução.
- Removidos com a porta: a fila de revisão e seu adaptador `storageDomain`, o processo-wide lock; pins de regressão da aposentadoria num spec de integração de host. Rollback: reinstalar o último release que ainda traz a porta via `npm dist-tag add`.

## 0.5.1 - 2026-09-20

- A composição concorrente de overlay de preset de uma identidade não falha mais no Windows.
- Reparo dos portões de release e de testes que escondiam este e outros vermelhos pré-existentes.

## 0.5.0 - 2026-09-20

- Advisor consultivo de relevância (só estatísticas e sugestões, desligado por padrão): a cada turno resume a tarefa atual e pontua resultados históricos por relevância; nunca suprime, atrasa ou reescreve uma redução.

## 0.4.0 - 2026-09-20

- O plugin não depende mais do id de modelo roteado: cada porta de planejamento decide sobre a base de caracteres.
- Precificação de benefício em lote (R1), mapeamento de linhas do evento original (R9a), esqueleto de documentos e prosa universal conservada (R8/R8b), dobra de busca em dois níveis (R10), dobra de frequência não adjacente (R11), placeholders de strings longas (R12), redução HTML em duas etapas (R13), âncoras R9b e censo de documentos com cabeçalhos de seção.

## 0.3.1 - 2026-09-18

- O pacote runtime foi mesclado ao pacote selector: uma instalação traz a pilha inteira; adaptação ao Harness oficial `v0.1.5-rc.2` (dev deps e conjunto e2e pinados migrados).
- Operações de substituição de superfície usam o formato v3 `startSeq`/`endSeq` com valores `SessionSeq` brandados; o bundle do client não importa mais o `@deepseek-ai/dsh-client-runtime` removido; a detecção Minimal foi aposentada com a remoção do `agentPreset` no browser.
- Corrigido: o cartão do estimador não exige mais chave de API no canal do host; gravações de `presetOptions` passaram a ser endereçadas por caminho (cobria a seção inteira ao tocar um único campo).

## 0.1.0 - 2026-09-03

- Release estável da integração do tokenizer DeepSeek V4 Flash Vision para `deepseek-v4-flash-vision-exp`, com contagem exata de texto e aritmética de bounding box de imagem.
- Limiar de Auto Compact orientado por modelo, configurável pelo usuário na seção de ajustes do seletor, com vinculação aos marcos History/micro-compact de cada perfil padrão.
- O editor do limiar passou a usar uma única entrada numérica direta; o slider e os botões de valores rápidos foram removidos.

## 0.1.0-beta.4 - 2026-09-02

- Suporte à API pública do Harness oficial `dsh-v0.1.2-alpha.5` mantendo a compatibilidade com o intervalo peer `0.1.1-rc.2` existente.

## 0.1.0-beta.3 - 2026-09-01

- Suporte a visão DeepSeek V4 Flash (`deepseek-v4-flash-vision-exp`) com tokenizer oficial separado pinado; aritmética de tokens de imagem porta da linha oficial `inference/image_processor.py` (patch 14, downsample 3, 384 tokens).
- Ajuste `autoCompact.thresholdPercent` (padrão 80, inteiro 50–90) com contrato de validação compartilhado; vinculação History dos perfis padrão ao marco de Auto Compact (`A = floor(C × a)`); audits `policy-resolved` registram os fatos de coordenação; resultados discriminados do planejador History com taxonomia completa de omissões.
- Limitações conhecidas: imagens nunca afirmam contagens exatas; o History salta o lote inteiro quando qualquer candidato carece de contagem exata; o Custom permanece em modo token manual; nenhuma UI de quebra de tokens de visão.

## 0.1.0-beta.2 - 2026-08-28

- Resolve a rota do tokenizer oficial DeepSeek V4 Flash para Fresh e Aggregate avaliarem resultados de ferramentas nos modelos V4 suportados.
- O Cache Strict History roda na fronteira real da requisição quando a condição de pressão de capacidade é atingida; a poda nativa de cabeça/meio/cauda é desligada enquanto um perfil do seletor está ativo.
- Protege as 10 chamadas de ferramentas mais recentes do agente e uma cauda de 64.000 tokens antes que History/microcompact reescreva resultados antigos.

## 0.1.0-beta.1 - 2026-08-27

- Produto Bundle DeepSeek Harness de instalação única sustentado por um pacote runtime separado de versão exata; seletor de perfil web com ajustes estáveis por preset e exceção Minimal explícita.
- Fresh, Aggregate, History rotineiro/consciente de capacidade, poda Native e Custom TailTrim desligado por padrão; protocolo TailTrim sobre eventos padrão; ferramenta de recuperação `context_compression_retrieve`; registros de auditoria estruturados sem conteúdo; assets de tokenizer V4 pinados com validação SHA-256.
- Compatibilidade verificada contra o Harness `dsh-v0.1.1-rc.2`; mapeamento exato de tokenizer limitado a `deepseek-v4-flash` e `deepseek-v4-pro`; snapshots de ajustes e decisões de primeira exposição são locais ao processo do runtime montado.
