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

-- Seed tasks across all kanban columns (order values are zero-indexed per column)
-- backlog (status=queued, column=backlog)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at) VALUES
  ('task-bl-001', 'bakin:task:task-bl-001', 'bakin/tasks', 'queued', 'Research competitor pricing models', '{"title":"Research competitor pricing models","agent":"rolo","column":"backlog","createdBy":"roscoe","order":0,"log":[{"timestamp":"2026-04-01T10:00:00Z","author":"roscoe","message":"Added to backlog for Q2 planning"}]}', 1743505200000, 1743505200000),
  ('task-bl-002', 'bakin:task:task-bl-002', 'bakin/tasks', 'queued', 'Design new landing page hero section', '{"title":"Design new landing page hero section","agent":"pixel","column":"backlog","createdBy":"roscoe","order":1}', 1743508800000, 1743508800000);

-- todo (status=queued, column=todo)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at) VALUES
  ('task-td-001', 'bakin:task:task-td-001', 'bakin/tasks', 'queued', 'Write blog post about spring hiking trails', '{"title":"Write blog post about spring hiking trails","agent":"basil","column":"todo","createdBy":"roscoe","projectId":"proj-content","order":0,"log":[{"timestamp":"2026-04-03T08:00:00Z","author":"roscoe","message":"Moved to todo — ready for Basil"}]}', 1743591600000, 1743678000000),
  ('task-td-002', 'bakin:task:task-td-002', 'bakin/tasks', 'queued', 'Gather social media analytics for March', '{"title":"Gather social media analytics for March","agent":"scout","column":"todo","createdBy":"roscoe","order":1}', 1743595200000, 1743595200000),
  ('task-td-003', 'bakin:task:task-td-003', 'bakin/tasks', 'queued', 'Plan content calendar for next week', '{"title":"Plan content calendar for next week","agent":"zen","column":"todo","createdBy":"roscoe","order":2}', 1743598800000, 1743598800000),
  ('task-td-004', 'bakin:task:task-td-004', 'bakin/tasks', 'queued', 'Resize product photos for email template', '{"title":"Resize product photos for email template","agent":"pixel","column":"todo","createdBy":"roscoe","order":3,"log":[{"timestamp":"2026-04-05T06:00:00Z","author":"pixel","message":"Starting batch resize — 8 product images at 600x400"},{"timestamp":"2026-04-05T06:12:00Z","author":"pixel","message":"4/8 images resized, applying sharpening filter"},{"timestamp":"2026-04-05T08:45:00Z","author":"watchdog","message":"Auto-recovered: no agent heartbeat or task log for 153+ minutes. Moved back to Todo for re-dispatch."}]}', 1743678000000, 1743764400000);

-- inProgress (status=running)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at) VALUES
  ('task-ip-001', 'bakin:task:task-ip-001', 'bakin/tasks', 'running', 'Generate Instagram carousel images', '{"title":"Generate Instagram carousel images","agent":"pixel","date":"2026-04-05","createdBy":"roscoe","projectId":"proj-content","order":0,"log":[{"timestamp":"2026-04-05T09:00:00Z","author":"pixel","message":"Starting image generation — 5 slides for trail series"},{"timestamp":"2026-04-05T09:15:00Z","author":"pixel","message":"3/5 slides complete, adjusting color palette"}]}', 1743678000000, 1743764400000),
  ('task-ip-002', 'bakin:task:task-ip-002', 'bakin/tasks', 'running', 'Draft Discord announcement for new feature', '{"title":"Draft Discord announcement for new feature","agent":"nemo","date":"2026-04-05","createdBy":"roscoe","order":1,"log":[{"timestamp":"2026-04-05T10:00:00Z","author":"nemo","message":"Drafting announcement copy"}]}', 1743681600000, 1743764400000),
  ('task-ip-003', 'bakin:task:task-ip-003', 'bakin/tasks', 'running', 'Compile weekly engagement metrics report', '{"title":"Compile weekly engagement metrics report","agent":"rolo","date":"2026-04-06","createdBy":"roscoe","order":2,"log":[{"timestamp":"2026-04-05T14:00:00Z","author":"rolo","message":"Pulling data from analytics API — 7 day window"},{"timestamp":"2026-04-05T17:22:00Z","author":"watchdog","message":"Auto-recovered: no agent heartbeat or task log for 202+ minutes. Moved back to Todo for re-dispatch."},{"timestamp":"2026-04-06T08:00:00Z","author":"rolo","message":"Re-dispatched. Resuming data pull — API connection restored"},{"timestamp":"2026-04-06T08:15:00Z","author":"rolo","message":"Engagement data aggregated, building charts"}]}', 1743678000000, 1743850800000);

-- review (status=waiting)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, wait_json, created_at, updated_at) VALUES
  ('task-rv-001', 'bakin:task:task-rv-001', 'bakin/tasks', 'waiting', 'Review weekly performance report', '{"title":"Review weekly performance report","agent":"rolo","date":"2026-04-04","createdBy":"roscoe","order":0,"log":[{"timestamp":"2026-04-04T14:00:00Z","author":"rolo","message":"Report compiled — 12 metrics analyzed, 3 anomalies flagged"}]}', '{"type":"gate_approval","requestedAt":"2026-04-04T14:00:00Z"}', 1743591600000, 1743764400000),
  ('task-rv-002', 'bakin:task:task-rv-002', 'bakin/tasks', 'waiting', 'Approve sunrise trail conditions copy', '{"title":"Approve sunrise trail conditions copy","agent":"basil","description":"Copy recommendation ready for owner review before posting.","date":"2026-04-06","createdBy":"roscoe","workflowId":"approval-copy","order":1,"log":[{"timestamp":"2026-04-06T15:19:00Z","author":"workflow","message":"Gate reached — waiting on owner approval for the draft copy"}]}', '{"type":"gate_approval","requestedAt":"2026-04-06T15:18:00Z"}', 1743951600000, 1743952680000),
  ('task-rv-003', 'bakin:task:task-rv-003', 'bakin/tasks', 'waiting', 'Approve trail status image direction', '{"title":"Approve trail status image direction","agent":"pixel","description":"Concept art and rationale are ready for review before final production.","date":"2026-04-06","createdBy":"roscoe","workflowId":"approval-image","order":2,"log":[{"timestamp":"2026-04-06T16:30:00Z","author":"workflow","message":"Gate reached — image concept recommendation is ready for review"}]}', '{"type":"gate_approval","requestedAt":"2026-04-06T16:29:00Z"}', 1743955500000, 1743956940000),
  ('task-rv-004', 'bakin:task:task-rv-004', 'bakin/tasks', 'waiting', 'Approve launch recommendation bundle', '{"title":"Approve launch recommendation bundle","agent":"scout","description":"Bundle includes sequencing, channel recommendation, and risk notes.","date":"2026-04-07","createdBy":"roscoe","workflowId":"approval-bundle","order":3,"log":[{"timestamp":"2026-04-07T09:42:00Z","author":"workflow","message":"Gate reached — launch recommendation bundle is waiting for approval"}]}', '{"type":"gate_approval","requestedAt":"2026-04-07T09:41:00Z"}', 1744017000000, 1744018920000);

-- blocked (status=waiting, blocked)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, blocked_task_id, blocked_summary, state_json, created_at, updated_at) VALUES
  ('task-bk-001', 'bakin:task:task-bk-001', 'bakin/tasks', 'waiting', 'Publish blog post to website', 'blocked', 'Waiting for blog post draft (task-td-001)', '{"title":"Publish blog post to website","agent":"patch","createdBy":"roscoe","dependsOn":"task-td-001","order":0}', 1743595200000, 1743681600000);

-- done (status=succeeded)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at, ended_at) VALUES
  ('task-dn-001', 'bakin:task:task-dn-001', 'bakin/tasks', 'succeeded', 'Create thumbnail for YouTube video', '{"title":"Create thumbnail for YouTube video","agent":"pixel","date":"2026-04-03","createdBy":"roscoe","order":0,"log":[{"timestamp":"2026-04-03T11:00:00Z","author":"pixel","message":"Thumbnail generated at 1280x720"},{"timestamp":"2026-04-03T11:30:00Z","author":"roscoe","message":"Approved — looks great"}]}', 1743505200000, 1743678000000, 1743678000000),
  ('task-dn-002', 'bakin:task:task-dn-002', 'bakin/tasks', 'succeeded', 'Update team availability for April', '{"title":"Update team availability for April","agent":"zen","date":"2026-04-02","createdBy":"roscoe","order":1}', 1743418800000, 1743591600000, 1743591600000),
  ('task-dn-003', 'bakin:task:task-dn-003', 'bakin/tasks', 'succeeded', 'Post morning motivation to Discord', '{"title":"Post morning motivation to Discord","agent":"nemo","date":"2026-04-04","createdBy":"roscoe","scheduleJobId":"daily-brief","order":2}', 1743678000000, 1743764400000, 1743764400000);

-- archived (status=succeeded, archived=true)
INSERT OR IGNORE INTO flow_runs (flow_id, owner_key, controller_id, status, goal, state_json, created_at, updated_at, ended_at) VALUES
  ('task-cf-001', 'bakin:task:task-cf-001', 'bakin/tasks', 'succeeded', 'Set up analytics dashboard', '{"title":"Set up analytics dashboard","agent":"rolo","date":"2026-03-28","archived":true,"createdBy":"roscoe","order":0,"log":[{"timestamp":"2026-03-28T16:00:00Z","author":"rolo","message":"Dashboard live at /analytics"},{"timestamp":"2026-03-29T09:00:00Z","author":"roscoe","message":"Confirmed — data looks accurate"}]}', 1743159600000, 1743332400000, 1743332400000);
