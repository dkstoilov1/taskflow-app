CREATE TABLE projects
(
    id      UUID         NOT NULL PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    version INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT projects_name_not_blank CHECK (char_length(name) > 0),
    CONSTRAINT projects_version_non_negative CHECK (version >= 0)
);

CREATE UNIQUE INDEX projects_name_lower_unique_idx
    ON projects (lower(name));

ALTER TABLE tasks
    ADD COLUMN due_date DATE,
    ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'medium',
    ADD COLUMN project_id UUID,
    ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'active',
    ADD COLUMN completed_at TIMESTAMPTZ,
    ADD CONSTRAINT tasks_priority_valid CHECK (priority IN ('low', 'medium', 'high')),
    ADD CONSTRAINT tasks_status_valid CHECK (status IN ('active', 'completed')),
    ADD CONSTRAINT tasks_completed_at_consistent CHECK (
        (status = 'active' AND completed_at IS NULL)
        OR (status = 'completed' AND completed_at IS NOT NULL)
    ),
    ADD CONSTRAINT tasks_project_fk FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT;

CREATE INDEX tasks_due_date_status_idx
    ON tasks (status, due_date, created_at DESC, id DESC);

CREATE INDEX tasks_project_status_idx
    ON tasks (project_id, status);

CREATE INDEX tasks_completed_at_idx
    ON tasks (completed_at)
    WHERE status = 'completed';
