-- Reclassifica somente leads que nunca foram definidos manualmente.
UPDATE conversations
SET score = CASE
  WHEN (SELECT lower(COALESCE(m.body, '')) FROM messages m
    WHERE m.conversation_id = conversations.id AND m.direction = 'inbound'
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1) LIKE '%não tenho interesse%'
    OR (SELECT lower(COALESCE(m.body, '')) FROM messages m
      WHERE m.conversation_id = conversations.id AND m.direction = 'inbound'
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1) LIKE '%nao tenho interesse%'
    OR (SELECT lower(COALESCE(m.body, '')) FROM messages m
      WHERE m.conversation_id = conversations.id AND m.direction = 'inbound'
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1) LIKE '%remova meu contato%'
    OR (SELECT lower(COALESCE(m.body, '')) FROM messages m
      WHERE m.conversation_id = conversations.id AND m.direction = 'inbound'
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1) LIKE '%encerrar atendimento%'
  THEN 5
  WHEN EXISTS (
    SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id AND m.direction = 'inbound'
      AND (lower(COALESCE(m.body, '')) LIKE '%quero contratar%'
        OR lower(COALESCE(m.body, '')) LIKE '%vamos fechar%'
        OR lower(COALESCE(m.body, '')) LIKE '%dar entrada%'
        OR lower(COALESCE(m.body, '')) LIKE '%agendar uma consulta%'
        OR lower(COALESCE(m.body, '')) LIKE '%marcar uma consulta%')
  ) THEN 80
  WHEN EXISTS (
    SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id AND m.direction = 'inbound'
      AND (lower(COALESCE(m.body, '')) LIKE '%tenho interesse%'
        OR lower(COALESCE(m.body, '')) LIKE '%preciso de ajuda%'
        OR lower(COALESCE(m.body, '')) LIKE '%meu caso%'
        OR lower(COALESCE(m.body, '')) LIKE '%processo%'
        OR lower(COALESCE(m.body, '')) LIKE '%documento%')
  ) OR (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = conversations.id AND m.direction = 'inbound') >= 3 THEN 50
  ELSE 25
END,
updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE classification_source = 'automatic';

UPDATE conversations
SET classification = CASE WHEN score >= 70 THEN 'hot' WHEN score >= 40 THEN 'warm' ELSE 'cold' END
WHERE classification_source = 'automatic';
