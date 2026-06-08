CREATE TABLE post_categories (
    post_id  TEXT NOT NULL REFERENCES posts(id),
    category TEXT NOT NULL,
    PRIMARY KEY (post_id, category)
);
