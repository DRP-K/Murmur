CREATE TABLE posts_old (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  category TEXT,
  media_ref_name TEXT,
  image_url TEXT,
  attachment_url TEXT,
  attachment_type TEXT,
  attachments TEXT,
  rally_group_id TEXT,
  rally_max_members INTEGER
);

INSERT INTO posts_old (
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
  NULL,
  NULL,
  image_url,
  attachment_url,
  attachment_type,
  attachments,
  rally_group_id,
  rally_max_members
FROM posts;

CREATE TABLE post_deliveries_old AS SELECT * FROM post_deliveries;
DROP TABLE post_deliveries;
DROP TABLE posts;
ALTER TABLE posts_old RENAME TO posts;

CREATE TABLE post_deliveries (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  delivered_at BIGINT,
  PRIMARY KEY (post_id, recipient_id)
);

INSERT INTO post_deliveries (post_id, recipient_id, delivered_at)
SELECT post_id, recipient_id, delivered_at FROM post_deliveries_old;
DROP TABLE post_deliveries_old;

CREATE TABLE user_favourite_categories (
  user_id    TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category   TEXT    NOT NULL,
  created_at BIGINT  NOT NULL,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE post_categories (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (post_id, category)
);

CREATE TABLE pending_rescan_completions (
  user_id    TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category   TEXT    NOT NULL,
  created_at BIGINT  NOT NULL,
  PRIMARY KEY (user_id, category)
);
