# Memória operacional — Karrer Atendimento

Última atualização: 11 de setembro de 2026.

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
- Última versão Cloudflare validada nesta data: `5792222f-33c2-4b67-a96c-595f17439446`.
- Commit de código correspondente: `5e97650`.
- O endpoint protegido do webhook Z-API respondeu corretamente após o deploy.

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

## Z-API — WhatsApp institucional da Karrer

- Os secrets `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_CLIENT_TOKEN` e `ZAPI_WEBHOOK_TOKEN` estão configurados no Cloudflare Worker.
- As credenciais foram aceitas pelos endpoints oficiais de status e dados da instância em 11 de setembro de 2026.
- Os callbacks HTTPS de recebimento, confirmação de envio e status de mensagem apontam para o endpoint protegido do CRM e foram confirmados pela API.
- O Worker trata `ReceivedCallback`, `DeliveryCallback` e `MessageStatusCallback`, incluindo atualizações de status em lote.
- Quando um envio é recusado por diferença no formato brasileiro do número, o Worker consulta o número canônico confirmado pelo WhatsApp e repete uma única vez.
- A opção de notificar mensagens enviadas pelo próprio aparelho permanece desativada para evitar duplicidade com envios originados pelo CRM.
- A instância está no plano `TRIAL`; a instância e o aparelho institucional estavam conectados na validação final de 11 de setembro de 2026.
- Um envio controlado para um número autorizado foi aceito pela Z-API após usar o formato canônico retornado pela própria plataforma.
- Nunca registrar os valores das credenciais nem a URL completa do webhook, pois ela contém um token de autenticação.

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

Último resultado registrado: 14 testes unitários e 4 testes E2E aprovados, typecheck e build aprovados.

## Migrações e deploy

- A migração `migrations/0004_user_profiles.sql` adiciona perfis, origem do cadastro, índice de presença e documentos dos clientes.
- Ela já estava aplicada no D1 remoto na última verificação.

### Runbook de deploy no Cloudflare

1. Confirmar que o destino em `wrangler.jsonc` é o Worker `karrer-atendimento`, o D1 `karrer-atendimento-db` e o domínio `crmkarrer.com.br`.
2. Confirmar a conta autenticada sem imprimir tokens:

   ```powershell
   npx.cmd wrangler whoami
   ```

3. Consultar as migrações remotas:

   ```powershell
   npx.cmd wrangler d1 migrations list karrer-atendimento-db --remote
   ```

4. Se houver migração pendente, aplicá-la antes do Worker:

   ```powershell
   npm.cmd run db:migrate:remote
   ```

5. Executar toda a validação local:

   ```powershell
   npm.cmd test
   npm.cmd run typecheck
   npm.cmd run test:e2e
   npm.cmd run build
   ```

6. Publicar:

   ```powershell
   npm.cmd run deploy
   ```

7. Guardar no histórico o `Current Version ID` informado pelo Wrangler.
8. Validar a produção:

   ```powershell
   curl.exe -sS -D - https://crmkarrer.com.br/api/auth/status
   ```

9. Abrir `https://crmkarrer.com.br` com Playwright/Chromium e confirmar HTTP 200, título `Karrer | Atendimento` e a tela esperada.
10. Atualizar neste arquivo o ID da versão, o commit correspondente, o resultado da validação e o próximo passo.

Observações:

- O `prebuild` gera a configuração redirecionada que o Wrangler usa a partir de `dist/karrer_atendimento/wrangler.json`.
- Um aviso isolado de falha ao gravar logs do Wrangler fora do workspace não invalida o build quando o processo termina com código zero.
- Segredos de produção são gerenciados pelo Cloudflare e nunca devem entrar no Git.
- Para conferir somente os nomes dos secrets já configurados, usar `npx.cmd wrangler secret list`.

### Runbook de commit e push no GitHub

O destino obrigatório é:

- Owner: `automacaokarrer`.
- Repositório: `sistemakarrer`.
- Remote: `https://github.com/automacaokarrer/sistemakarrer.git`.
- Branch: `main`.

Procedimento:

1. Ler `git status --short` e preservar alterações do usuário que não pertençam à tarefa.
2. Executar `git diff --check` e revisar o diff. Confirmar que `.env`, tokens, senhas e chaves privadas não estão sendo versionados.
3. Adicionar somente os arquivos da tarefa com `git add -- <arquivos>`.
4. Criar um commit descritivo.
5. Fazer o push para `origin main`.
6. Confirmar que `HEAD` e `origin/main` apontam para o mesmo SHA e que o working tree está limpo.

Autenticação:

- A fonte correta é o `GITHUB_TOKEN` do `.env`, associado à conta institucional `automacaokarrer`.
- `GITHUB_OWNER` e `GITHUB_REPOSITORY` no `.env` definem o escopo autorizado.
- Nunca imprimir o token, colocá-lo na URL remota ou persistir seu valor no `.git/config`.
- A credencial global do Windows pode selecionar a conta pessoal `maninhocriativos` e causar HTTP 403. Essa conta não deve ser usada neste projeto.
- Quando a credencial global interferir, ler o token autorizado do `.env` apenas em memória e fornecer um cabeçalho HTTP temporário somente ao processo `git push`. O valor deve desaparecer quando o processo terminar.
- Antes de diagnosticar permissões, a API do GitHub pode ser consultada com o token em memória para confirmar apenas `login`, visibilidade do repositório e permissões booleanas; nunca retornar cabeçalhos ou o token.

Verificação final:

```powershell
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

Deploy e push são operações diferentes: o deploy publica os arquivos locais no Cloudflare; o push registra o código no GitHub. Sempre concluir e verificar ambos quando o pedido for publicar tudo.

## Próximo passo conhecido

- Confirmar o recebimento da mensagem de teste, responder pelo número autorizado e verificar a entrada e a atualização de status no chat do CRM.
- A página de Leads foi aprimorada localmente sem alterar sua identidade visual: o filtro de hora de entrada agora funciona de fato, os controles receberam rótulos acessíveis e os estados vazios ficaram contextuais.
- O design de Leads foi aplicado ao Cadastro de Clientes com hero bege, quatro KPIs, contorno amarelo, cartões, hierarquia e responsividade equivalentes.
- O formulário de clientes ganhou feedback correto de sucesso/erro, contador de documentos, autocomplete e limpeza integral de estados.
- O Playwright agora usa exclusivamente a porta `5197` com `strictPort` e não reutiliza servidores de outros projetos.
- Essas alterações foram publicadas e validadas em produção na versão `1fd5f9aa-a362-4ca6-9fcb-45288ea4c41c`.
- O seed idempotente `seed/validation.sql` foi aplicado no D1 local e remoto para validação visual. Ele mantém 6 contatos/conversas fictícios identificados pelo prefixo `demo-`, distribuídos em 2 leads quentes, 2 mornos e 2 frios, com 14 mensagens de texto, áudio e documento.
- Os telefones do seed são deliberadamente fictícios (`550000000001` a `550000000006`) e nenhuma mensagem foi enviada pela Z-API.
- As contagens foram confirmadas diretamente no D1 remoto após a importação. A validação autenticada automatizada não usa `INITIAL_ADMIN_PASSWORD`, pois esse valor de configuração inicial pode ficar desatualizado depois que o administrador troca a senha.
- Continua pendente configurar no Cloudflare os três secrets do Google Drive usando as credenciais da conta de serviço institucional da Karrer e repetir o deploy e o teste de upload.
