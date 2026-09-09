PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL UNIQUE,
  friend_code TEXT NOT NULL UNIQUE, balance REAL NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY, requester_id TEXT NOT NULL, addressee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
  UNIQUE(requester_id, addressee_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL,
  body TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER
);
CREATE TABLE IF NOT EXISTS inventory (
  user_id TEXT NOT NULL, item_key TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,item_key)
);
CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, owner_id TEXT NOT NULL,
  title TEXT NOT NULL, pixels TEXT NOT NULL, width INTEGER NOT NULL DEFAULT 32,
  height INTEGER NOT NULL DEFAULT 32, created_at INTEGER NOT NULL, trade_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, buyer_id TEXT, kind TEXT NOT NULL,
  asset_key TEXT NOT NULL, title TEXT NOT NULL, payload TEXT, price REAL NOT NULL,
  tax REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL, sold_at INTEGER
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, gross REAL NOT NULL, tax REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rankings (
  user_id TEXT PRIMARY KEY, assets REAL NOT NULL DEFAULT 0, hamlet INTEGER NOT NULL DEFAULT 0,
  territory INTEGER NOT NULL DEFAULT 0, collection INTEGER NOT NULL DEFAULT 0,
  rare_items INTEGER NOT NULL DEFAULT 0, achievements INTEGER NOT NULL DEFAULT 0,
  rebirth INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id,receiver_id,created_at);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status,created_at);
CREATE INDEX IF NOT EXISTS idx_sales_seller_time ON sales(seller_id,created_at);
