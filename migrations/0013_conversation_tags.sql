CREATE TABLE lead_tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE conversation_tags (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES lead_tags(id),
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (conversation_id, tag_id)
);

CREATE TABLE conversation_tag_history (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES lead_tags(id),
  action TEXT NOT NULL CHECK (action IN ('added', 'removed')),
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_conversation_tags_conversation ON conversation_tags(conversation_id, assigned_at DESC);
CREATE INDEX idx_conversation_tag_history_conversation ON conversation_tag_history(conversation_id, created_at DESC);

INSERT INTO lead_tags (id, slug, name, color, sort_order) VALUES
  ('tag-new-contact', 'novo-contato', 'Novo contato', '#72808a', 10),
  ('tag-analysis', 'em-analise', 'Em análise', '#625d54', 20),
  ('tag-waiting-documents', 'aguardando-documentos', 'Aguardando documentos', '#b07b2e', 30),
  ('tag-documents-received', 'documentos-recebidos', 'Documentos recebidos', '#52708a', 40),
  ('tag-waiting-contract', 'aguardando-contrato', 'Aguardando contrato', '#9b6a35', 50),
  ('tag-contract-sent', 'contrato-enviado', 'Contrato enviado', '#695b91', 60),
  ('tag-contract-signed', 'contrato-assinado', 'Contrato assinado', '#3e7c4a', 70),
  ('tag-waiting-payment', 'aguardando-pagamento', 'Aguardando pagamento', '#9d4032', 80),
  ('tag-follow-up', 'retorno-agendado', 'Retorno agendado', '#397887', 90),
  ('tag-no-interest', 'sem-interesse', 'Sem interesse', '#777777', 100);
