# Memória operacional — Karrer Atendimento

Última atualização: 15 de setembro de 2026.

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
- Última versão Cloudflare validada nesta data: `96a1f6a9-8334-437f-ab72-b1d00b4aa84c`.
- Commit de código correspondente: `2440cfc`.
- O endpoint protegido do webhook Z-API respondeu corretamente após o deploy.

## Funcionalidades implementadas

- Login, ativação por código e redefinição de senha.
- Cadastro público com nome, e-mail, Instagram, função profissional e foto obrigatória.
- Permissões automáticas conforme função profissional.
- Administração de usuários restrita ao administrador mestre.
- Presença online da equipe baseada na atividade das sessões.
- Avatares privados armazenados no R2.
- Chat, gestão e classificação de leads.
- Cada conversa pode receber várias etiquetas operacionais pelo chat. O catálogo inicial possui: Novo contato, Em análise, Aguardando documentos, Documentos recebidos, Aguardando contrato, Contrato enviado, Contrato assinado, Aguardando pagamento, Retorno agendado e Sem interesse. As etiquetas atuais aparecem no cabeçalho da conversa; inclusões e remoções ficam em histórico imutável no D1 com usuário e horário, geram auditoria e são transmitidas em tempo real. As rotas exigem permissão de Chat.
- Atualização do chat em tempo real por WebSocket global e por conversa, com heartbeat e reconexão automática; novas conversas e mensagens aparecem sem atualizar a página.
- O histórico abre com as 40 mensagens mais recentes e carrega blocos anteriores automaticamente ao rolar para o topo, preservando a posição de leitura. Mensagens novas só deslocam a tela quando o atendente já está próximo do fim.
- Envio pelo chat de imagens JPG/PNG/WebP, documentos PDF/Office/CSV/TXT de até 10 MB e áudios gravados no navegador, com armazenamento privado no R2 e envio em Base64 pela Z-API.
- Imagens e áudios possuem prévia antes do envio; o áudio pode ser ouvido e descartado. Prints JPG, PNG ou WebP copiados para a área de transferência podem ser colados com `Ctrl + V` no campo de mensagem e seguem o mesmo fluxo autenticado de prévia e upload das imagens selecionadas. O compositor de texto permanece liberado durante gravação, prévia e upload de mídia.
- Imagens já enviadas ou recebidas no chat podem ser abertas em tamanho completo em uma sobreposição responsiva, fechada pelo botão, pelo fundo ou pela tecla Escape, e baixadas localmente por um botão autenticado com nome e extensão seguros.
- Links HTTP/HTTPS em mensagens de texto são reconhecidos e exibidos como links clicáveis; o primeiro link da mensagem recebe um cartão de prévia com site, título e descrição quando a página fornece metadados. A leitura da prévia passa por rota autenticada, limita tamanho e redirecionamentos e bloqueia protocolos, portas e endereços locais/privados.
- A prévia de áudio usa um player próprio e responsivo, com ouvir/pausar, barra de progresso, tempo decorrido/total e ações claras para descartar ou enviar.
- Confirmações de mensagem mudam em tempo real entre enviado, entregue e lido. O cabeçalho exibe presença e visto por último quando a Z-API fornece esses eventos.
- Na administração, clicar em um usuário abre um modal de perfil com foto, função, presença, conta e permissões. Alterações de acessos continuam exclusivas do administrador mestre e protegidas pela API.
- Telefones brasileiros são apresentados com DDD e nono dígito, inclusive quando a origem ainda fornece um número móvel antigo de oito dígitos.
- Ao abrir uma conversa, o contador de mensagens não lidas é zerado no banco e desaparece em tempo real para a equipe. Novas mensagens recebidas incrementam novamente o contador.
- A primeira pessoa que abre uma conversa ainda sem responsável assume o atendimento; o nome do atendente aparece em um badge na lista e a atribuição é transmitida em tempo real.
- A foto de perfil do contato é consultada pela Z-API, copiada para o R2 privado e renovada a cada sete dias. Quando indisponível por privacidade ou ausência de foto, a interface usa as iniciais.
- Filtros, métricas e exportação CSV de leads. A lista filtrada é paginada em blocos de 20 registros, volta à primeira página quando busca, período, atendente, classificação ou horário mudam e informa o intervalo exibido. Após cada mensagem recebida, os leads com origem `automatic` são recalculados como Frio, Morno ou Quente a partir dos sinais de interesse nas 30 mensagens mais recentes do cliente; intenção de contratação, descrição do caso, perguntas, documentos, mídia e pedido de encerramento influenciam a pontuação. Classificações manuais nunca são sobrescritas e o recálculo não consome tokens da Luna.
- Cadastro completo de clientes e preenchimento de endereço por CEP.
- Edição de clientes a partir da lista do Cadastro, inclusive contatos incompletos recebidos pelo WhatsApp: o formulário carrega os dados e envia `PATCH /api/contacts/:id` com permissão `clients`; contatos e classificação da conversa são atualizados em lote no D1, com verificação de CPF/telefone duplicados, auditoria e aviso em tempo real.
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
- Após a versão `0baffa39-f103-44e0-8cb8-12dfd1477425`, uma nova consulta confirmou novamente `connected=true` e `smartphoneConnected=true`. Com autorização explícita do responsável, o callback `PresenceChatCallback` foi cadastrado com sucesso na Z-API e a instância permaneceu conectada.
- Em 12 de setembro de 2026, uma mensagem de texto oficial recebida pelo WhatsApp chegou ao D1 com identificador da Z-API e status `received`, comprovando o fluxo de entrada depois da reconexão.
- O responsável confirmou que o WhatsApp institucional está funcionando normalmente; não há teste adicional de envio pendente. Não reiniciar a instância sem necessidade operacional nem iniciar conversas sem destinatário autorizado e consentimento explícito.
- Não enviar textos técnicos, genéricos ou com aparência de robô. Toda mensagem deve ter contexto real, identificar o atendente e a Karrer, respeitar o consentimento do destinatário e permitir que a pessoa encerre o contato.
- Não variar textos artificialmente para contornar filtros antispam; a prioridade é uma conversa legítima e compatível com as políticas do WhatsApp.
- Nunca registrar os valores das credenciais nem a URL completa do webhook, pois ela contém um token de autenticação.
- Em 13 de setembro de 2026, o callback de presença foi encontrado com um token de URL diferente do aceito pelo Worker de produção: uma chamada controlada retornou HTTP 401, enquanto a mesma chamada pelo endereço dos callbacks de recebimento retornou HTTP 200. Os callbacks de recebimento, entrega e status já usavam entre si o mesmo endereço aceito. O callback de presença foi atualizado pela API oficial da Z-API para esse endereço, sem alterar os outros callbacks; a instância permaneceu conectada e nova chamada controlada retornou HTTP 200. O `ZAPI_WEBHOOK_TOKEN` no `.env` local ignorado pelo Git foi alinhado ao valor aceito, sem registrar o segredo neste arquivo. Falta observar um evento real de presença do contato para comprovar a mudança do indicador na interface.

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

## OpenAI — agente Luna

- `OPENAI_API_KEY` e `OPENAI_LUNA_AGENT_ID` são secrets obrigatórios do Worker. Configurá-los exclusivamente no Cloudflare e, para desenvolvimento, no `.env` local ignorado pelo Git; nunca inventar ou hardcodear seus valores.
- `OPENAI_TRANSCRIPTION_MODEL` define o modelo de transcrição e usa `gpt-4o-mini-transcribe` por padrão.
- A integração local usa o SDK oficial, carrega a configuração da agente pelo Agents API beta isolado no adapter e executa análises pela Responses API com saída JSON estruturada e `store: false`.
- A memória permanente permanece no D1. O contexto enviado é limitado a cadastro essencial com CPF mascarado, atendimento atual, documentos, até 12 pendências, até 12 fatos importantes e um resumo recente; o histórico completo de mensagens não é enviado.
- Durante conversas com responsável humano, a Luna opera em modo passivo: observa mensagens recebidas e envios humanos bem-sucedidos, atualiza fatos, pendências e resumo no D1 e não chama a Z-API nem cria mensagens de saída. A gravação do resumo compara `through_message_at` para impedir que uma execução antiga sobrescreva memória mais nova.
- A otimização de tokens agrupa texto a cada três mensagens, mantém imagens/PDFs/áudios imediatos e força o fechamento ao mudar para `waiting_customer` ou `resolved`. O contexto passivo caiu para 8 mensagens de até 500 caracteres, 8 documentos, 8 pendências e 8 fatos. Texto usa esforço `none`, arquivos usam `low`, os limites de saída variam de 450 a 900 e o cache é separado por cliente.
- O modo autônomo usa duas travas: `LUNA_AUTONOMOUS_ENABLED=true` habilita apenas a capacidade geral, e cada conversa permanece desligada por padrão até um administrador confirmar `Ativar Luna`. A ativação individual remove o atendente atual; abrir/assumir ou direcionar a conversa para um humano desativa a Luna, e desligar durante o processamento impede o envio. Antes de responder, o Worker também exige que a mensagem recebida ainda seja a mais recente, que a conversa continue autorizada e sem responsável, e que a análise não peça revisão humana. A migration `0010_luna_autonomous_replies.sql` registra uma única tentativa por mensagem, e `0011_luna_conversation_control.sql` guarda a autorização individual e sua auditoria. Não ativar uma conversa real sem destinatário autorizado.
- Schemas de ferramentas não são enviados por padrão nem no modo passivo. O conjunto CRM é carregado somente quando uma chamada autenticada informa `metadata.toolMode = "crm"`; novas ferramentas devem manter escopo estrito de cliente/atendimento e credenciais apenas em secrets do Worker.
- Imagens, PDFs e áudios privados são lidos do R2 somente depois de validar o vínculo com o cliente. Arquivos têm limite de 10 MB; imagens começam em detalhe baixo; áudio é transcrito separadamente; análises são reutilizadas por chave e ETag.
- A rota `POST /api/ai/luna` exige sessão do CRM e uma das permissões Chat, Leads ou Clientes. Usuários sem acesso a Clientes precisam informar uma conversa pertencente ao contato.
- A migration `0008_luna_ai.sql` cria fatos, análises de documentos, pendências, resumos compactos e métricas de execução. Ela está aplicada no D1 local e remoto.
- Nunca registrar a chave, documentos completos, transcrições completas ou dados sensíveis em logs. Os logs guardam somente request ID, client ID, tipo, duração, status, modelo, tokens e quantidade de ferramentas.
- A chave e o Agent ID locais estão preenchidos e permanecem ignorados pelo Git. O primeiro ID informado retornou `404 not_found_error`; após a correção feita pelo responsável em 13 de setembro de 2026, a chave acessou a agente Luna com modelo e instruções configurados. Uma chamada mínima sem dados reais, com saída JSON estruturada e `store: false`, terminou com sucesso e consumiu 1.257 tokens de entrada e 14 de saída.

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

Último resultado registrado: 65 testes unitários e 30 cenários E2E aprovados em desktop e Pixel 7, incluindo etiquetas e histórico por conversa, duração da primeira resposta em horas/minutos por lead, classificação automática, paginação, colagem de prints e chat em tempo real; typecheck e build aprovados.

## Migrações e deploy

- A migração `migrations/0004_user_profiles.sql` adiciona perfis, origem do cadastro, índice de presença e documentos dos clientes.
- A migração `migrations/0005_contact_avatar_cache.sql` adiciona as referências e o controle de renovação do cache privado das fotos dos contatos.
- A migração `migrations/0006_conversation_waiting.sql` adiciona tempo de espera, status operacional e índices de responsável/status.
- A migração `migrations/0007_first_response_index.sql` adiciona índice para localizar a primeira mensagem recebida e a primeira resposta por conversa sem varrer todo o histórico.
- Todas as migrações até `0007_first_response_index.sql` estão aplicadas no D1 remoto; a lista remota não mostrou migrações pendentes após o deploy.
- Todas as migrations até `0008_luna_ai.sql` estão aplicadas no D1 remoto; a lista remota não mostrou migrations pendentes após o deploy da integração Luna.
- A migration `0009_luna_token_metrics.sql` adiciona `cached_input_tokens` e um índice de métricas de uso para medir economia de cache; ela está aplicada no D1 local e remoto.
- As migrations `0010_luna_autonomous_replies.sql` e `0011_luna_conversation_control.sql` estão aplicadas no D1 local e remoto. A `0011` adiciona a autorização individual, o administrador que a concedeu, o horário e um índice parcial; todos os registros existentes receberam `0` por padrão.
- A migration `0012_backfill_automatic_lead_classification.sql` está aplicada no D1 remoto e reclassifica apenas os leads antigos cuja `classification_source` continua `automatic`; decisões manuais permanecem intactas.
- A migration `0013_conversation_tags.sql` está aplicada no D1 remoto e cria o catálogo de etiquetas, os vínculos ativos por conversa e o histórico imutável de inclusão e remoção.

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

- O WhatsApp institucional foi confirmado como operacional pelo responsável; não há teste adicional pendente. Manter apenas o monitoramento normal da integração.
- O novo fluxo de produtividade do chat está publicado: filtros `Minhas`, `Não atribuídas`, `Não lidas` e `Quentes`; ordenação por maior espera; status `Nova`, `Em atendimento`, `Aguardando cliente` e `Finalizada`; reabertura automática; direcionamento pelo administrador; e abertura consciente para evitar leitura/atribuição automática da primeira conversa.
- O fluxo de filas, espera, direcionamento e status foi publicado e validado na versão `115abb49-8787-4871-9989-2c8d4618668e`, correspondente ao commit `0305fc0`. A página pública respondeu HTTP 200, exibiu o título e a tela de login esperados e não apresentou overflow horizontal.
- Os seletores nativos de atendente e status foram substituídos por menus próprios, amplos e responsivos; os cinco filtros do chat foram compactados em uma única linha. O ajuste foi publicado e validado na versão `31dd9983-499d-4c16-bb41-d3df2ecbc530`, correspondente ao commit `63220c5`.
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
- O callback de presença da Z-API foi cadastrado após autorização explícita e está direcionado ao endpoint protegido já processado pelo Worker.
- Leitura sincronizada, atribuição automática do atendente e fotos dos contatos foram publicadas e validadas na versão `f50d079c-446b-4ccb-a5e9-39a672bb0a66`, correspondente ao commit `7ec5c12`.
- O player redesenhado de prévia de áudio foi publicado e validado em produção na versão `131eda96-db83-4226-8e1f-c675b27f3cb3`, correspondente ao commit `08d5b81`.
- A edição de clientes foi publicada e validada na versão `dbda570a-3331-471f-aa36-8fd14de4471c`, correspondente ao commit `ea379da`. A página pública e `/api/auth/status` responderam HTTP 200; o Chromium exibiu o título e a tela de login esperados, sem overflow horizontal. Não foram alterados registros reais de clientes durante a validação.
- Em 13 de setembro de 2026, foi constatado que o chat dependia apenas dos eventos WebSocket para atualizar conversas e mensagens, sem recuperação quando um evento era perdido. A interface agora sincroniza a lista e as 40 mensagens mais recentes ao voltar para a aba e após reconectar, sem descartar o histórico já carregado. A cada 30 segundos, consulta apenas enquanto o WebSocket correspondente não está aberto; conexões saudáveis usam eventos e um ping/pong para detectar falhas silenciosas. Usuários com acesso somente a Leads também recebem avisos pelo WebSocket global e não consultam periodicamente com a conexão saudável. A presença recebida pela Z-API agora associa números móveis brasileiros com ou sem nono dígito e trata `PAUSED` como fim da digitação, sem marcar o contato offline.
- A instância institucional Z-API foi consultada somente para leitura: estava conectada, com callback de presença configurado para o CRM. O D1 remoto tinha duas conversas, nenhuma marcada online e o maior `last_seen_at` era `2026-09-12T18:00:50.000Z`; assim, o horário antigo exibido refletia o dado salvo. Presença de contatos depende de eventos efetivamente emitidos pela Z-API e das configurações de privacidade do WhatsApp; não há endpoint de consulta instantânea de presença documentado na integração atual.
- A correção passou por 27 testes unitários, typecheck e build. Os 16 casos E2E originais passaram em desktop e Pixel 7; o caso adicional de Leads com acesso exclusivo também passou nos dois perfis. O processo Playwright precisou ser interrompido após emitir os resultados porque o servidor de desenvolvimento não encerrou automaticamente neste ambiente.
- Após autorização explícita do responsável em 13 de setembro de 2026, o commit `3da7d2c` foi enviado ao `main` institucional e publicado no Cloudflare na versão `5726bac7-e388-4771-8b68-4658a1009df0`. A conta Cloudflare e o destino foram conferidos; não havia migrações pendentes. A página pública e `/api/auth/status` responderam HTTP 200, e o webhook protegido recusou token inválido com HTTP 401. No Chromium, a página mostrou o título `Karrer | Atendimento`, a tela de login, o novo bundle e nenhum overflow horizontal. Próximo passo operacional: observar um novo evento real de presença fornecido pela Z-API para confirmar o indicador online de um contato, sem enviar mensagem de teste não solicitada.
- Depois que o responsável informou que o indicador ainda mostrava o horário antigo, a investigação confirmou a divergência de token do callback de presença e a corrigiu na Z-API. O valor antigo de `last_seen_at` não muda retroativamente; aguardar um evento novo de presença do contato para validar o fluxo completo Z-API → Worker → D1 → WebSocket → interface. Não há novo deploy de código necessário para essa correção de configuração.
- O cartão de Leads “Tempo médio da primeira resposta” devolvia `0` fixo pela API. O cálculo agora usa a primeira mensagem recebida e o primeiro envio bem-sucedido por usuário do CRM depois dela; envios falhos e mensagens originadas fora do CRM não entram. O tempo pertence ao usuário que respondeu, mesmo se a conversa for transferida depois. A interface calcula a média sobre o período e o filtro de atendente com os dados já carregados da lista, mostra quantidade de conversas respondidas e exibe `—` quando não há amostra. Em consulta agregada somente de leitura, o D1 de produção retornou uma conversa respondida com média de 5,1 minutos. A implementação passou por 28 testes unitários, 20 E2E, typecheck e build. A migração `0007` foi aplicada, o commit `50d43db` foi enviado ao `main` institucional e o Worker foi publicado na versão `284a5cf8-ac13-4aed-9e01-792bdb45c183`. A página pública e `/api/auth/status` responderam HTTP 200, e o HTML servido referencia o novo bundle `index-LLP44SkJ.js`. Não havia sessão autenticada disponível para observar o cartão com dados reais no navegador.
- A pedido do responsável, Leads passou a listar todos os usuários cadastrados com foto, nome, média individual da primeira resposta e quantidade de conversas respondidas, inclusive quem ainda não respondeu. A primeira versão do endpoint `GET /api/leads/attendants` lia apenas ID, nome e referência da foto ao abrir a tela; filtros e médias continuam locais, sem novas leituras de D1. Fotos usam a rota privada existente, agora acessível a usuários com permissão de Leads, com cache de cinco minutos. A lista de conversas seleciona primeiro no máximo 200 IDs recentes e só então calcula as primeiras respostas, limitando os acessos indexados ao histórico de mensagens. Em 13 de setembro, o D1 remoto continha 2 conversas, 10 mensagens e 5 usuários. Há um limite conhecido: as médias na tela abrangem as até 200 conversas carregadas; ao ultrapassar esse volume, criar um agregado paginado ou materializado antes de afirmar que a média cobre todo o histórico. Typecheck, 28 testes unitários, build e 20 E2E em desktop e celular passaram; o runner E2E permaneceu aberto após imprimir os resultados e foi interrompido. O commit `3a207aa` foi enviado ao `main` institucional e publicado no Worker `1b46b0d5-9779-4f15-9962-5d55c0eb10d5`; a página pública e `/api/auth/status` retornaram HTTP 200, com o bundle `index-JtbZrNeR.js` no HTML. Não havia sessão autenticada disponível para verificar visualmente os dados reais da equipe.
- O quadro da equipe em Leads passa a mostrar presença online (mesmo critério de sessão ativa nos últimos seis minutos da Administração) e carga atual por responsável: conversas `in_progress` contam como em atendimento; `waiting_customer` aparecem como aguardando cliente. Uma pessoa offline com conversa ainda aberta mostra o lead em andamento, sem ser contada como atendendo agora. O endpoint leve de atendentes agrega sessões e conversas usando os índices existentes, com atualização no máximo a cada 60 segundos enquanto a tela está visível e ao voltar para a aba; não há nova migração. Testes locais: 29 unitários, 20 E2E em desktop e celular, typecheck e build aprovados. O commit `4f22339` foi enviado ao `main` institucional e publicado no Worker `a1224044-c4e2-4c56-bbb6-4abc5f14327f`; a página pública e `/api/auth/status` retornaram HTTP 200, o HTML referenciou `index-BCNXL2B7.js` e a rota da equipe respondeu HTTP 401 sem sessão. Não havia sessão autenticada disponível para confirmar visualmente os estados reais da equipe em produção.
- Continua pendente configurar no Cloudflare os três secrets do Google Drive usando as credenciais da conta de serviço institucional da Karrer e repetir o deploy e o teste de upload.
- A integração Luna foi publicada em 13 de setembro de 2026 no Worker `f5a96e89-2bf9-4df0-abf1-e1a1a18fda76`, correspondente ao commit de código `6698c6e`. `OPENAI_API_KEY` e `OPENAI_LUNA_AGENT_ID` foram confirmados como secrets ocultos do Worker; as cinco tabelas `luna_*` existem no D1 remoto e não há migrations pendentes. A validação incluiu typecheck, build, 40 testes unitários, 20 cenários E2E em desktop/celular, auditoria de dependências de produção sem vulnerabilidades, chamada mínima bem-sucedida à agente real sem dados de clientes e resposta HTTP 200 do endpoint público de saúde. Próximo passo operacional: observar a primeira mensagem real de uma conversa atribuída a um humano e confirmar a criação de memória passiva no D1 sem mensagem automática de saída.
- A otimização de consumo da Luna foi publicada no Worker `d0b2d304-67f7-4493-8575-6d6bcae2782f`, correspondente ao commit de código `b11011f`: processamento textual em lotes de três, flush ao aguardar/finalizar, anexos imediatos, contexto reduzido, esforço `none`/`low`, saída limitada, cache por cliente, métricas de tokens em cache e ferramentas carregadas somente sob demanda. Passou por 42 testes unitários, 20 E2E, typecheck e build. A migration `0009` está aplicada remotamente, os secrets OpenAI foram preservados, a coluna `cached_input_tokens` foi confirmada no schema remoto e o endpoint de saúde respondeu HTTP 200.
- Em 14 de setembro de 2026, o atendimento autônomo da Luna foi publicado na versão `af807ccd-6ad2-4a34-a904-2337d95f1832`, correspondente ao commit de código `09d6922`, com trava global desligada, deduplicação por mensagem, rechecagem de atribuição/ordem antes do envio, bloqueio por revisão humana, memória persistente e publicação em tempo real. A migration `0010` está aplicada no D1 local e remoto. A validação passou por 50 testes unitários, incluindo o orquestrador autônomo, 22 E2E em desktop/celular, typecheck e build. Produção respondeu HTTP 200, não havia migrations pendentes, a rota da Luna recusou acesso sem sessão com HTTP 401 e a tabela `luna_autonomous_replies` estava vazia. A configuração publicada confirmou `LUNA_AUTONOMOUS_ENABLED=false`; nenhuma mensagem automática foi enviada. Próximo passo: decidir separadamente se haverá ativação controlada com destinatário autorizado.
- O compositor do chat já enviava com Enter e preservava quebra de linha com Shift + Enter; em 14 de setembro de 2026, essa regra ganhou uma instrução visível e proteção para não enviar durante composição de caracteres pelo teclado. O comportamento passou a ter cobertura E2E em desktop e celular e foi publicado na mesma versão `af807ccd-6ad2-4a34-a904-2337d95f1832`. Um seletor E2E antigo também foi tornado exato para eliminar ambiguidade entre as mensagens 40 e 408.
- A ampliação de imagens do chat foi publicada na versão `ad9e483f-6603-4ab0-a718-5bb97a64a460`, correspondente ao commit `dbe6c95`. Imagens com mídia privada agora abrem em uma sobreposição responsiva e podem ser fechadas pelo botão, fundo ou Escape. A validação passou por 50 testes unitários, 22 E2E em desktop/celular, typecheck e build; a página pública e `/api/auth/status` responderam HTTP 200, o Chromium carregou os bundles `index-CFE3C65S.js` e `index-DVYCVhs7.css` e não encontrou overflow horizontal no viewport móvel.
- O download autenticado das imagens ampliadas foi publicado na versão `94b6b710-2ca3-4d45-8e14-1722268d2a51`, correspondente ao commit `bcd89e5`. O botão `Baixar imagem` usa a rota privada já existente, força o arquivo como anexo, higieniza o nome e infere JPG/PNG/WebP pelo tipo real quando não há extensão. A validação passou por 52 testes unitários, 22 E2E em desktop/celular, typecheck e build. A página pública e `/api/auth/status` responderam HTTP 200, a rota de mídia recusou acesso sem sessão com HTTP 401, o Chromium carregou `index-C6MdRW1x.js` e `index-CWeZ94jA.css` e não encontrou overflow horizontal no viewport móvel.
- A lista de Leads passou a exibir no máximo 20 registros por página, com intervalo, total, página atual e botões Anterior/Próxima; qualquer mudança de busca ou filtro reinicia a navegação. O ajuste foi publicado na versão `07248a13-d4b0-4849-8297-e176838ecf7e`, correspondente ao commit de código `427640f`. Passou por 52 testes unitários, 24 E2E em desktop/celular, typecheck e build; não havia migrações pendentes. A página pública e `/api/auth/status` responderam HTTP 200, o Chromium carregou `index-s2cOQxow.js` e `index-QBVx7Kss.css`, mostrou a tela de login e não apresentou overflow horizontal no viewport móvel.
- O controle individual do atendimento autônomo foi publicado na versão `47b4a45f-9477-45f8-ab4e-77735b3b18db`, correspondente ao commit de código `6d254fd`. Somente administradores veem e podem usar o botão; a ativação exige confirmação, aparece na lista e é removida automaticamente quando um humano assume. A trava geral ficou `true`, mas uma consulta ao D1 antes e depois do deploy confirmou `0` conversas autorizadas, portanto nenhuma mensagem automática foi disparada. A migration `0011` está aplicada e não restaram migrations pendentes. A validação passou por 54 testes unitários, 26 E2E em desktop/celular, typecheck e build; a página pública e `/api/auth/status` responderam HTTP 200, a nova rota respondeu HTTP 401 sem sessão, o Chromium carregou `index-fmBok68Z.js` e `index-DWSHVX3N.css` e não apresentou overflow horizontal no viewport móvel. Próximo passo operacional: o administrador pode autorizar uma conversa de teste com destinatário consentido; não ativar contatos reais indiscriminadamente.
- A colagem de prints no compositor foi publicada na versão `21e27d43-7158-41cf-b00d-cbb642b9bd45`, correspondente ao commit de código `105b3d1`. Ao colar uma imagem JPG, PNG ou WebP com `Ctrl + V`, o chat abre a prévia existente antes do envio e mantém o upload pela rota autenticada; a dica visível também informa `Enter`, `Shift + Enter` e `Ctrl + V`. A validação passou por 54 testes unitários, 28 E2E em desktop/celular, typecheck e build; não havia migrações pendentes. A página pública e `/api/auth/status` responderam HTTP 200, o HTML referenciou `index-BIiJk966.js` e `index-DWSHVX3N.css`, e o Chromium não encontrou overflow horizontal no viewport móvel. Nenhuma mensagem ou imagem real foi enviada durante a validação.
- A classificação automática pela conversa foi publicada na versão `e587ff84-c559-4b83-9bb4-746175eed074`, correspondente ao commit de código `7dd40cd`. O Worker recalcula os leads automáticos após cada mensagem recebida usando sinais determinísticos de interesse do cliente nas 30 mensagens mais recentes, sem custo adicional da Luna, transmite a mudança em tempo real e não sobrescreve classificações manuais. A migration `0012` corrigiu o histórico: a consulta agregada posterior mostrou 17 leads automáticos frios, 21 mornos e nenhum quente; as três classificações manuais permaneceram duas quentes e uma morna. A validação passou por 61 testes unitários, 28 E2E em desktop/celular, typecheck e build; não restaram migrations pendentes. A página pública e `/api/auth/status` responderam HTTP 200, e o Chromium mostrou a tela esperada sem overflow horizontal em 412 px. Próximo passo operacional: observar a próxima mensagem real e confirmar a mudança correspondente na lista sem editar manualmente o lead.
- A exibição do tempo de primeira resposta por lead foi publicada na versão `c1d95ba6-8c7a-4a70-8ff6-5aea2d7736a4`, correspondente ao commit de código `9126b87`. Cada conversa continua contribuindo com um único intervalo entre a primeira mensagem recebida e a primeira resposta válida; as médias gerais e por atendente agora são identificadas explicitamente como médias por lead. Durações a partir de 60 minutos aparecem em horas e minutos, por exemplo `279 min` como `4h 39min`; abaixo de uma hora continuam em minutos. A validação passou por 64 testes unitários, 28 E2E em desktop/celular, typecheck e build; não havia migrations pendentes. A página pública e `/api/auth/status` responderam HTTP 200, o HTML referenciou `index-D_5utDhS.js` e `index-DWSHVX3N.css`, e o Chromium não encontrou overflow horizontal em 412 px.
- As etiquetas com histórico por conversa foram publicadas na versão `44cb1fd4-9961-4ce6-9cfe-1793817715ea`, correspondente ao commit de código `5a66b36`. A migration `0013` está aplicada no D1 remoto, sem migrações pendentes, e o catálogo possui 10 etiquetas ativas. A interface permite várias etiquetas simultâneas, mostra as ativas no cabeçalho e registra inclusão ou remoção com responsável e horário; as mudanças também atualizam outras sessões em tempo real. A validação passou por 65 testes unitários, 30 E2E em desktop/celular, typecheck e build. A página pública e `/api/auth/status` responderam HTTP 200, o HTML referenciou `index-DbX4GNZ3.js` e `index-BG1W1PuV.css`, e o Chromium mostrou a tela de login sem overflow horizontal em 412 px. Nenhuma etiqueta de conversa real foi alterada durante a validação.
- Em 15 de setembro de 2026, o reconhecimento e a prévia de links recebidos no chat foram publicados na versão `96a1f6a9-8334-437f-ab72-b1d00b4aa84c`, correspondente ao commit de código `2440cfc`. URLs HTTP/HTTPS dentro de texto passam a ser clicáveis e o primeiro link mostra prévia obtida por `GET /api/link-preview`, protegida por sessão e permissão de Chat/Leads. A extração prioriza Open Graph/Twitter e usa título HTML/domínio como fallback; falhas de prévia não escondem nem desativam o link. A validação isolada passou por 73 testes unitários, 32 E2E em desktop/celular, typecheck e build. Em produção, a página e `/api/auth/status` responderam HTTP 200, a rota de prévia recusou acesso sem sessão com HTTP 401, o Chromium carregou o bundle `index-DfhVxbIy.js`, mostrou a tela de login e não apresentou overflow horizontal em 412 px. As alterações locais anteriores do envio múltiplo de anexos foram preservadas e não fizeram parte desse commit nem do deploy. Próximo passo operacional: validar a prévia de um link real do Adobe em uma sessão autenticada, sem encaminhar ou alterar documentos do cliente.
