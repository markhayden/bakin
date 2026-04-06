-- flow_runs table schema (matches OpenClaw's flows/registry.sqlite)
CREATE TABLE IF NOT EXISTS flow_runs (
  flow_id TEXT PRIMARY KEY,
  shape TEXT,
  sync_mode TEXT NOT NULL DEFAULT 'managed',
  owner_key TEXT NOT NULL,
  requester_origin_json TEXT,
  controller_id TEXT NOT NULL DEFAULT 'bakin/tasks',
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  notify_policy TEXT NOT NULL DEFAULT 'silent',
  goal TEXT,
  current_step TEXT,
  blocked_task_id TEXT,
  blocked_summary TEXT,
  state_json TEXT,
  wait_json TEXT,
  cancel_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_owner ON flow_runs(owner_key);
CREATE INDEX IF NOT EXISTS idx_flow_runs_status ON flow_runs(status);

-- Seed tasks across all kanban columns
-- backlog (status=queued, column=backlog)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at) VALUES
  ('task-bl-001', 'bakin:task:task-bl-001', 'bakin/tasks', 'queued', 'Research competitor pricing models', '{"title":"Research competitor pricing models","agent":"rolo","column":"backlog","createdBy":"main-operator","log":[{"timestamp":"2026-04-01T10:00:00Z","author":"main-operator","message":"Added to backlog for Q2 planning"}]}', 1743505200000, 1743505200000),
  ('task-bl-002', 'bakin:task:task-bl-002', 'bakin/tasks', 'queued', 'Design new landing page hero section', '{"title":"Design new landing page hero section","agent":"pixel","column":"backlog","createdBy":"main-operator"}', 1743508800000, 1743508800000);

-- todo (status=queued, column=todo)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at) VALUES
  ('task-td-001', 'bakin:task:task-td-001', 'bakin/tasks', 'queued', 'Write blog post about spring hiking trails', '{"title":"Write blog post about spring hiking trails","agent":"chef","column":"todo","createdBy":"main-operator","projectId":"proj-content","log":[{"timestamp":"2026-04-03T08:00:00Z","author":"main-operator","message":"Moved to todo — ready for Chef"}]}', 1743591600000, 1743678000000),
  ('task-td-002', 'bakin:task:task-td-002', 'bakin/tasks', 'queued', 'Gather social media analytics for March', '{"title":"Gather social media analytics for March","agent":"explorer","column":"todo","createdBy":"main-operator"}', 1743595200000, 1743595200000),
  ('task-td-003', 'bakin:task:task-td-003', 'bakin/tasks', 'queued', 'Plan content calendar for next week', '{"title":"Plan content calendar for next week","agent":"coach","column":"todo","createdBy":"main-operator"}', 1743598800000, 1743598800000);

-- inProgress (status=running)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at) VALUES
  ('task-ip-001', 'bakin:task:task-ip-001', 'bakin/tasks', 'running', 'Generate Instagram carousel images', '{"title":"Generate Instagram carousel images","agent":"pixel","date":"2026-04-05","createdBy":"main-operator","projectId":"proj-content","log":[{"timestamp":"2026-04-05T09:00:00Z","author":"pixel","message":"Starting image generation — 5 slides for trail series"},{"timestamp":"2026-04-05T09:15:00Z","author":"pixel","message":"3/5 slides complete, adjusting color palette"}]}', 1743678000000, 1743764400000),
  ('task-ip-002', 'bakin:task:task-ip-002', 'bakin/tasks', 'running', 'Draft Discord announcement for new feature', '{"title":"Draft Discord announcement for new feature","agent":"trainer","date":"2026-04-05","createdBy":"main-operator","log":[{"timestamp":"2026-04-05T10:00:00Z","author":"trainer","message":"Drafting announcement copy"}]}', 1743681600000, 1743764400000);

-- review (status=waiting)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, wait_json, created_at, updated_at) VALUES
  ('task-rv-001', 'bakin:task:task-rv-001', 'bakin/tasks', 'waiting', 'Review weekly performance report', '{"title":"Review weekly performance report","agent":"rolo","date":"2026-04-04","createdBy":"main-operator","log":[{"timestamp":"2026-04-04T14:00:00Z","author":"rolo","message":"Report compiled — 12 metrics analyzed, 3 anomalies flagged"}]}', '{"type":"gate_approval","requestedAt":"2026-04-04T14:00:00Z"}', 1743591600000, 1743764400000);

-- blocked (status=waiting, blocked)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, blocked_task_id, blocked_summary, state_json, created_at, updated_at) VALUES
  ('task-bk-001', 'bakin:task:task-bk-001', 'bakin/tasks', 'waiting', 'Publish blog post to website', 'blocked', 'Waiting for blog post draft (task-td-001)', '{"title":"Publish blog post to website","agent":"patch","createdBy":"main-operator","dependsOn":"task-td-001"}', 1743595200000, 1743681600000);

-- done (status=succeeded)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at, ended_at) VALUES
  ('task-dn-001', 'bakin:task:task-dn-001', 'bakin/tasks', 'succeeded', 'Create thumbnail for YouTube video', '{"title":"Create thumbnail for YouTube video","agent":"pixel","date":"2026-04-03","createdBy":"main-operator","log":[{"timestamp":"2026-04-03T11:00:00Z","author":"pixel","message":"Thumbnail generated at 1280x720"},{"timestamp":"2026-04-03T11:30:00Z","author":"main-operator","message":"Approved — looks great"}]}', 1743505200000, 1743678000000, 1743678000000),
  ('task-dn-002', 'bakin:task:task-dn-002', 'bakin/tasks', 'succeeded', 'Update team availability for April', '{"title":"Update team availability for April","agent":"coach","date":"2026-04-02","createdBy":"main-operator"}', 1743418800000, 1743591600000, 1743591600000),
  ('task-dn-003', 'bakin:task:task-dn-003', 'bakin/tasks', 'succeeded', 'Post morning motivation to Discord', '{"title":"Post morning motivation to Discord","agent":"trainer","date":"2026-04-04","createdBy":"main-operator","scheduleJobId":"daily-brief"}', 1743678000000, 1743764400000, 1743764400000);

-- confirmed (status=succeeded, confirmed=true)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at, ended_at) VALUES
  ('task-cf-001', 'bakin:task:task-cf-001', 'bakin/tasks', 'succeeded', 'Set up analytics dashboard', '{"title":"Set up analytics dashboard","agent":"rolo","date":"2026-03-28","confirmed":true,"createdBy":"main-operator","log":[{"timestamp":"2026-03-28T16:00:00Z","author":"rolo","message":"Dashboard live at /analytics"},{"timestamp":"2026-03-29T09:00:00Z","author":"main-operator","message":"Confirmed — data looks accurate"}]}', 1743159600000, 1743332400000, 1743332400000);
