BEGIN;

INSERT INTO model_catalog_vendors (
	key,
	name,
	enabled,
	base_url_hint,
	auth_type,
	auth_header,
	auth_query_param,
	meta,
	created_at,
	updated_at
)
VALUES
	('apimart', 'APIMart', 1, 'https://api.apimart.ai', 'bearer', NULL, NULL, NULL, '2026-05-06T00:00:00.000Z', '2026-05-06T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

INSERT INTO model_catalog_models (
	model_key,
	vendor_key,
	model_alias,
	label_zh,
	kind,
	enabled,
	meta,
	created_at,
	updated_at
)
VALUES
	('video-model-2.0', 'apimart', 'video2', 'Video 2.0', 'video', 1, '{"videoOptions":{"defaultDurationSeconds":5,"defaultSize":"16:9","defaultResolution":"480p","durationOptions":[{"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},{"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},{"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},{"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}],"sizeOptions":[{"value":"16:9","label":"16:9 横屏","orientation":"landscape","aspectRatio":"16:9"},{"value":"9:16","label":"9:16 竖屏","orientation":"portrait","aspectRatio":"9:16"},{"value":"1:1","label":"1:1 方形","orientation":"landscape","aspectRatio":"1:1"},{"value":"4:3","label":"4:3 传统","orientation":"landscape","aspectRatio":"4:3"},{"value":"3:4","label":"3:4 竖向传统","orientation":"portrait","aspectRatio":"3:4"},{"value":"21:9","label":"21:9 超宽屏","orientation":"landscape","aspectRatio":"21:9"},{"value":"adaptive","label":"自适应","orientation":"landscape","aspectRatio":"16:9"}],"resolutionOptions":[{"value":"480p","label":"480p 标清"},{"value":"720p","label":"720p 高清"},{"value":"1080p","label":"1080p 全高清"}],"controls":[{"key":"duration","binding":"durationSeconds","label":"时长"},{"key":"size","binding":"size","label":"画幅"},{"key":"resolution","binding":"resolution","label":"分辨率"},{"key":"generate_audio","binding":"generateAudio","label":"声音"},{"key":"return_last_frame","binding":"returnLastFrame","label":"尾帧"}]},"useCases":["image_to_video","text_to_video","video2","audio_video"]}', '2026-05-06T00:00:00.000Z', '2026-05-06T00:00:00.000Z')
ON CONFLICT (vendor_key, model_key) DO NOTHING;

INSERT INTO model_credit_costs (
	model_key,
	cost,
	enabled,
	created_at,
	updated_at
)
VALUES
	('video-model-2.0', 10, 1, '2026-05-06T00:00:00.000Z', '2026-05-06T00:00:00.000Z')
ON CONFLICT (model_key) DO NOTHING;

COMMIT;
