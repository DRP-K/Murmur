ALTER TABLE posts ADD COLUMN rally_group_id TEXT;
ALTER TABLE posts ADD COLUMN rally_max_members INTEGER;

CREATE TABLE groups (
  id TEXT PRIMARY KEY NOT NULL,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  max_members INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_group_members_user_id ON group_members(user_id);

CREATE TABLE group_messages (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  payload_hex TEXT NOT NULL,
  sent_at BIGINT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_group_messages_group_sent_at ON group_messages(group_id, sent_at);

CREATE TABLE group_message_deliveries (
  message_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  delivered_at BIGINT,
  PRIMARY KEY (message_id, recipient_id),
  FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_group_message_deliveries_recipient_delivered
  ON group_message_deliveries(recipient_id, delivered_at);
