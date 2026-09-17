# Liberar push/deploy para o Claude Code

Por padrão, o Claude Code bloqueia (mesmo em "modo automático" e mesmo se eu
autorizar pelo chat) ações de:
- publicar código (`git push`)
- aplicar migração no banco remoto (`wrangler d1 migrations apply --remote`)
- fazer deploy em produção (`wrangler deploy`)

Isso é proposital: essas travas existem justamente para não poderem ser
destravadas só por uma mensagem no chat (nem minha, nem do usuário, nem de
qualquer conteúdo que o Claude leia). A única forma de liberar é você mesmo
criar/editar o arquivo de configuração fora do chat.

## Passo a passo

1. Crie a pasta `.claude` na raiz do projeto (se não existir).
2. Dentro dela, crie o arquivo `settings.local.json` com este conteúdo:

```json
{
  "permissions": {
    "allow": [
      "Bash(git push origin main:*)",
      "Bash(npx wrangler deploy:*)",
      "Bash(npx.cmd wrangler deploy:*)",
      "Bash(npm run deploy:*)",
      "Bash(npx wrangler d1 migrations apply karrer-atendimento-db --remote:*)",
      "Bash(npx.cmd wrangler d1 migrations apply karrer-atendimento-db --remote:*)",
      "Bash(npx wrangler d1 execute karrer-atendimento-db --remote:*)",
      "Bash(npx wrangler deployments list:*)"
    ]
  }
}
```

3. Salve o arquivo e reinicie a sessão do Claude Code (feche e abra de novo,
   ou recarregue a extensão no VSCode) para a configuração valer.

Esse arquivo (`.claude/settings.local.json`) é local da sua máquina — não
sobe pro Git (já deixei o `.gitignore` configurado para isso).

Depois disso, quando eu terminar uma mudança, consigo rodar `git push`,
aplicar migração e fazer `wrangler deploy` sozinho, sem precisar te pedir
para colar comandos no terminal.
