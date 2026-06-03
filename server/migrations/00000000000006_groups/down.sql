DROP TABLE group_message_deliveries;
DROP TABLE group_messages;
DROP TABLE group_members;
DROP TABLE groups;

-- SQLite cannot drop columns without rebuilding the table; this down migration
-- leaves rally columns in place for local development rollback compatibility.
