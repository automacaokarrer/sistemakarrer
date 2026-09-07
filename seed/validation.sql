PRAGMA foreign_keys = ON;

-- Dados exclusivamente fictícios para validação visual em produção.
-- IDs e telefones reservados permitem reaplicar este arquivo sem duplicação.

INSERT INTO contacts (id, phone, name, bank, ccb, profile_complete, created_at, updated_at) VALUES
  ('demo-contact-beatriz', '550000000001', 'Beatriz Almeida · Demo', 'Banco Pan', 'CCB-DEMO-001', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-contact-lucas', '550000000002', 'Lucas Ferreira · Demo', 'Banco BMG', 'CCB-DEMO-002', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-contact-camila', '550000000003', 'Camila Rodrigues · Demo', 'Itaú Consignado', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-contact-rafael', '550000000004', 'Rafael Martins · Demo', 'Banco Daycoval', 'CCB-DEMO-004', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-contact-juliana', '550000000005', 'Juliana Costa · Demo', 'Banco Mercantil', NULL, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-contact-pedro', '550000000006', 'Pedro Nascimento · Demo', NULL, NULL, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(id) DO UPDATE SET
  phone = excluded.phone, name = excluded.name, bank = excluded.bank, ccb = excluded.ccb,
  profile_complete = excluded.profile_complete, created_at = excluded.created_at, updated_at = excluded.updated_at;

INSERT INTO conversations (id, contact_id, assignee_id, stage, classification, classification_source, score, last_message_at, unread_count, online, last_seen_at, created_at, updated_at) VALUES
  ('demo-conv-beatriz', 'demo-contact-beatriz', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'Documentação recebida', 'hot', 'manual', 91, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 minutes'), 3, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-conv-lucas', 'demo-contact-lucas', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'Proposta enviada', 'warm', 'manual', 67, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 minutes'), 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-45 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-conv-camila', 'demo-contact-camila', NULL, 'Primeiro contato', 'cold', 'manual', 32, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-conv-rafael', 'demo-contact-rafael', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'Procuração assinada', 'hot', 'manual', 84, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 hours'), 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-conv-juliana', 'demo-contact-juliana', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'Aguardando documentos', 'warm', 'manual', 58, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), 2, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('demo-conv-pedro', 'demo-contact-pedro', NULL, 'Sem retorno', 'cold', 'manual', 21, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(id) DO UPDATE SET
  assignee_id = excluded.assignee_id, stage = excluded.stage, classification = excluded.classification,
  classification_source = excluded.classification_source, score = excluded.score,
  last_message_at = excluded.last_message_at, unread_count = excluded.unread_count,
  online = excluded.online, last_seen_at = excluded.last_seen_at,
  created_at = excluded.created_at, updated_at = excluded.updated_at;

INSERT INTO messages (id, conversation_id, sender_user_id, direction, type, body, file_name, duration, status, created_at) VALUES
  ('demo-msg-beatriz-1', 'demo-conv-beatriz', NULL, 'inbound', 'text', 'Olá! Quero entender se houve cobrança indevida no meu consignado.', NULL, NULL, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 minutes')),
  ('demo-msg-beatriz-2', 'demo-conv-beatriz', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'outbound', 'text', 'Olá, Beatriz. Vamos analisar seu contrato. Pode enviar os documentos?', NULL, NULL, 'read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 minutes')),
  ('demo-msg-beatriz-3', 'demo-conv-beatriz', NULL, 'inbound', 'document', 'Segue o contrato solicitado.', 'Contrato_consignado_demo.pdf', NULL, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 minutes')),
  ('demo-msg-lucas-1', 'demo-conv-lucas', NULL, 'inbound', 'text', 'Recebi a proposta. Qual é o próximo passo?', NULL, NULL, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-65 minutes')),
  ('demo-msg-lucas-2', 'demo-conv-lucas', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'outbound', 'text', 'Vou detalhar as etapas e os documentos necessários.', NULL, NULL, 'delivered', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-55 minutes')),
  ('demo-msg-lucas-3', 'demo-conv-lucas', NULL, 'inbound', 'audio', NULL, NULL, 37, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 minutes')),
  ('demo-msg-camila-1', 'demo-conv-camila', NULL, 'inbound', 'text', 'Vi uma publicação e gostaria de tirar uma dúvida.', NULL, NULL, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours', '-10 minutes')),
  ('demo-msg-camila-2', 'demo-conv-camila', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'outbound', 'text', 'Claro, Camila. Conte resumidamente o que aconteceu.', NULL, NULL, 'read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours')),
  ('demo-msg-rafael-1', 'demo-conv-rafael', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'outbound', 'document', 'Procuração para assinatura.', 'Procuracao_demo.pdf', NULL, 'read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-21 hours')),
  ('demo-msg-rafael-2', 'demo-conv-rafael', NULL, 'inbound', 'text', 'Documento assinado e conferido. Obrigado!', NULL, NULL, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 hours')),
  ('demo-msg-juliana-1', 'demo-conv-juliana', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'outbound', 'text', 'Juliana, ainda precisamos do RG e do comprovante de residência.', NULL, NULL, 'delivered', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days', '-15 minutes')),
  ('demo-msg-juliana-2', 'demo-conv-juliana', NULL, 'inbound', 'text', 'Certo, vou separar e enviar ainda hoje.', NULL, NULL, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')),
  ('demo-msg-pedro-1', 'demo-conv-pedro', NULL, 'inbound', 'text', 'Gostaria de uma avaliação inicial do meu contrato.', NULL, NULL, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days', '-20 minutes')),
  ('demo-msg-pedro-2', 'demo-conv-pedro', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'outbound', 'text', 'Podemos ajudar. Quando puder, envie uma foto legível do contrato.', NULL, NULL, 'read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'))
ON CONFLICT(id) DO UPDATE SET
  sender_user_id = excluded.sender_user_id, direction = excluded.direction, type = excluded.type,
  body = excluded.body, file_name = excluded.file_name, duration = excluded.duration,
  status = excluded.status, created_at = excluded.created_at;
