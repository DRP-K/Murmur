CREATE TABLE posts_new (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  attachment_url TEXT,
  attachment_type TEXT,
  attachments TEXT,
  rally_group_id TEXT,
  rally_max_members INTEGER
);

INSERT INTO posts_new (
  id,
  author_id,
  content,
  timestamp,
  tags,
  image_url,
  attachment_url,
  attachment_type,
  attachments,
  rally_group_id,
  rally_max_members
)
SELECT
  p.id,
  p.author_id,
  p.content,
  p.timestamp,
  COALESCE(
    (
      SELECT '[' || group_concat('"' || tag || '"') || ']'
      FROM (
        SELECT DISTINCT tag
        FROM (
          SELECT CASE p.category
            WHEN 'games' THEN '#game'
            WHEN 'movies' THEN '#movie'
            WHEN 'music' THEN '#music'
            ELSE lower('#' || replace(trim(p.category), ' ', '-'))
          END AS tag
          WHERE p.category IS NOT NULL AND trim(p.category) <> ''
          UNION
          SELECT lower('#' || replace(trim(p.media_ref_name), ' ', '-')) AS tag
          WHERE p.media_ref_name IS NOT NULL AND trim(p.media_ref_name) <> ''
          UNION
          SELECT CASE pc.category
            WHEN 'games' THEN '#game'
            WHEN 'movies' THEN '#movie'
            WHEN 'music' THEN '#music'
            ELSE lower('#' || replace(trim(pc.category), ' ', '-'))
          END AS tag
          FROM post_categories pc
          WHERE pc.post_id = p.id AND trim(pc.category) <> ''
        )
        WHERE tag IS NOT NULL AND tag <> '#'
      )
    ),
    '[]'
  ) AS tags,
  p.image_url,
  p.attachment_url,
  p.attachment_type,
  p.attachments,
  p.rally_group_id,
  p.rally_max_members
FROM posts p;

CREATE TABLE post_deliveries_old AS SELECT * FROM post_deliveries;
DROP TABLE post_deliveries;
DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE TABLE post_deliveries (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  delivered_at BIGINT,
  PRIMARY KEY (post_id, recipient_id)
);

INSERT INTO post_deliveries (post_id, recipient_id, delivered_at)
SELECT post_id, recipient_id, delivered_at FROM post_deliveries_old;
DROP TABLE post_deliveries_old;

DROP TABLE IF EXISTS post_categories;
DROP TABLE IF EXISTS user_favourite_categories;
DROP TABLE IF EXISTS pending_rescan_completions;
