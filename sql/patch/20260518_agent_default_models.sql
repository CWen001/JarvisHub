BEGIN;

UPDATE model_catalog_models
SET kind = 'multimodal'
WHERE kind = 'text';

CREATE TABLE IF NOT EXISTS model_catalog_default_models (
	slot TEXT PRIMARY KEY,
	vendor_key TEXT NOT NULL,
	model_key TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (vendor_key, model_key) REFERENCES model_catalog_models(vendor_key, model_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_catalog_default_models_model
ON model_catalog_default_models(vendor_key, model_key);

COMMIT;
