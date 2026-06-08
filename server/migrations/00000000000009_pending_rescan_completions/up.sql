CREATE TABLE pending_rescan_completions (
    user_id    TEXT    NOT NULL REFERENCES users(user_id),
    category   TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, category)
);
