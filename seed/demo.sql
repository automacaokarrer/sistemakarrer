INSERT INTO contacts (id, phone, name, bank, ccb, profile_complete) VALUES
  ('contact-maria', '5592980000001', 'Maria Souza', 'Banco Pan', '0034821', 1),
  ('contact-joao', '5592990000002', 'Joao Pereira', 'Banco BMG', NULL, 1),
  ('contact-ana', '5592980000003', 'Ana Lima', 'Itau Consignado', NULL, 1),
  ('contact-carlos', '5592990000004', 'Carlos Mendes', 'Banco Pan', NULL, 1),
  ('contact-roberto', '5592980000005', 'Roberto Alves', 'Banco Daycoval', NULL, 1);

INSERT INTO conversations (id, contact_id, stage, classification, classification_source, score, last_message_at, unread_count, online, last_seen_at) VALUES
  ('conv-maria', 'contact-maria', 'Documentacao recebida', 'hot', 'automatic', 82, '2026-09-06T14:32:00.000Z', 3, 1, '2026-09-06T14:31:00.000Z'),
  ('conv-joao', 'contact-joao', 'Aguardando contrato', 'warm', 'automatic', 56, '2026-09-06T13:10:00.000Z', 0, 0, '2026-09-06T13:10:00.000Z'),
  ('conv-ana', 'contact-ana', 'Primeiro contato', 'cold', 'automatic', 28, '2026-09-05T18:20:00.000Z', 0, 0, '2026-09-05T18:20:00.000Z'),
  ('conv-carlos', 'contact-carlos', 'Proposta enviada', 'warm', 'automatic', 61, '2026-09-05T15:40:00.000Z', 0, 0, '2026-09-05T15:40:00.000Z'),
  ('conv-roberto', 'contact-roberto', 'Procuracao assinada', 'hot', 'automatic', 76, '2026-09-04T12:00:00.000Z', 0, 0, '2026-09-04T12:00:00.000Z');

INSERT INTO messages (id, conversation_id, direction, type, body, status, created_at) VALUES
  ('msg-1', 'conv-maria', 'inbound', 'text', 'Ola, vi o anuncio sobre o seguro embutido no emprestimo consignado. Gostaria de saber se tenho direito a devolucao.', 'received', '2026-09-06T14:02:00.000Z'),
  ('msg-2', 'conv-maria', 'outbound', 'text', 'Boa tarde, Maria. Sim, analisamos casos assim. Pode me enviar uma foto do documento com foto e o contrato do emprestimo?', 'read', '2026-09-06T14:05:00.000Z'),
  ('msg-3', 'conv-maria', 'inbound', 'image', 'RG frente', 'received', '2026-09-06T14:09:00.000Z'),
  ('msg-4', 'conv-maria', 'inbound', 'audio', NULL, 'received', '2026-09-06T14:12:00.000Z'),
  ('msg-5', 'conv-maria', 'outbound', 'document', 'Procuracao_Maria_Souza.pdf', 'read', '2026-09-06T14:20:00.000Z'),
  ('msg-6', 'conv-maria', 'inbound', 'text', 'Perfeito, doutor. Obrigada pela atencao.', 'received', '2026-09-06T14:32:00.000Z');
