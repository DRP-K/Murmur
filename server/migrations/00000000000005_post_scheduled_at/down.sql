-- SQLite <3.35 cannot DROP COLUMN; recreate table without scheduled_at
CREATE TABLE posts_new (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  expires_at BIGINT,
  category TEXT,
  media_ref_name TEXT,
  image_url TEXT,
  attachment_url TEXT,
  attachment_type TEXT,
  attachments TEXT
);
INSERT INTO posts_new SELECT id, author_id, content, timestamp, expires_at, category, media_ref_name, image_url, attachment_url, attachment_type, attachments FROM posts;
DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;
CREATE INDEX idx_posts_timestamp ON posts(timestamp);
