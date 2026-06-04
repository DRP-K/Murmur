-- SQLite column drops are version-sensitive and cannot drop multiple columns in
-- one statement, so rebuild the table without expires_at and scheduled_at.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE posts_new (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  category TEXT,
  media_ref_name TEXT,
  image_url TEXT,
  attachment_url TEXT,
  attachment_type TEXT,
  attachments TEXT,
  rally_group_id TEXT,
  rally_max_members INTEGER,
  FOREIGN KEY (author_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT INTO posts_new (
  id,
  author_id,
  content,
  timestamp,
  category,
  media_ref_name,
  image_url,
  attachment_url,
  attachment_type,
  attachments,
  rally_group_id,
  rally_max_members
)
SELECT
  id,
  author_id,
  content,
  timestamp,
  category,
  media_ref_name,
  image_url,
  attachment_url,
  attachment_type,
  attachments,
  rally_group_id,
  rally_max_members
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;
CREATE INDEX idx_posts_timestamp ON posts(timestamp);
