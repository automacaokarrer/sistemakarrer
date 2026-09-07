# Memória operacional — Karrer Atendimento

Última atualização: 7 de setembro de 2026.

Este arquivo registra decisões, estado de produção e procedimentos importantes do projeto. Não inclua valores de tokens, senhas, chaves privadas ou dados pessoais aqui.

## Identidade e repositório

- O projeto pertence à conta institucional da Karrer.
- GitHub owner: `automacaokarrer`.
- Repositório: `automacaokarrer/sistemakarrer`.
- Branch de produção: `main`.
- O `.env` local é a fonte autorizada para `GITHUB_OWNER`, `GITHUB_REPOSITORY` e `GITHUB_TOKEN`.
- Não usar credenciais pessoais ou credenciais globais do Windows para publicar este projeto.
- Quando necessário, usar o token somente em memória durante o comando e nunca persistir ou imprimir seu valor.

## Produção

- Domínio: `https://crmkarrer.com.br`.
- Cloudflare Worker: `karrer-atendimento`.
- D1: `karrer-atendimento-db`.
- R2: `karrer-atendimento-media`.
- Durable Object: `ChatRoom`.
- Última versão Cloudflare validada nesta data: `c0755d83-8d36-4eeb-9896-bb911bec29dc`.
- Commit correspondente: `84a76d34c96fe7144cde6ebb691ee000c362607d`.
- A URL pública e `/api/auth/status` responderam HTTP 200 após o deploy.

## Funcionalidades implementadas

- Login, ativação por código e redefinição de senha.
- Cadastro público com nome, e-mail, Instagram, função profissional e foto obrigatória.
- Permissões automáticas conforme função profissional.
- Administração de usuários restrita ao administrador mestre.
- Presença online da equipe baseada na atividade das sessões.
- Avatares privados armazenados no R2.
- Chat, gestão e classificação de leads.
- Filtros, métricas e exportação CSV de leads.
- Cadastro completo de clientes e preenchimento de endereço por CEP.
- Upload de até 10 documentos por cliente, máximo de 10 MB por arquivo e 16 MB no total.
- Integração opcional dos documentos com uma pasta do Google Drive.

## Google Drive — conta institucional da Karrer

Usar exclusivamente uma conta de serviço criada no projeto Google Cloud institucional da Karrer. A pasta de destino também deve pertencer ou estar sob controle da Karrer.

Bindings esperados pelo Worker:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: valor `client_email` do JSON da conta de serviço.
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: valor completo de `private_key`, incluindo os marcadores BEGIN/END.
- `GOOGLE_DRIVE_FOLDER_ID`: ID da pasta institucional compartilhada.

Pré-requisitos:

- Habilitar a Google Drive API no projeto Google Cloud da Karrer.
- Compartilhar a pasta de destino como Editor com o e-mail da conta de serviço.
- Gravar os três valores como secrets do Cloudflare Worker.
- Nunca enviar a chave privada por chat nem registrá-la no Git.

Enquanto esses três bindings não estiverem configurados, a interface mantém o upload do Drive desativado sem bloquear os outros módulos.

## Testes e navegador

- Playwright e Chromium estão instalados para testes locais.
- Configuração: `playwright.config.ts`.
- Testes E2E: `tests/e2e/ui.spec.ts`.
- Os testes cobrem login/cadastro e navegação por Chat, Leads, Clientes e Configurações em desktop e Pixel 7.
- Também verificam ausência de overflow horizontal.

Comandos de validação:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:e2e
npm.cmd run build
```

Último resultado registrado: 11 testes unitários e 4 testes E2E aprovados, typecheck e build aprovados.

## Migrações e deploy

- A migração `migrations/0004_user_profiles.sql` adiciona perfis, origem do cadastro, índice de presença e documentos dos clientes.
- Ela já estava aplicada no D1 remoto na última verificação.
- Antes de um novo deploy, executar testes, typecheck e build.
- Comando de publicação: `npm.cmd run deploy`.
- Após publicar, validar `https://crmkarrer.com.br/api/auth/status` e abrir a tela pública em Chromium.

## Próximo passo conhecido

Configurar no Cloudflare os três secrets do Google Drive usando as credenciais da conta de serviço institucional da Karrer e repetir o deploy e o teste de upload.
