-- Resonance Archive: PostgreSQL schema
-- Independent fan database. Verify official facts and asset-use permissions before publication.

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  official_name TEXT NOT NULL,
  element TEXT CHECK (element IN ('Aero','Glacio','Electro','Fusion','Havoc','Spectro')),
  weapon_type TEXT CHECK (weapon_type IN ('Sword','Broadblade','Pistols','Gauntlets','Rectifier')),
  rarity SMALLINT CHECK (rarity IN (4,5)),
  debut_version TEXT,
  playable BOOLEAN NOT NULL DEFAULT TRUE,
  verification_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (verification_status IN ('needs_review','partially_verified','verified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Preserve proper names. Translations belong in localized text, not in official_name.
CREATE TABLE IF NOT EXISTS character_localizations (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en','ar')),
  display_name TEXT,
  short_description TEXT,
  full_description TEXT,
  PRIMARY KEY (character_id, locale)
);

CREATE TABLE IF NOT EXISTS character_stats (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  level SMALLINT NOT NULL,
  hp INTEGER,
  atk INTEGER,
  def INTEGER,
  max_energy INTEGER,
  other_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_id BIGINT,
  PRIMARY KEY (character_id, level)
);

CREATE TABLE IF NOT EXISTS skills (
  id BIGSERIAL PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  official_name TEXT NOT NULL,
  skill_type TEXT,
  display_order SMALLINT NOT NULL DEFAULT 0,
  description_en TEXT,
  description_ar TEXT,
  source_id BIGINT
);

CREATE TABLE IF NOT EXISTS materials (
  id BIGSERIAL PRIMARY KEY,
  official_name TEXT NOT NULL,
  category TEXT,
  icon_url TEXT,
  source_id BIGINT
);

CREATE TABLE IF NOT EXISTS character_materials (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'ascension',
  quantity INTEGER,
  PRIMARY KEY (character_id, material_id, purpose)
);

CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  publisher TEXT NOT NULL,
  source_type TEXT NOT NULL,
  checked_at TIMESTAMPTZ,
  notes TEXT,
  is_official BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS media_assets (
  id BIGSERIAL PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('portrait','icon','splash_art','skill_icon','other')),
  asset_url TEXT NOT NULL,
  source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL,
  permission_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (permission_status IN ('unknown','permitted','not_permitted')),
  alt_en TEXT,
  alt_ar TEXT
);

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor','reviewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  character_id TEXT,
  action TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_characters_filters ON characters(element, weapon_type, rarity);
CREATE INDEX IF NOT EXISTS idx_sources_character ON sources(character_id);
CREATE INDEX IF NOT EXISTS idx_skills_character ON skills(character_id);
