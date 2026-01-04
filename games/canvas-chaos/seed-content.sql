-- Canvas Chaos Game Content Seed File
-- Total: 340 entries (170 EN + 170 DE)
-- Run this in your Supabase SQL editor to populate the game_content table

-- =============================================================================
-- GAMES TABLE INSERT (Run this first to register Canvas Chaos as a game)
-- =============================================================================

INSERT INTO "public"."games" (
  "id", "name", "display_name", "description", "thumbnail_url", "base_url",
  "is_external", "requires_api_key", "min_players", "max_players",
  "supports_spectators", "settings_schema", "default_settings", "is_active",
  "maintenance_mode", "created_at", "updated_at", "icon", "server_url",
  "is_new", "is_mobile", "category"
) VALUES (
  'canvas-chaos',
  'Canvas Chaos',
  'Canvas Chaos',
  'A creative party game with three modes: Freeze Frame (decorate frozen video frames), Artistic Differences (spot the secret modifier), and Evolution (mutate creatures together)!',
  'https://dwrhhrhtsklskquipcci.supabase.co/storage/v1/object/public/game-thumbnails/canvaschaos.webp',
  'https://canvaschaos.onrender.com',
  true,
  false,
  3,
  12,
  false,
  '{}',
  '{}',
  true,
  false,
  now(),
  now(),
  '🎨',
  null,
  true,
  true,
  'Creative'
);


-- =============================================================================
-- FREEZE FRAME PROMPTS (60 total: 30 EN + 30 DE)
-- =============================================================================

-- English Freeze Frame Prompts (30)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Turn them into a superhero', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add a fancy hat', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Put them in space', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make them a wizard', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add speech bubbles', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'decoration'], '{"type": "freeze_frame_prompt", "category": "decoration"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Turn them into a meme', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Give them a pet', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'companion'], '{"type": "freeze_frame_prompt", "category": "companion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add a dramatic background', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Turn them into a villain', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add sunglasses and make them cool', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Put them underwater', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Give them a crown and a throne', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make them a pirate', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add a cape and mask', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Put them in a jungle', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Turn them into a robot', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add a guitar and make them a rockstar', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'activity'], '{"type": "freeze_frame_prompt", "category": "activity"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Put them on the moon', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make them a chef cooking something', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'activity'], '{"type": "freeze_frame_prompt", "category": "activity"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add wings and a halo', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Put them in medieval times', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Turn them into a vampire', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add a silly mustache', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Put them at a party', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make them a ninja', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add explosions behind them', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Turn them into an alien', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add a sword and shield', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Put them in a haunted house', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make them a time traveler', null, 'en', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now());

-- German Freeze Frame Prompts (30)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Verwandle sie in einen Superhelden', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge einen schicken Hut hinzu', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Setze sie ins Weltall', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Mach sie zu einem Zauberer', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge Sprechblasen hinzu', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'decoration'], '{"type": "freeze_frame_prompt", "category": "decoration"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Verwandle sie in ein Meme', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Gib ihnen ein Haustier', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'companion'], '{"type": "freeze_frame_prompt", "category": "companion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge einen dramatischen Hintergrund hinzu', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Verwandle sie in einen Bösewicht', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge Sonnenbrillen hinzu und mach sie cool', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Setze sie unter Wasser', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Gib ihnen eine Krone und einen Thron', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Mach sie zu einem Piraten', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge einen Umhang und eine Maske hinzu', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Setze sie in einen Dschungel', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Verwandle sie in einen Roboter', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Gib ihnen eine Gitarre und mach sie zum Rockstar', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'activity'], '{"type": "freeze_frame_prompt", "category": "activity"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Setze sie auf den Mond', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Mach sie zu einem Koch beim Kochen', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'activity'], '{"type": "freeze_frame_prompt", "category": "activity"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge Flügel und einen Heiligenschein hinzu', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Setze sie ins Mittelalter', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Verwandle sie in einen Vampir', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge einen lustigen Schnurrbart hinzu', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Setze sie auf eine Party', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Mach sie zu einem Ninja', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge Explosionen hinter ihnen hinzu', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Verwandle sie in einen Alien', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge ein Schwert und einen Schild hinzu', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'accessory'], '{"type": "freeze_frame_prompt", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Setze sie in ein Spukhaus', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'setting'], '{"type": "freeze_frame_prompt", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Mach sie zu einem Zeitreisenden', null, 'de', '1', false, true, ARRAY['freeze_frame', 'prompt', 'transformation'], '{"type": "freeze_frame_prompt", "category": "transformation"}', null, now(), now());

-- =============================================================================
-- ARTISTIC DIFF BASE PROMPTS (100 total: 50 EN + 50 DE)
-- =============================================================================

-- English Artistic Diff Base Prompts (50)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a cat', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a house', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'object'], '{"type": "artistic_diff_base", "category": "objects"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a car', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a tree', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a robot', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a pizza', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a dragon', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a spaceship', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a dog', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a unicorn', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a dinosaur', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a fish', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a bird', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw an elephant', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a phone', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'object'], '{"type": "artistic_diff_base", "category": "objects"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a chair', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'object'], '{"type": "artistic_diff_base", "category": "objects"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a lamp', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'object'], '{"type": "artistic_diff_base", "category": "objects"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a wizard', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a castle', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw an alien', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a ghost', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a monster', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a mountain', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw an ocean', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a forest', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a sun', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a cloud', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a flower', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a burger', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a cake', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw an ice cream', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw sushi', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a taco', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a boat', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw an airplane', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a bicycle', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a train', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a snowman', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'seasonal'], '{"type": "artistic_diff_base", "category": "seasonal"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a pumpkin', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'seasonal'], '{"type": "artistic_diff_base", "category": "seasonal"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a penguin', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a snake', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a butterfly', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a spider', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a banana', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a cupcake', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a pirate', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a ninja', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a mermaid', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Draw a cactus', null, 'en', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now());

-- German Artistic Diff Base Prompts (50)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Katze', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Haus', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'object'], '{"type": "artistic_diff_base", "category": "objects"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Auto', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Baum', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Roboter', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Pizza', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Drachen', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Raumschiff', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Hund', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Einhorn', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Dinosaurier', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Fisch', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Vogel', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Elefanten', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Handy', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'object'], '{"type": "artistic_diff_base", "category": "objects"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Stuhl', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'object'], '{"type": "artistic_diff_base", "category": "objects"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Lampe', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'object'], '{"type": "artistic_diff_base", "category": "objects"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Zauberer', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Schloss', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Alien', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Geist', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Monster', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Berg', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Ozean', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Wald', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Sonne', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Wolke', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Blume', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Burger', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Kuchen', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Eis', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne Sushi', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Taco', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Boot', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Flugzeug', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne ein Fahrrad', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Zug', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'vehicle'], '{"type": "artistic_diff_base", "category": "vehicles"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Schneemann', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'seasonal'], '{"type": "artistic_diff_base", "category": "seasonal"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Kürbis', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'seasonal'], '{"type": "artistic_diff_base", "category": "seasonal"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Pinguin', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Schlange', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Schmetterling', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Spinne', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'animal'], '{"type": "artistic_diff_base", "category": "animals"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Banane', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Cupcake', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'food'], '{"type": "artistic_diff_base", "category": "food"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Piraten', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Ninja', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne eine Meerjungfrau', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'fantasy'], '{"type": "artistic_diff_base", "category": "fantasy"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Zeichne einen Kaktus', null, 'de', '1', false, true, ARRAY['artistic_diff', 'base_prompt', 'nature'], '{"type": "artistic_diff_base", "category": "nature"}', null, now(), now());

-- =============================================================================
-- ARTISTIC DIFF MODIFIERS - EASY (40 total: 20 EN + 20 DE)
-- =============================================================================

-- English Easy Modifiers (20)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s on fire', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s tiny', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'size'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "size"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s giant', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'size'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "size"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s happy', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s sad', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s glowing', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s melting', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s angry', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s sleepy', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s excited', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but there are two of them', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'quantity'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "quantity"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s rainbow colored', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s frozen', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s upside down', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'orientation'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "orientation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s floating', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s wet', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s sparkly', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s broken', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s wearing a hat', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'accessory'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it has eyes', null, 'en', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now());

-- German Easy Modifiers (20)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es brennt', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist winzig', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'size'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "size"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist riesig', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'size'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "size"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist glücklich', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist traurig', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es leuchtet', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es schmilzt', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist wütend', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist müde', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist aufgeregt', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "emotion"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es gibt zwei davon', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'quantity'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "quantity"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist regenbogenfarben', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist gefroren', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist auf dem Kopf', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'orientation'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "orientation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es schwebt', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist nass', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es glitzert', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist kaputt', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es trägt einen Hut', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'accessory'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "accessory"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es hat Augen', null, 'de', '1', false, true, ARRAY['artistic_diff', 'modifier', 'easy', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "easy", "category": "visual"}', null, now(), now());

-- =============================================================================
-- ARTISTIC DIFF MODIFIERS - MEDIUM (40 total: 20 EN + 20 DE)
-- =============================================================================

-- English Medium Modifiers (20)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s evil', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'personality'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "personality"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s in space', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s underwater', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s made of cheese', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'material'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "material"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s a ghost', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'transformation'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s in a blizzard', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s at a party', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s made of LEGO', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'material'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "material"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s made of glass', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'material'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "material"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s a baby version', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'transformation'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s a robot version', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'transformation'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s pixelated', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s invisible (just outline)', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s made of candy', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'material'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "material"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s in the desert', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s ancient/prehistoric', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'time'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "time"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s steampunk', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'style'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "style"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s zombie version', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'transformation'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s running away', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'action'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "action"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s in love', null, 'en', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "emotion"}', null, now(), now());

-- German Medium Modifiers (20)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist böse', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'personality'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "personality"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist im Weltraum', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist unter Wasser', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist aus Käse', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'material'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "material"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist ein Geist', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'transformation'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist in einem Schneesturm', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist auf einer Party', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist aus LEGO', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'material'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "material"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist aus Glas', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'material'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "material"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist eine Baby-Version', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'transformation'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist eine Roboter-Version', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'transformation'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist verpixelt', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist unsichtbar (nur Umriss)', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'visual'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "visual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist aus Süßigkeiten', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'material'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "material"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist in der Wüste', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'setting'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "setting"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist uralt/prähistorisch', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'time'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "time"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist Steampunk', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'style'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "style"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist eine Zombie-Version', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'transformation'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "transformation"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es rennt weg', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'action'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "action"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist verliebt', null, 'de', '2', false, true, ARRAY['artistic_diff', 'modifier', 'medium', 'emotion'], '{"type": "artistic_diff_modifier", "difficulty": "medium", "category": "emotion"}', null, now(), now());

-- =============================================================================
-- ARTISTIC DIFF MODIFIERS - HARD (40 total: 20 EN + 20 DE)
-- =============================================================================

-- English Hard Modifiers (20)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s slightly nervous', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s from the future', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s been awake for 3 days', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s pretending to be normal', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s secretly a spy', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s judging you silently', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s about to sneeze', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s remembering something embarrassing', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s having an existential crisis', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it just told a bad joke', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s trying not to laugh', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it knows something you don''t', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s in a midlife crisis', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s questioning its purpose', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s overconfident', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s passive aggressive', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it just woke up from a nap', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s pretending to work', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s secretly plotting something', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'but it''s going through a phase', null, 'en', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now());

-- German Hard Modifiers (20)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist leicht nervös', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist aus der Zukunft', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist seit 3 Tagen wach', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es tut so als wäre es normal', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist heimlich ein Spion', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es urteilt still über dich', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es muss gleich niesen', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es erinnert sich an etwas Peinliches', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es hat eine Sinnkrise', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es hat gerade einen schlechten Witz erzählt', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es versucht nicht zu lachen', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es weiß etwas was du nicht weißt', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es hat eine Midlife-Crisis', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es hinterfragt seinen Sinn', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist übertrieben selbstsicher', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist passiv-aggressiv', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es ist gerade aus einem Nickerchen aufgewacht', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'subtle'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "subtle"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es tut so als würde es arbeiten', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es schmiedet heimlich Pläne', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'conceptual'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "conceptual"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'aber es macht gerade eine Phase durch', null, 'de', '3', false, true, ARRAY['artistic_diff', 'modifier', 'hard', 'abstract'], '{"type": "artistic_diff_modifier", "difficulty": "hard", "category": "abstract"}', null, now(), now());

-- =============================================================================
-- EVOLUTION PROMPTS (60 total: 30 EN + 30 DE)
-- =============================================================================

-- English Evolution Prompts (30)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something that helps it FLY', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "FLY"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something that helps it SWIM', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "SWIM"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add a DEFENSE mechanism', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'defense'], '{"type": "evolution_mutation", "category": "defense", "keyword": "DEFENSE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make it look EVIL', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "EVIL"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something from a KITCHEN', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "KITCHEN"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add TOO MANY of something', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'quantity'], '{"type": "evolution_mutation", "category": "quantity", "keyword": "TOO MANY"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Give it a piece of CLOTHING', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "CLOTHING"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add a MUSICAL instrument', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "MUSICAL"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something that helps it DIG', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "DIG"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something that helps it CLIMB', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "CLIMB"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something that helps it JUMP', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "JUMP"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add SPIKES for protection', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'defense'], '{"type": "evolution_mutation", "category": "defense", "keyword": "SPIKES"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add ARMOR plating', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'defense'], '{"type": "evolution_mutation", "category": "defense", "keyword": "ARMOR"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make it CAMOUFLAGED', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'defense'], '{"type": "evolution_mutation", "category": "defense", "keyword": "CAMOUFLAGE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make it look CUTE', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "CUTE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make it look TERRIFYING', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "TERRIFYING"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make it look MAJESTIC', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "MAJESTIC"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something from an OFFICE', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "OFFICE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add SPORTS equipment', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "SPORTS"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add TOO MANY EYES', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'quantity'], '{"type": "evolution_mutation", "category": "quantity", "keyword": "EYES"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add TOO MANY LEGS', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'quantity'], '{"type": "evolution_mutation", "category": "quantity", "keyword": "LEGS"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add TOO MANY TEETH', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'quantity'], '{"type": "evolution_mutation", "category": "quantity", "keyword": "TEETH"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Give it a WEAPON', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "WEAPON"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something SHINY', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "SHINY"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Make it BIGGER', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'size'], '{"type": "evolution_mutation", "category": "size", "keyword": "BIGGER"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something FLUFFY', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "FLUFFY"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Give it a TAIL', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appendage'], '{"type": "evolution_mutation", "category": "appendage", "keyword": "TAIL"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add TENTACLES', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appendage'], '{"type": "evolution_mutation", "category": "appendage", "keyword": "TENTACLES"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Give it ANTLERS or HORNS', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appendage'], '{"type": "evolution_mutation", "category": "appendage", "keyword": "HORNS"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Add something that helps it GLOW', null, 'en', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "GLOW"}', null, now(), now());

-- German Evolution Prompts (30)
INSERT INTO game_content (id, game_ids, text_content, media_url, language, difficulty_level, is_premium, is_verified, tags, data, created_by, created_at, updated_at) VALUES
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas hinzu das ihm beim FLIEGEN hilft', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "FLIEGEN"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas hinzu das ihm beim SCHWIMMEN hilft', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "SCHWIMMEN"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge einen VERTEIDIGUNGSMECHANISMUS hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'defense'], '{"type": "evolution_mutation", "category": "defense", "keyword": "VERTEIDIGUNG"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Lass es BÖSE aussehen', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "BÖSE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas aus einer KÜCHE hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "KÜCHE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge ZU VIEL von etwas hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'quantity'], '{"type": "evolution_mutation", "category": "quantity", "keyword": "ZU VIEL"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Gib ihm ein KLEIDUNGSSTÜCK', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "KLEIDUNG"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge ein MUSIKINSTRUMENT hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "MUSIK"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas hinzu das ihm beim GRABEN hilft', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "GRABEN"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas hinzu das ihm beim KLETTERN hilft', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "KLETTERN"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas hinzu das ihm beim SPRINGEN hilft', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "SPRINGEN"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge STACHELN zum Schutz hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'defense'], '{"type": "evolution_mutation", "category": "defense", "keyword": "STACHELN"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge PANZERUNG hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'defense'], '{"type": "evolution_mutation", "category": "defense", "keyword": "PANZER"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Mach es GETARNT', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'defense'], '{"type": "evolution_mutation", "category": "defense", "keyword": "TARNUNG"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Lass es NIEDLICH aussehen', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "NIEDLICH"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Lass es FURCHTERREGEND aussehen', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "FURCHT"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Lass es MAJESTÄTISCH aussehen', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "MAJESTÄTISCH"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas aus einem BÜRO hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "BÜRO"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge SPORTAUSRÜSTUNG hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "SPORT"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge ZU VIELE AUGEN hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'quantity'], '{"type": "evolution_mutation", "category": "quantity", "keyword": "AUGEN"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge ZU VIELE BEINE hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'quantity'], '{"type": "evolution_mutation", "category": "quantity", "keyword": "BEINE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge ZU VIELE ZÄHNE hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'quantity'], '{"type": "evolution_mutation", "category": "quantity", "keyword": "ZÄHNE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Gib ihm eine WAFFE', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'object'], '{"type": "evolution_mutation", "category": "objects", "keyword": "WAFFE"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas GLÄNZENDES hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "GLÄNZEND"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Mach es GRÖSSER', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'size'], '{"type": "evolution_mutation", "category": "size", "keyword": "GRÖSSER"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas FLAUSCHIGES hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appearance'], '{"type": "evolution_mutation", "category": "appearance", "keyword": "FLAUSCHIG"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Gib ihm einen SCHWANZ', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appendage'], '{"type": "evolution_mutation", "category": "appendage", "keyword": "SCHWANZ"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge TENTAKEL hinzu', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appendage'], '{"type": "evolution_mutation", "category": "appendage", "keyword": "TENTAKEL"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Gib ihm ein GEWEIH oder HÖRNER', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'appendage'], '{"type": "evolution_mutation", "category": "appendage", "keyword": "HÖRNER"}', null, now(), now()),
(gen_random_uuid(), ARRAY['canvas-chaos'], 'Füge etwas hinzu das es LEUCHTEN lässt', null, 'de', '1', false, true, ARRAY['evolution', 'mutation_prompt', 'ability'], '{"type": "evolution_mutation", "category": "abilities", "keyword": "LEUCHTEN"}', null, now(), now());

-- =============================================================================
-- VERIFICATION QUERY (run after insert to verify counts)
-- =============================================================================

-- SELECT
--   CASE
--     WHEN 'freeze_frame' = ANY(tags) AND 'prompt' = ANY(tags) THEN 'freeze_frame'
--     WHEN 'artistic_diff' = ANY(tags) AND 'base_prompt' = ANY(tags) THEN 'artistic_diff_base'
--     WHEN 'artistic_diff' = ANY(tags) AND 'modifier' = ANY(tags) THEN 'artistic_diff_modifier_' || data->>'difficulty'
--     WHEN 'evolution' = ANY(tags) AND 'mutation_prompt' = ANY(tags) THEN 'evolution'
--   END as content_type,
--   language,
--   COUNT(*) as count
-- FROM game_content
-- WHERE 'canvas-chaos' = ANY(game_ids)
-- GROUP BY content_type, language
-- ORDER BY content_type, language;
