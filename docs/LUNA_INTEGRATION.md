# Integração Luna

A Luna usa o backend do Cloudflare Worker. A chave da OpenAI nunca é enviada ao navegador. A configuração do agente é carregada pelo ID salvo na plataforma da OpenAI, enquanto fatos, análises, pendências, resumos e métricas permanentes ficam no D1 da Karrer.

## Configuração

Secrets obrigatórios do Worker:

```powershell
npx.cmd wrangler secret put OPENAI_API_KEY
npx.cmd wrangler secret put OPENAI_LUNA_AGENT_ID
```

Configuração:

- `OPENAI_LUNA_AGENT_ID`: ID real da agente Luna, mantido como secret para não registrar o identificador no repositório.
- `OPENAI_TRANSCRIPTION_MODEL`: modelo de transcrição; o padrão é `gpt-4o-mini-transcribe`.

No desenvolvimento, os mesmos nomes ficam no `.env`, que é ignorado pelo Git. `npm run dev` sincroniza apenas os bindings permitidos para `.dev.vars`.

A chave precisa pertencer ao mesmo projeto OpenAI em que a agente Luna foi criada. Um `404 not_found_error` ao consultar um ID com prefixo `agent_`, junto de uma listagem vazia de agentes, indica que a chave autenticou, mas não enxerga a agente naquele projeto.

## Endpoint

`POST /api/ai/luna` exige uma sessão válida do CRM e acesso a Chat, Leads ou Clientes. Usuários sem acesso a Clientes precisam informar uma conversa que pertença ao contato.

Entrada de texto:

```json
{
  "clientId": "contact-maria",
  "caseId": "conv-maria",
  "inputType": "text",
  "text": "O cliente informou que enviará o contrato amanhã.",
  "metadata": {}
}
```

Para `image`, `pdf` ou `audio_transcription`, informe `fileKey` de um objeto R2 já vinculado ao cliente. O backend confere o vínculo, o MIME type e o limite de 10 MB. Áudios são transcritos antes da análise. Imagens usam detalhe baixo inicialmente. Análises de arquivos são reutilizadas enquanto o ETag do objeto não mudar.

Resposta bem-sucedida:

```json
{
  "success": true,
  "requestId": "gerado-pelo-servidor",
  "cached": false,
  "data": {
    "status": "APPROVED",
    "contentType": "text",
    "documentType": null,
    "summary": "Cliente informou que enviará o contrato amanhã.",
    "extractedData": {},
    "problems": [],
    "pendingItems": ["contrato"],
    "memoryUpdates": ["Cliente informou que enviará o contrato amanhã."],
    "requiresHumanReview": false,
    "confidence": 0.96
  }
}
```

Erros da integração seguem `{ "success": false, "requestId": "...", "code": "...", "message": "..." }` e não expõem stack trace nem resposta bruta da OpenAI.

## Atendimento humano

Quando uma conversa possui responsável e não está finalizada, a Luna trabalha em modo passivo. Mensagens recebidas e envios bem-sucedidos do atendente são analisados em segundo plano, sem atrasar o webhook nem o chat. A Luna atualiza fatos, pendências, análises de imagens/PDFs/áudios e um resumo acumulado no D1.

O modo passivo não chama a Z-API, não insere mensagem de saída e não envia resposta ao cliente. Para reduzir custo, mensagens de texto são acumuladas e analisadas a cada três mensagens; imagens, PDFs e áudios continuam imediatos. A mudança para `waiting_customer` ou `resolved` força a atualização final do que ainda estiver pendente. O contexto usa no máximo as 8 mensagens recentes, com até 500 caracteres por mensagem, e o resumo só é substituído por uma análise correspondente à mesma mensagem ou a uma mensagem mais nova. Conversas sem responsável não disparam essa captura.

## Controle de tokens e ferramentas

- O modelo configurado é carregado da agente; a Luna usa o esforço `none` em texto e `low` em arquivos.
- Texto passivo tem limite de 450 tokens de saída; as demais análises usam limites entre 700 e 900.
- O contexto passivo leva no máximo 8 documentos recebidos, 8 pendências, 8 fatos e 8 mensagens recentes.
- `prompt_cache_key` separa o cache por cliente; `cached_input_tokens` é gravado em `luna_runs` para medir o resultado.
- Nenhum schema de ferramenta é enviado por padrão. Uma chamada autenticada pode informar `metadata.toolMode = "crm"` para carregar o conjunto de ferramentas do CRM somente quando necessário.

Novas ferramentas podem ser conectadas em `src/worker/luna-tools.ts`. Cada ferramenta precisa ter schema limitado, validar `clientId` e `caseId` contra a requisição atual, exigir a permissão adequada no endpoint e registrar alterações relevantes. Integrações externas devem usar secrets do Worker e nunca entregar credenciais ao modelo.

## Teste local sem dados reais

Depois de aplicar as migrations e carregar `seed/demo.sql`, use uma sessão local do CRM:

```powershell
curl.exe -X POST http://localhost:5197/api/ai/luna `
  -H "Content-Type: application/json" `
  -H "Cookie: karrer_session=<SESSAO_LOCAL>" `
  --data '{"clientId":"contact-maria","caseId":"conv-maria","inputType":"text","text":"Teste local: o contrato será enviado amanhã.","metadata":{"source":"local_demo"}}'
```

Esse exemplo usa somente registros fictícios do seed local. Não use `seed/validation.sql` em produção.
