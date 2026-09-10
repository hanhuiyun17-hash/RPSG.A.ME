CREATE TABLE IF NOT EXISTS mailbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  claimed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  funds REAL NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  raid_progress REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  contribution REAL NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(guild_id,user_id)
);

CREATE TABLE IF NOT EXISTS coop_raids (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  partner_id TEXT,
  guild_id TEXT,
  mode TEXT NOT NULL,
  enemy_hp REAL NOT NULL,
  max_hp REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mailbox_user ON mailbox(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members(guild_id);
CREATE INDEX IF NOT EXISTS idx_coop_members ON coop_raids(host_id,partner_id,status);
