# Handoff de implementação: `caldav-mcp`

## Status do design

Design validado em 2026-07-26 por meio da skill de brainstorming.

Este documento substitui o rascunho anterior. Ele é a fonte de verdade para a
implementação inicial.

## Resumo de entendimento

- Criar um MCP público e reutilizável, escrito em TypeScript, para gerenciar calendários
  por CalDAV e criar eventos com múltiplos alarmes nativos `VALARM`.
- Manter um núcleo CalDAV genérico, mas declarar suporte público somente ao iCloud
  Calendar na primeira versão.
- Atender um usuário e uma conta CalDAV por processo/container.
- Distribuir exclusivamente como imagem Docker pelo GHCR; não publicar pacote npm.
- Disponibilizar `stdio` para desenvolvimento local e Streamable HTTP no container/NAS.
- Implantar o container em uma rede confiável do NAS, sem exposição direta à internet.
- Preservar dados iCalendar desconhecidos e impedir sobrescritas concorrentes com ETags.

## Objetivo

O fluxo principal de produção será:

```text
Cliente ou agente MCP → MCP no NAS (Streamable HTTP) → CalDAV → iCloud Calendar
```

O fluxo local de desenvolvimento poderá usar:

```text
Cliente MCP local → stdio → caldav-mcp → servidor CalDAV
```

O Home Assistant não participa da solução.

O projeto deve ser criado e mantido em:

```text
/Users/lucasgiglio/Documents/Development/caldav-mcp
```

## Referências locais

Usar como base de arquitetura, testes, documentação, container e publicação no GHCR:

```text
/Users/lucasgiglio/Documents/Development/kitchenowl-insights-mcp
```

Usar como referência de estilo TypeScript, lint e formatação, adaptando as regras de
frontend para um serviço Node.js:

```text
/Users/lucasgiglio/Documents/Development/hermes-chat-ui
```

As regras obrigatórias de TypeScript deste projeto têm precedência sobre as referências:

```text
/Users/lucasgiglio/Documents/Development/caldav-mcp/.codex/rules/typescript.md
```

Não copiar nomes, tokens, URLs privadas, dados pessoais ou decisões específicas dessas
referências.

## Premissas e requisitos não funcionais

### Escala e desempenho

- Uso pessoal, uma conta CalDAV e baixa concorrência.
- Não há objetivo de atender múltiplos tenants ou tráfego público.
- `list_events` aceita intervalos de até 366 dias.
- O limite padrão é 100 resultados e o máximo é 500 por página.
- Recursos iCalendar individuais podem ter no máximo 5 MiB.
- Em condições normais de rede, chamadas comuns devem terminar em até 5 segundos; isso é
  um objetivo operacional, não um SLA, pois o iCloud é uma dependência externa.
- Requisições CalDAV têm timeout configurável, com padrão de 30 segundos.

### Segurança e privacidade

- O endpoint Streamable HTTP fica restrito à rede confiável do NAS/Docker.
- Não haverá autenticação HTTP na primeira versão; essa limitação deve ser destacada.
- Usuário, senha, cabeçalhos de autenticação e URLs com credenciais nunca aparecem em
  logs, exceções MCP ou fixtures.
- Dados de calendário são tratados como conteúdo externo não confiável.
- O serviço aceita somente calendários descobertos para a conta configurada; argumentos
  MCP não podem direcionar requisições para URLs arbitrárias.
- A conexão ocorre diretamente entre o processo no NAS e o servidor CalDAV.

### Confiabilidade e disponibilidade

- Serviço stateless, sem banco ou volume persistente.
- Disponibilidade best effort, sem alta disponibilidade ou SLA.
- O Compose usa `restart: unless-stopped`.
- Escritas nunca são repetidas automaticamente.
- ETags e requisições condicionais protegem contra sobrescritas concorrentes.
- Falhas após uma resposta de escrita ambígua exigem releitura antes de nova tentativa.

### Manutenção

- O proprietário do repositório mantém o projeto e aprova releases.
- Dependências ficam fixadas no lockfile e são atualizadas explicitamente.
- CI, teste de integração e checklist manual do iCloud são as evidências de release.
- Publicar sob licença MIT e incluir `SECURITY.md`.

## Não objetivos do MVP

- Múltiplas contas por processo ou deployment multiusuário.
- Exposição do endpoint MCP diretamente à internet.
- Autenticação ou autorização HTTP do endpoint MCP.
- Google Calendar, OAuth, Nextcloud, Baïkal, Fastmail ou suporte declarado ao Radicale.
- Atualizar ou excluir apenas uma ocorrência de uma série recorrente.
- Criar ou editar diretamente `RDATE`, `EXDATE` ou exceções com `RECURRENCE-ID`.
- Transporte SSE legado ou outros transportes além de `stdio` e Streamable HTTP.
- Publicação no npm, execução via `npx` ou manutenção de um pacote npm público.
- Dependências de Java, Python ou Home Assistant no runtime.

## Riscos principais

| Risco                                       | Impacto                                                                                | Mitigação                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Comportamentos não documentados do iCloud   | Alarmes ou discovery podem funcionar no teste genérico e falhar em dispositivos Apple. | Checklist manual obrigatória em calendário real antes da primeira release compatível.           |
| Credenciais do iCloud indisponíveis na CI   | A automação não comprova interoperabilidade Apple.                                     | Separar claramente evidência automatizada de resultado manual `aprovado` ou `não executado`.    |
| Round-trip alterar dados desconhecidos      | Atualizações podem remover extensões, timezone ou exceções.                            | Mutar o recurso completo, usar fixtures reais sanitizadas e comparar propriedades antes/depois. |
| Concorrência ou resposta de escrita ambígua | Perda de alterações ou duplicação de evento.                                           | `If-None-Match`, `If-Match`, releitura e erro `WRITE_RESULT_UNKNOWN`, sem retry automático.     |
| Endpoint HTTP sem autenticação              | Um cliente na rede poderia ler ou alterar o calendário.                                | Restringir a porta à rede confiável e destacar que exposição direta à internet é proibida.      |
| Recorrência complexa                        | Uma ocorrência pode ser confundida com a série inteira.                                | Identificação explícita e bloqueio de mutações de ocorrência isolada no MVP.                    |
| Mudanças em `tsdav`, `ical.js` ou SDK MCP   | Quebra de API ou serialização.                                                         | Lockfile, adapters locais, testes de contrato e upgrades deliberados.                           |
| Nome genérico sugerir suporte amplo         | Usuários podem esperar compatibilidade não testada.                                    | README declara iCloud como único provedor suportado e perfil `generic` como experimental.       |

## Decision Log

| Decisão                                                 | Alternativas consideradas                                      | Motivo                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Uma conta por processo/container                        | Multiaccount e multitenancy                                    | Compatível com o uso pessoal e reduz riscos de isolamento de credenciais.                 |
| Manter o nome `caldav-mcp`                              | `caldav-alarms-mcp`, nomes contendo iCloud                     | Preservar o nome escolhido; a documentação esclarecerá o suporte exclusivo ao iCloud.     |
| Núcleo genérico, suporte declarado apenas ao iCloud     | iCloud estrito; vários provedores suportados                   | Mantém extensibilidade sem prometer compatibilidade não validada.                         |
| `CALDAV_PROVIDER=generic                                | icloud`                                                        | Perfil único                                                                              | Separa o padrão das extensões Apple sem duplicar o serviço. |
| Radicale apenas como fixture de integração              | Somente mocks; suporte público ao Radicale                     | Oferece teste DAV real sem ampliar a matriz de suporte.                                   |
| Distribuição apenas por Docker/GHCR                     | npm/`npx`; binário standalone                                  | O destino é um NAS e deve seguir o modelo do KitchenOwl MCP.                              |
| `stdio` local e Streamable HTTP no NAS                  | Apenas `stdio`; apenas HTTP                                    | Mantém desenvolvimento simples e permite serviço persistente no NAS.                      |
| Porta interna padrão `8100`                             | Reutilizar `8099`                                              | Evita conflito com o KitchenOwl MCP já implantado.                                        |
| Node.js 24 LTS                                          | Node.js 20; linha Current                                      | Node 20 está EOL e Node 24 é uma linha LTS suportada.                                     |
| SDK MCP v1 estável no início da implementação           | v2 pre-release                                                 | A linha v1 é a recomendada para produção na data deste design.                            |
| União explícita para evento temporizado/dia inteiro     | Strings soltas e flag `all_day`                                | Evita ambiguidades de timezone e fim exclusivo.                                           |
| Expandir recorrências em `list_events`                  | Retornar somente o mestre                                      | A listagem por intervalo precisa representar ocorrências reais.                           |
| Bloquear mutação de ocorrência isolada                  | Alterar silenciosamente toda a série                           | Evita uma operação destrutiva inesperada.                                                 |
| `resource_id` opaco e ETag                              | Presumir `<UID>.ics`; operar apenas por UID                    | Preserva o `href` real e permite concorrência otimista.                                   |
| `UID` em todos os `VALARM`                              | Apenas no perfil Apple                                         | `UID` de alarme é padronizado pelo RFC 9074.                                              |
| Extensões `X-WR-*`/`X-APPLE-*` somente no perfil iCloud | Emitir sempre                                                  | Extensões proprietárias não devem contaminar o perfil genérico.                           |
| Sem autenticação HTTP no MVP                            | Token ou reverse proxy integrado                               | O endpoint ficará limitado à rede confiável; a limitação será documentada.                |
| Aplicar integralmente `.codex/rules/typescript.md`      | Usar apenas `strict`; copiar a configuração frontend do Hermes | As regras locais são obrigatórias e devem ser adaptadas a Node sem perder rigor.          |
| Proibir casts TypeScript                                | Permitir assertion comentada como último recurso               | A proibição explícita de `as` prevalece sobre a orientação conflitante de último recurso. |
| Usar comandos pnpm equivalentes                         | Executar literalmente `npx tsc` e `npm run lint`               | Mantém a intenção de verificação da regra sem reintroduzir npm no fluxo do projeto.       |

## Nome e apresentação pública

- Nome do repositório: `caldav-mcp`.
- Nome da imagem: `ghcr.io/<proprietário-do-repositório>/caldav-mcp`.
- Nome interno do pacote: `caldav-mcp`, com `"private": true`.
- Título público: `CalDAV MCP Server`.
- Descrição: `A TypeScript MCP server for iCloud Calendar with native multi-VALARM support.`
- A primeira seção do README deve afirmar que somente iCloud Calendar é suportado e
  testado na primeira versão.
- Incluir aviso de que o projeto é independente e não é autorizado, patrocinado ou
  aprovado pela Apple Inc.
- Não usar logotipo, ícones ou identidade visual da Apple.

Não criar configuração de publicação npm, exemplos com `npx`, badge npm ou critério de
aceite relacionado ao registro npm.

## Stack técnica

- TypeScript com `strict: true`.
- Node.js 24 LTS ou superior suportado.
- ESM.
- `pnpm`, fixado por `packageManager` no `package.json`.
- SDK oficial MCP, usando a linha estável recomendada para produção e fixada no lockfile.
- Zod para schemas de entrada e saída.
- `tsdav` para descoberta e transporte CalDAV.
- `ical.js` para parsing, expansão e serialização iCalendar.
- Vitest para testes.
- ESLint e Prettier.

Não montar `.ics` por concatenação não escapada de strings.

## Regras TypeScript obrigatórias

O código deve obedecer integralmente a `.codex/rules/typescript.md`. Para este backend,
isso significa:

### Proibições

- não usar `any`, implícito ou explícito;
- não usar casts TypeScript com `as` nem assertions com sintaxe de angle brackets;
- não usar non-null assertion (`!`);
- não declarar tipos da aplicação com `interface`; usar `type`;
- não usar `@ts-ignore`, `@ts-expect-error`, `eslint-disable` ou comentários equivalentes;
- não usar default exports;
- não declarar funções com `function`; usar arrow functions atribuídas a `const`;
- não importar arquivos internos de outro domínio por caminhos profundos;
- não relaxar regras do compilador ou linter para resolver um erro localizado.

### Padrões exigidos

- tratar dados externos como `unknown` e validá-los com Zod ou type guards;
- validar na fronteira os dados CalDAV/iCalendar consumidos, mesmo quando uma dependência
  fornecer tipos TypeScript;
- usar `type` para modelos, contratos e uniões discriminadas;
- preferir inferência a anotações redundantes;
- usar generics quando uma função realmente opera sobre múltiplos tipos;
- corrigir a definição de tipo ou criar um type guard diante de um erro;
- criar `index.ts` como barrel em cada domínio;
- importar do barrel mais alto disponível, sem atravessar a estrutura interna do domínio;
- usar `import type` quando o símbolo existir apenas em tempo de compilação.

A regra de pastas de componentes e stylesheets é específica de aplicações com UI e não se
aplica a este servidor. Se uma UI for adicionada futuramente, ela volta a ser obrigatória.

### Compilador e módulos

Configurar o `tsconfig.json` para Node ESM com, no mínimo:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

O alvo ES2022 é compatível com Node.js 24 e evita depender de configuração de bundler do
frontend. Imports relativos emitidos para ESM devem usar extensões compatíveis com Node.

### ESLint e Prettier

O ESLint deve transformar as proibições acima em erros, incluindo seletores para:

- `TSAnyKeyword`;
- `TSAsExpression` e `TSTypeAssertion`;
- `TSNonNullExpression`;
- `TSInterfaceDeclaration`;
- `FunctionDeclaration`;
- `ExportDefaultDeclaration`;
- imports profundos que contornem barrels.

Usar a formatação do `hermes-chat-ui`:

```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": false,
  "printWidth": 80,
  "tabWidth": 2
}
```

Os scripts obrigatórios são:

```text
pnpm typecheck  # executa tsc --noEmit
pnpm lint
```

Nenhuma feature pode ser considerada concluída sem ambos passarem.

## Arquitetura

```text
MCP transport
    ↓
MCP tools + Zod
    ↓
CalendarService
    ↓
CalDAV gateway (`tsdav`)
    ↓
iCalendar codec (`ical.js`)
    ↓
Provider policy (`generic` ou `icloud`)
```

### Responsabilidades

- **Transport:** inicialização por `stdio` ou Streamable HTTP.
- **Tools:** schemas, anotações MCP, resultados estruturados e tradução de erros.
- **CalendarService:** regras de negócio, patch, concorrência e orquestração.
- **CalDAV gateway:** descoberta, queries, multiget e escritas condicionais.
- **iCalendar codec:** parsing, normalização, recorrência, alarmes e preservação.
- **Provider policy:** defaults e extensões específicas, sem duplicar CRUD.

As dependências externas devem ficar atrás de contratos pequenos definidos com `type` e
funções factory, permitindo testes determinísticos sem classes ou interfaces da aplicação.

## Perfis de provedor

### `CALDAV_PROVIDER=generic`

- Exige `CALDAV_URL`.
- Usa somente comportamento e propriedades padronizados.
- Não emite extensões `X-APPLE-*` ou `X-WR-*`.
- É uma interface experimental, sem garantia pública de compatibilidade.
- O Radicale valida esse núcleo na CI, mas não é um provedor suportado pelo produto.

### `CALDAV_PROVIDER=icloud`

- Usa `https://caldav.icloud.com` quando `CALDAV_URL` não é fornecida.
- Usa autenticação Basic com senha específica de aplicativo.
- Nunca solicita nem recomenda a senha principal da conta Apple.
- Emite `UID` por `VALARM`.
- Emite `X-WR-ALARMUID` por `VALARM`.
- Emite `X-APPLE-DEFAULT-ALARM:FALSE` por `VALARM`.
- Preserva propriedades `X-APPLE-*` e `X-WR-*` existentes.
- É o único perfil com suporte público e validação manual declarada.

Não anunciar outros provedores como compatíveis.

## Modelo temporal

Usar uma união discriminável pela presença de `date_time` ou `date`.

Evento temporizado:

```json
{
  "start": {
    "date_time": "2026-09-06T03:00:00+02:00",
    "timezone": "Europe/Berlin"
  },
  "end": {
    "date_time": "2026-09-06T03:30:00+02:00",
    "timezone": "Europe/Berlin"
  }
}
```

Evento de dia inteiro:

```json
{
  "start": { "date": "2026-09-06" },
  "end": { "date": "2026-09-07" }
}
```

Regras:

- `date_time` deve conter offset explícito ou `Z`.
- Quando `timezone` também for fornecida, ela deve ser um TZID IANA válido.
- O offset deve ser compatível com a zona na data informada.
- Início e fim devem usar o mesmo tipo temporal.
- O fim deve ser posterior ao início.
- Para eventos de dia inteiro, `end.date` é exclusivo.
- Preservar `VTIMEZONE` existente ao atualizar um recurso.
- Testar transições de horário de verão e offsets negativos/positivos.

## Identificadores e fronteira de URLs

### `calendar_id`

- Token opaco e versionado retornado por `list_calendars`.
- Representa um calendário descoberto para a conta atual.
- Em toda chamada, resolver o token contra calendários descobertos; não confiar em uma URL
  recebida diretamente do modelo.

### `resource_id`

- Token opaco e versionado associado ao calendário, `href` e UID do recurso.
- O conteúdo interno não faz parte do contrato público.
- Ao resolver, validar origem e pertencimento ao calendário descoberto.
- Nunca presumir que o recurso se chama `<UID>.ics`.

Todos os retornos de evento incluem `calendar_id`, `resource_id`, `uid` e `etag`, quando
disponível.

## Ferramentas MCP

Todas as ferramentas devem definir `inputSchema`, `outputSchema`, descrição clara e
anotações MCP.

| Ferramenta       | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| ---------------- | -------------: | ----------------: | ---------------: | --------------: |
| `list_calendars` |         `true` |           `false` |           `true` |          `true` |
| `list_events`    |         `true` |           `false` |           `true` |          `true` |
| `get_event`      |         `true` |           `false` |           `true` |          `true` |
| `create_event`   |        `false` |           `false` |          `false` |          `true` |
| `update_event`   |        `false` |            `true` |          `false` |          `true` |
| `delete_event`   |        `false` |            `true` |           `true` |          `true` |

### `list_calendars`

Retorna:

- `calendar_id`;
- nome exibido;
- descrição, quando disponível;
- indicação de escrita permitida, quando detectável;
- timezone do calendário, quando disponível.

A detecção de permissão é best effort. Uma permissão desconhecida não deve ser apresentada
como gravável.

### `list_events`

Entrada:

- `calendar_id`;
- `start` e `end` como instantes ISO 8601;
- `timezone`, opcional para interpretação de horários flutuantes;
- `limit`, opcional, padrão 100 e máximo 500;
- `cursor`, opcional e opaco.

Regras:

- O intervalo é semiaberto: `[start, end)`.
- O intervalo máximo é 366 dias.
- Expandir recorrências no intervalo.
- Respeitar `RRULE`, `RDATE`, `EXDATE` e exceções `RECURRENCE-ID`.
- Retornar `next_cursor` quando houver mais resultados.
- O cursor deve carregar versão e vínculo com os parâmetros da consulta; rejeitar cursor
  reutilizado em outra consulta.

Cada evento inclui título, início, fim, descrição, local, recorrência, alarmes,
`calendar_id`, `resource_id`, UID, `href` diagnóstico sanitizado, ETag e indicação de
evento mestre ou ocorrência expandida.

### `get_event`

Aceita preferencialmente `resource_id`.

Como alternativa, aceita `calendar_id` + UID e executa uma busca CalDAV segura. Rejeita
resultado ausente ou ambíguo.

Retorna:

- representação normalizada;
- alarmes;
- recorrência preservada;
- `calendar_id`, `resource_id`, UID e ETag;
- iCalendar bruto somente quando `include_raw_ical: true`.

O iCalendar bruto nunca é retornado por padrão e continua sujeito ao limite de tamanho.

### `create_event`

Exemplo:

```json
{
  "calendar_id": "opaque-calendar-id",
  "summary": "Comprar passagens do Shinkansen",
  "start": {
    "date_time": "2026-09-06T03:00:00+02:00",
    "timezone": "Europe/Berlin"
  },
  "end": {
    "date_time": "2026-09-06T03:30:00+02:00",
    "timezone": "Europe/Berlin"
  },
  "description": "Referência: Smart-EX",
  "location": null,
  "alarms": [
    { "minutes_before": 1440, "action": "DISPLAY" },
    { "minutes_before": 0, "action": "DISPLAY" }
  ],
  "rrule": null
}
```

Requisitos:

- aceitar zero, um ou vários alarmes, até o limite definido;
- gerar UID globalmente único e `DTSTAMP`;
- gerar nome de recurso seguro, sem depender dessa convenção posteriormente;
- usar `If-None-Match: *` na criação;
- escapar texto corretamente;
- validar datas, timezone e RRULE;
- reler o recurso após a escrita;
- retornar o evento efetivamente armazenado, `resource_id` e ETag.

### `update_event`

Aceita preferencialmente `resource_id` e, opcionalmente, o ETag observado pelo cliente.
Também aceita `calendar_id` + UID como fallback seguro.

Fluxo:

1. Resolver e reler o recurso completo.
2. Se um ETag esperado foi enviado, exigir correspondência.
3. Encontrar o `VEVENT` mestre correto sem remover exceções.
4. Aplicar somente campos presentes no patch.
5. Serializar preservando dados desconhecidos.
6. Enviar com `If-Match` usando a ETag da releitura.
7. Reler e retornar o resultado.

Semântica de patch:

- campo omitido: preservar;
- `null`: remover um campo anulável;
- `alarms: []`: remover todos os alarmes;
- lista de alarmes: substituir explicitamente os alarmes;
- `alarms` omitido: preservar inclusive ações ainda não suportadas.

Eventos comuns e séries inteiras podem ser atualizados. Uma ocorrência isolada de uma
série recorrente retorna erro explícito.

### `delete_event`

Aceita preferencialmente `resource_id` e opcionalmente o ETag observado. O fallback é
`calendar_id` + UID.

Deve reler o recurso, validar eventual ETag esperado e excluir o `href` correto com
`If-Match`. Não considerar conflito como sucesso.

Eventos comuns e séries inteiras podem ser excluídos. Uma ocorrência isolada não pode ser
excluída no MVP.

## Modelo de alarmes

Entrada:

```json
{
  "minutes_before": 1440,
  "action": "DISPLAY",
  "description": "Lembrete opcional"
}
```

Regras:

- apenas `ACTION:DISPLAY` no MVP;
- `minutes_before` é inteiro de `0` a `525600`;
- no máximo 20 alarmes por evento;
- descrição ausente usa texto derivado do título;
- cada alarme é um subcomponente independente do `VEVENT`;
- cada alarme recebe UID globalmente único em ambos os perfis;
- o perfil iCloud também emite `X-WR-ALARMUID` e
  `X-APPLE-DEFAULT-ALARM:FALSE`.

Conversões canônicas:

- `1440` → `TRIGGER:-P1D`;
- `60` → `TRIGGER:-PT1H`;
- `15` → `TRIGGER:-PT15M`;
- `0` → `TRIGGER:PT0S`.

## Recorrência

Aceitar `rrule` como string RFC 5545 sem o prefixo `RRULE:`:

```text
FREQ=WEEKLY;BYDAY=MO;COUNT=10
```

No MVP:

- criar uma série é permitido;
- listar ocorrências expandidas é obrigatório;
- atualizar ou excluir a série completa é permitido;
- atualizar ou excluir uma ocorrência isolada é proibido;
- `RDATE`, `EXDATE` e exceções existentes são preservados e considerados na leitura;
- a API não cria nem edita diretamente essas exceções.

Nunca alterar uma série inteira quando a entrada identificar uma ocorrência isolada.

## Preservação iCalendar

- Parsear o recurso completo com `ical.js`.
- Modificar somente o componente e as propriedades alvo.
- Preservar `VCALENDAR`, `VTIMEZONE`, componentes irmãos, parâmetros, propriedades
  desconhecidas e extensões `X-*`.
- Validar por fixtures que `X-APPLE-*` e `X-WR-*` sobrevivem ao round-trip.
- Não usar respostas expandidas ou parciais do servidor como base para atualização.
- Rebuscar o recurso completo antes de qualquer escrita.

## Configuração

Variáveis CalDAV:

```dotenv
CALDAV_PROVIDER=icloud
CALDAV_URL=https://caldav.icloud.com
CALDAV_USERNAME=user@example.com
CALDAV_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

Variáveis do servidor MCP:

```dotenv
CALDAV_MCP_TRANSPORT=stdio
CALDAV_MCP_HOST=0.0.0.0
CALDAV_MCP_PORT=8100
CALDAV_MCP_LOG_LEVEL=INFO
CALDAV_MCP_REQUEST_TIMEOUT_MS=30000
```

Regras:

- `CALDAV_PROVIDER` aceita `generic` ou `icloud`.
- `CALDAV_URL` é opcional para iCloud e obrigatória para `generic`.
- `CALDAV_USERNAME` e `CALDAV_PASSWORD` são obrigatórias.
- A senha deve ser uma senha específica de aplicativo para iCloud.
- Credenciais nunca são parâmetros de ferramenta MCP.
- `.env.example` não contém valores reais.
- `.env`, caches, logs e conteúdo de calendários entram no `.gitignore`.
- O objeto de configuração deve ocultar secrets em `repr`, inspeção e erros.
- Logs de debug do transporte não podem expor headers ou bodies sensíveis.

## Transportes

### Local

O padrão fora do container é `stdio`:

```sh
pnpm start
```

Também permitir override explícito por CLI:

```sh
pnpm start -- --transport stdio
```

Nada além de mensagens MCP deve ser escrito em `stdout` nesse modo.

### NAS

O Compose define:

```dotenv
CALDAV_MCP_TRANSPORT=streamable-http
CALDAV_MCP_HOST=0.0.0.0
CALDAV_MCP_PORT=8100
```

Endpoint:

```text
http://<nas>:8100/mcp
```

Na mesma rede Docker:

```text
http://caldav-mcp:8100/mcp
```

## Container e Compose

Seguir o padrão do `kitchenowl-insights-mcp`, adaptado para Node:

- Dockerfile multi-stage;
- Node.js 24 LTS em build e runtime;
- instalação com `pnpm --frozen-lockfile`;
- somente artefatos e dependências de produção na imagem final;
- usuário não-root UID/GID `10001`;
- `ENTRYPOINT` direto no processo Node;
- imagens `linux/amd64` e `linux/arm64`;
- healthcheck TCP no processo Node, sem depender de `curl`;
- nenhum volume persistente.

O `compose.example.yaml` deve conter o equivalente a:

```yaml
services:
  caldav-mcp:
    image: ghcr.io/<proprietário-do-repositório>/caldav-mcp:latest
    restart: unless-stopped
    read_only: true
    user: "${CALDAV_MCP_UID_GID:-10001:10001}"
    cap_drop: ["ALL"]
    security_opt: ["no-new-privileges:true"]
    tmpfs:
      - /tmp:size=16m,mode=1777
    environment:
      CALDAV_PROVIDER: icloud
      CALDAV_USERNAME: ${CALDAV_USERNAME:?Set CALDAV_USERNAME}
      CALDAV_PASSWORD: ${CALDAV_PASSWORD:?Set CALDAV_PASSWORD}
      CALDAV_MCP_TRANSPORT: streamable-http
      CALDAV_MCP_HOST: 0.0.0.0
      CALDAV_MCP_PORT: 8100
    ports:
      - "${CALDAV_MCP_PUBLISHED_PORT:-8100}:8100"
```

O exemplo deve incluir healthcheck equivalente ao da referência. O README deve recomendar
uma tag de versão fixa para produção e explicar que `latest` é conveniente, mas não
oferece rollback determinístico.

## Publicação no GHCR

Adaptar `.github/workflows/container.yml` da referência:

- eventos: pull request, push em `main`, tags `v*.*.*` e execução manual;
- QEMU e Buildx;
- login no GHCR apenas fora de pull requests;
- imagem derivada de `${{ github.repository }}`;
- plataformas `linux/amd64,linux/arm64`;
- cache do GitHub Actions;
- pull request constrói sem publicar;
- `main` publica `latest`, branch e SHA;
- tag publica versão, major/minor e SHA;
- publicação depende de lint, typecheck, testes, integração e build aprovados.

Não executar `npm publish` em nenhum workflow.

## Tratamento de erros

Definir códigos internos estáveis e mensagens MCP sanitizadas para:

- `AUTHENTICATION_FAILED`;
- `CALDAV_UNAVAILABLE`;
- `CALENDAR_NOT_FOUND`;
- `CALENDAR_READ_ONLY`;
- `EVENT_NOT_FOUND`;
- `AMBIGUOUS_EVENT`;
- `ETAG_CONFLICT`;
- `VALIDATION_FAILED`;
- `INVALID_RRULE`;
- `INVALID_ICALENDAR`;
- `RESOURCE_TOO_LARGE`;
- `UNSUPPORTED_RECURRENCE_INSTANCE_MUTATION`;
- `PROVIDER_INCOMPATIBLE`;
- `WRITE_RESULT_UNKNOWN`.

Cada erro informa se uma nova tentativa pode ser apropriada. Não incluir resposta crua do
servidor quando ela puder conter dados pessoais. Conflitos exigem releitura antes de nova
tentativa.

## Estrutura sugerida

```text
caldav-mcp/
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── config.ts
│   ├── errors.ts
│   ├── schemas/
│   │   ├── index.ts
│   │   ├── alarms.ts
│   │   ├── calendars.ts
│   │   └── events.ts
│   ├── tools/
│   │   ├── index.ts
│   │   ├── list-calendars.ts
│   │   ├── list-events.ts
│   │   ├── get-event.ts
│   │   ├── create-event.ts
│   │   ├── update-event.ts
│   │   └── delete-event.ts
│   ├── services/
│   │   ├── index.ts
│   │   └── calendar-service.ts
│   ├── caldav/
│   │   ├── index.ts
│   │   ├── client.ts
│   │   ├── types.ts
│   │   └── resource-handle.ts
│   ├── ical/
│   │   ├── index.ts
│   │   ├── codec.ts
│   │   ├── alarms.ts
│   │   ├── recurrence.ts
│   │   └── preserve.ts
│   └── providers/
│       ├── index.ts
│       ├── generic.ts
│       └── icloud.ts
├── tests/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   └── fixtures/
├── docs/
│   ├── icloud-manual-test.md
│   └── troubleshooting.md
├── .github/workflows/
│   ├── ci.yml
│   └── container.yml
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── compose.example.yaml
├── LICENSE
├── README.md
├── SECURITY.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── eslint.config.js
└── vitest.config.ts
```

A estrutura é uma orientação. Manter responsabilidades separadas e evitar abstrações sem
uso concreto.

## Estratégia de testes

### Unitários

- schemas Zod de entrada e saída;
- rejeição por lint de `any`, casts, non-null assertions, interfaces, function declarations
  e default exports;
- validação de barrels e ausência de imports profundos entre domínios;
- configuração, defaults e redaction de secrets;
- evento temporizado e evento de dia inteiro;
- offset, TZID e transições de horário de verão;
- fim anterior ou igual ao início;
- RRULE válida e inválida;
- serialização sem alarmes, com um e com vários;
- alarmes de 1440, 60, 15 e zero minutos;
- UID por `VALARM` nos dois perfis;
- extensões Apple somente no perfil iCloud;
- parsing e round-trip de múltiplos alarmes;
- escaping de vírgula, ponto e vírgula, barra e quebra de linha;
- preservação de `VTIMEZONE`, parâmetros e propriedades `X-*`;
- patch com campo omitido, `null` e lista vazia;
- preservação de alarmes não suportados quando omitidos;
- expansão de RRULE, RDATE, EXDATE e RECURRENCE-ID;
- bloqueio de mutação de ocorrência isolada;
- tokens opacos inválidos ou pertencentes a outro calendário;
- limite de recurso e paginação;
- sanitização de erros e logs.

### Contrato CalDAV

Usar respostas HTTP determinísticas para validar:

- descoberta e redirecionamentos;
- autenticação recusada;
- `calendar-query` e `calendar-multiget`;
- timeout e indisponibilidade;
- `If-None-Match: *` na criação;
- `If-Match` em update/delete;
- conflito de ETag;
- resposta de escrita ambígua;
- ETag ou `Location` ausentes;
- preservação e reutilização do `href` real.

### Integração com Radicale

Subir um servidor descartável em Docker na CI:

- descobrir calendários;
- criar e reler evento;
- listar por intervalo;
- expandir recorrência;
- atualizar com ETag;
- detectar conflito;
- excluir;
- confirmar dois `VALARM` após round-trip.

O Radicale é somente uma fixture de protocolo e não aparece como provedor oficialmente
suportado.

### MCP e container

- listar todas as ferramentas e conferir schemas/anotações;
- chamar ferramentas através do servidor MCP com gateway controlado;
- validar `stdio` sem ruído em `stdout`;
- validar Streamable HTTP em `/mcp`;
- construir e iniciar a imagem;
- confirmar usuário não-root;
- confirmar filesystem somente leitura;
- confirmar healthcheck;
- confirmar que a imagem não contém `.env`, fixtures ou dependências de desenvolvimento.

### Teste manual com iCloud

Executar somente em calendário de teste:

1. Descobrir e listar calendários.
2. Criar um evento futuro com dois alarmes.
3. Reler via CalDAV e confirmar dois `VALARM`.
4. Confirmar os dois alertas no Apple Calendar.
5. Atualizar o título do evento comum e confirmar preservação dos alarmes.
6. Criar uma série e atualizar a série completa.
7. Confirmar que mutação de ocorrência isolada é rejeitada.
8. Alterar o evento em um dispositivo Apple e atualizar outro campo pelo MCP.
9. Confirmar preservação de `X-APPLE-*`, `X-WR-*` e exceções.
10. Provocar um conflito de ETag e confirmar erro explícito.
11. Excluir os eventos de teste.

Credenciais reais nunca entram na CI pública. Resultado ausente deve ser registrado como
`não executado`, nunca como aprovado.

## Documentação pública

O `README.md` deve incluir:

- finalidade e suporte oficial apenas ao iCloud Calendar;
- aviso de independência em relação à Apple;
- arquitetura e fluxo cliente MCP → NAS → iCloud;
- instalação por Docker Compose e `docker run`;
- uso de imagem versionada do GHCR;
- build local da imagem;
- configuração das variáveis e secrets;
- criação e revogação de senha específica de aplicativo;
- configuração Streamable HTTP para clientes MCP;
- execução local por `stdio` para desenvolvimento;
- exemplos de eventos temporizados, dia inteiro, recorrentes e com múltiplos alarmes;
- limitações de ocorrência isolada;
- restrição obrigatória do endpoint à rede confiável;
- política de privacidade;
- troubleshooting de descoberta, autenticação, ETag e extensões Apple.

Badges permitidos: TypeScript, CI, container GHCR, licença e release GitHub. Não incluir
badge ou instrução npm.

O `SECURITY.md` deve explicar como reportar vulnerabilidades sem publicar credenciais ou
dados de calendário.

## Fases de implementação

### 1. Fundação

- inicializar Git e estrutura TypeScript;
- configurar Node 24, pnpm, ESM/NodeNext, regras TypeScript obrigatórias, lint, format,
  Vitest e build;
- criar barrels e regras de importação entre domínios;
- implementar configuração segura e tipos de erro;
- criar testes de configuração e redaction.

### 2. Codec iCalendar

- implementar modelo temporal e validações;
- parsing/serialização preservadora;
- alarmes genéricos e extensões iCloud;
- recorrência e expansão;
- fixtures e testes de round-trip.

### 3. Gateway e serviço

- descoberta e handles opacos;
- queries por intervalo e UID;
- CRUD condicional com ETags;
- patch preservador;
- paginação, limites e erros sanitizados;
- testes de contrato e Radicale.

### 4. MCP e transportes

- registrar as seis ferramentas;
- schemas de entrada/saída e resultados estruturados;
- anotações de risco;
- `stdio` e Streamable HTTP;
- testes MCP end-to-end com gateway controlado.

### 5. Container, CI e documentação

- Dockerfile, Compose e healthcheck;
- CI de qualidade e integração;
- workflow multi-arquitetura do GHCR;
- README, SECURITY e troubleshooting;
- validar imagem no NAS.

### 6. Validação do iCloud e release

- executar checklist manual em calendário de teste;
- corrigir incompatibilidades observadas;
- registrar evidências e limitações;
- criar tag semântica;
- confirmar publicação e pull da imagem para amd64/arm64.

## Critérios de aceite automatizados

- `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` passam;
- o lint rejeita todas as construções proibidas por `.codex/rules/typescript.md`;
- nenhum `any`, cast, non-null assertion, `interface`, default export, function declaration
  ou comentário de bypass existe em `src/` e `tests/`;
- respostas externas usadas pelo domínio são validadas a partir de `unknown`;
- imports entre domínios passam apenas pelos barrels públicos;
- integração com Radicale passa na CI;
- servidor inicia por `stdio` e Streamable HTTP;
- seis ferramentas aparecem no MCP Inspector;
- criação usa `If-None-Match: *`;
- update/delete usam ETag e `If-Match`;
- múltiplos `VALARM` sobrevivem ao round-trip;
- propriedades desconhecidas e extensões Apple são preservadas;
- ocorrência recorrente isolada não altera a série;
- container roda como não-root e com filesystem somente leitura;
- imagem é construída para amd64 e arm64;
- repositório e imagem não contêm secrets nem dados pessoais;
- nenhum workflow ou documento publica ou exige npm.

## Critérios de aceite manual do iCloud

- listar calendários reais do iCloud;
- criar evento com dois alarmes;
- reler dois componentes `VALARM`;
- visualizar os dois alertas no Apple Calendar;
- atualizar evento comum e série sem perder alarmes ou extensões;
- detectar conflito de ETag;
- excluir eventos de teste;
- implantar no NAS e conectar um cliente MCP em `/mcp`.

A primeira release declarada como compatível com iCloud exige a execução bem-sucedida
dessa checklist.

## Entrega esperada do agente implementador

Ao finalizar, informar:

- caminho do projeto;
- resumo da arquitetura;
- comandos executados;
- resultados de lint, typecheck, testes, build e container;
- confirmação de conformidade com `.codex/rules/typescript.md`;
- resultado da integração com Radicale;
- resultado da checklist manual do iCloud, ou `não executado` com motivo;
- limitações restantes;
- configuração exata do cliente MCP usado no NAS;
- nome e tags exatas da imagem GHCR publicada, se a release for autorizada;
- confirmação de ausência de publicação npm;
- confirmação de ausência de Java, Python e Home Assistant no runtime.

## Referências normativas e operacionais

- RFC 4791 — CalDAV: <https://www.rfc-editor.org/rfc/rfc4791.html>
- RFC 5545 — iCalendar: <https://www.rfc-editor.org/rfc/rfc5545.html>
- RFC 9074 — UID em VALARM: <https://www.rfc-editor.org/rfc/rfc9074.html>
- SDK TypeScript MCP: <https://github.com/modelcontextprotocol/typescript-sdk>
- `tsdav`: <https://github.com/natelindev/tsdav>
- `ical.js`: <https://github.com/mozilla-comm/ical.js>
- Senhas específicas de aplicativo Apple:
  <https://support.apple.com/en-us/102654>
- Ciclo de releases Node.js: <https://nodejs.org/en/about/previous-releases>
