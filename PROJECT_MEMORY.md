# Memória operacional — Karrer Atendimento

Última atualização: 12 de setembro de 2026.

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
- Última versão Cloudflare validada nesta data: `0baffa39-f103-44e0-8cb8-12dfd1477425`.
- Commit de código correspondente: `2cec92e`.
- O endpoint protegido do webhook Z-API respondeu corretamente após o deploy.

## Funcionalidades implementadas

- Login, ativação por código e redefinição de senha.
- Cadastro público com nome, e-mail, Instagram, função profissional e foto obrigatória.
- Permissões automáticas conforme função profissional.
- Administração de usuários restrita ao administrador mestre.
- Presença online da equipe baseada na atividade das sessões.
- Avatares privados armazenados no R2.
- Chat, gestão e classificação de leads.
- Atualização do chat em tempo real por WebSocket global e por conversa, com heartbeat e reconexão automática; novas conversas e mensagens aparecem sem atualizar a página.
- O histórico abre com as 40 mensagens mais recentes e carrega blocos anteriores automaticamente ao rolar para o topo, preservando a posição de leitura. Mensagens novas só deslocam a tela quando o atendente já está próximo do fim.
- Envio pelo chat de imagens JPG/PNG/WebP, documentos PDF/Office/CSV/TXT de até 10 MB e áudios gravados no navegador, com armazenamento privado no R2 e envio em Base64 pela Z-API.
- Imagens e áudios possuem prévia antes do envio; o áudio pode ser ouvido e descartado. O compositor de texto permanece liberado durante gravação, prévia e upload de mídia.
- Confirmações de mensagem mudam em tempo real entre enviado, entregue e lido. O cabeçalho exibe presença e visto por último quando a Z-API fornece esses eventos.
- Na administração, clicar em um usuário abre um modal de perfil com foto, função, presença, conta e permissões. Alterações de acessos continuam exclusivas do administrador mestre e protegidas pela API.
- Telefones brasileiros são apresentados com DDD e nono dígito, inclusive quando a origem ainda fornece um número móvel antigo de oito dígitos.
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
- Após um envio controlado aceito pela Z-API para um número autorizado, o WhatsApp exibiu uma restrição temporária para iniciar novas conversas e a instância passou a constar como desconectada; não era a tela de banimento total da conta.
- Em 12 de setembro de 2026, uma consulta somente de leitura aos endpoints oficiais retornou instância e aparelho conectados, pagamento `PAID` e vencimento em 12 de outubro de 2026. Os três callbacks principais continuavam apontando exatamente para o endpoint protegido do CRM, e o Worker de produção respondeu saudável.
- Após a versão `0baffa39-f103-44e0-8cb8-12dfd1477425`, uma nova consulta somente de leitura confirmou novamente `connected=true` e `smartphoneConnected=true`. O Worker já processa `PresenceChatCallback`, mas o cadastro desse quarto callback na Z-API ficou pendente de autorização explícita porque a URL protegida contém o token secreto do webhook.
- Em 12 de setembro de 2026, uma mensagem de texto oficial recebida pelo WhatsApp chegou ao D1 com identificador da Z-API e status `received`, comprovando o fluxo de entrada depois da reconexão. O fluxo de saída e as confirmações de entrega/leitura ainda dependem de uma resposta controlada.
- Antes de um novo teste controlado, confirmar no aparelho institucional que a restrição da Meta foi efetivamente removida. Não reiniciar a instância nem iniciar conversa sem destinatário autorizado e consentimento explícito.
- Não enviar textos técnicos, genéricos ou com aparência de robô. Toda mensagem deve ter contexto real, identificar o atendente e a Karrer, respeitar o consentimento do destinatário e permitir que a pessoa encerre o contato.
- Não variar textos artificialmente para contornar filtros antispam; a prioridade é uma conversa legítima e compatível com as políticas do WhatsApp.
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

Último resultado registrado: 16 testes unitários e 14 testes E2E aprovados em desktop e Pixel 7, incluindo tempo real, paginação de 40 mensagens, prévias de imagem/áudio, escrita simultânea, confirmação de leitura, modal de usuário e formatação brasileira do telefone; typecheck e build aprovados.

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

- No aparelho institucional, confirmar em `Saiba mais` que a restrição foi removida. Depois, fazer um único teste ponta a ponta com destinatário autorizado e consentimento explícito, começando de preferência pela resposta a uma mensagem recebida.
- A página de Leads foi aprimorada localmente sem alterar sua identidade visual: o filtro de hora de entrada agora funciona de fato, os controles receberam rótulos acessíveis e os estados vazios ficaram contextuais.
- O design de Leads foi aplicado ao Cadastro de Clientes com hero bege, quatro KPIs, contorno amarelo, cartões, hierarquia e responsividade equivalentes.
- O formulário de clientes ganhou feedback correto de sucesso/erro, contador de documentos, autocomplete e limpeza integral de estados.
- O Playwright agora usa exclusivamente a porta `5197` com `strictPort` e não reutiliza servidores de outros projetos.
- Essas alterações foram publicadas e validadas em produção na versão `1fd5f9aa-a362-4ca6-9fcb-45288ea4c41c`.
- Em 12 de setembro de 2026, os 6 contatos, 6 conversas e 14 mensagens fictícios do seed de validação foram removidos do D1 remoto. A conferência final confirmou zero registros `demo-*`; permaneceu somente a conversa oficial recebida pela Z-API.
- Não reaplicar `seed/validation.sql` em produção. A validação autenticada automatizada não usa `INITIAL_ADMIN_PASSWORD`, pois esse valor de configuração inicial pode ficar desatualizado depois que o administrador troca a senha.
- O chat em tempo real e os envios de áudio, imagem e documento foram publicados e validados em produção na versão `83d226be-791d-4aef-8d2c-5adbbc841176`, correspondente ao commit `40a25f0`.
- O carregamento progressivo do histórico foi publicado e validado em produção na versão `692106cd-72f9-4920-ad3e-41b93effa8d0`, correspondente ao commit `52241f7`.
- As prévias de mídia, confirmação de leitura em tempo real, presença/visto por último, modal completo de usuário e telefone com nono dígito foram publicados e validados em produção na versão `0baffa39-f103-44e0-8cb8-12dfd1477425`, correspondente ao commit `2cec92e`.
- Permanece pendente cadastrar o callback de presença da Z-API; essa operação transmite ao provedor a URL protegida com o token do webhook e exige autorização explícita do responsável.
- Continua pendente configurar no Cloudflare os três secrets do Google Drive usando as credenciais da conta de serviço institucional da Karrer e repetir o deploy e o teste de upload.
