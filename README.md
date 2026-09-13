# Karrer Atendimento

Central de atendimento jurídico com WhatsApp, gestão de leads e cadastro de clientes. A aplicação usa React no front-end e Cloudflare Workers no back-end, com D1, R2 e Durable Objects.

Consulte [PROJECT_MEMORY.md](PROJECT_MEMORY.md) antes de alterar integrações ou publicar uma nova versão.

## Desenvolvimento local

1. Preencha o `.env` local. Ele é ignorado pelo Git.
2. Instale as dependências com `npm install`.
3. Aplique o banco local com `npm run db:migrate:local`.
4. Opcionalmente carregue os dados visuais de demonstração com `wrangler d1 execute karrer-atendimento-db --local --file seed/demo.sql`.
5. Inicie com `npm run dev`.

O script de desenvolvimento copia para `.dev.vars` somente os segredos usados pela aplicação. Tokens administrativos de Cloudflare e GitHub nunca são repassados ao Worker.

## Primeiro acesso

Preencha `BOOTSTRAP_ADMIN_TOKEN` no `.env`, inicie o sistema e informe esse token na tela de configuração junto com o nome, e-mail e senha do primeiro administrador. Depois do primeiro cadastro, o endpoint de inicialização é bloqueado pelo banco.

## Produção

Os recursos já esperados pelo `wrangler.jsonc` são:

- D1: `karrer-atendimento-db`
- R2: `karrer-atendimento-media`
- Durable Object: `ChatRoom`

Antes do deploy, grave os segredos de aplicação com `wrangler secret put NOME_DO_SEGREDO`. As credenciais da Z-API e o token de bootstrap não devem ser colocados no código nem em variáveis públicas do Vite.

Validações disponíveis: `npm run typecheck`, `npm test` e `npm run build`.

## Luna

A integração de backend com a agente Luna está documentada em [docs/LUNA_INTEGRATION.md](docs/LUNA_INTEGRATION.md). Ela exige `OPENAI_API_KEY` e `OPENAI_LUNA_AGENT_ID` como secrets do Worker.

Durante um atendimento atribuído a uma pessoa, a Luna mantém fatos, pendências e resumo no D1 em segundo plano, sem responder ao cliente nem interferir no envio humano.
