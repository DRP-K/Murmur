CREATE TABLE users (
  user_id TEXT PRIMARY KEY NOT NULL,
  pubkey_hex TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE pending_messages (
  id TEXT PRIMARY KEY NOT NULL,
  recipient_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  payload_hex TEXT NOT NULL,
  nonce_hex TEXT NOT NULL,
  msg_type TEXT NOT NULL,
  sent_at BIGINT NOT NULL,
  FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_pending_messages_recipient_sent_at
  ON pending_messages(recipient_id, sent_at);

CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  expires_at BIGINT,
  FOREIGN KEY (author_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_posts_timestamp ON posts(timestamp);

CREATE TABLE post_deliveries (
  post_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  delivered_at BIGINT,
  PRIMARY KEY (post_id, recipient_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_post_deliveries_recipient_delivered
  ON post_deliveries(recipient_id, delivered_at);

CREATE TABLE friendships (
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_a, user_b),
  FOREIGN KEY (user_a) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_b) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_friendships_user_a ON friendships(user_a);
