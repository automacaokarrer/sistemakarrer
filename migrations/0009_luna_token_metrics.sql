ALTER TABLE luna_runs ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_luna_runs_usage
ON luna_runs(created_at DESC, status, input_tokens, cached_input_tokens, output_tokens);
