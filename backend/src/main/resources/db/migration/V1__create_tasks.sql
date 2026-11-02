CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE tasks
(
    id          UUID         NOT NULL PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    description VARCHAR(10000) NOT NULL DEFAULT '',
    version     INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tasks_title_not_blank CHECK (char_length(title) > 0),
    CONSTRAINT tasks_version_non_negative CHECK (version >= 0)
);

CREATE INDEX tasks_created_at_id_idx
    ON tasks (created_at DESC, id DESC);

CREATE INDEX tasks_title_trgm_idx
    ON tasks USING GIN (title gin_trgm_ops);

CREATE INDEX tasks_description_trgm_idx
    ON tasks USING GIN (description gin_trgm_ops);
