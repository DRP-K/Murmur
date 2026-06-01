-- SQLite does not support DROP COLUMN before 3.35.0; recreate the table without attachment columns.
CREATE TABLE posts_new (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  expires_at BIGINT,
  category TEXT,
  media_ref_name TEXT,
  image_url TEXT,
  FOREIGN KEY (author_id) REFERENCES users(user_id) ON DELETE CASCADE
);
INSERT INTO posts_new SELECT id, author_id, content, timestamp, expires_at, category, media_ref_name, image_url FROM posts;
DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;
CREATE INDEX idx_posts_timestamp ON posts(timestamp);
