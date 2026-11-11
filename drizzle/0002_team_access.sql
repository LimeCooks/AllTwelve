-- Access grants are deliberately separate from portable football records.
-- Existing owner grants remain authoritative; no member or invite is seeded.
CREATE TABLE team_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('staff','player')),
  athlete_id TEXT REFERENCES athletes(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT,
  accepted_at TEXT,
  revoked_at TEXT,
  CHECK((role='staff' AND athlete_id IS NULL) OR (role='player' AND athlete_id IS NOT NULL)),
  CHECK((accepted_by IS NULL AND accepted_at IS NULL) OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE INDEX idx_team_invitation_team ON team_invitations(team_id,created_at);
CREATE INDEX idx_team_invitation_email ON team_invitations(email,accepted_at,revoked_at);

CREATE TABLE team_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('staff','player')),
  athlete_id TEXT REFERENCES athletes(id) ON DELETE RESTRICT,
  invitation_id TEXT NOT NULL REFERENCES team_invitations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((role='staff' AND athlete_id IS NULL) OR (role='player' AND athlete_id IS NOT NULL)),
  UNIQUE(team_id,user_id)
);
CREATE INDEX idx_team_membership_user ON team_memberships(user_id,status);
CREATE UNIQUE INDEX idx_team_membership_active_athlete ON team_memberships(team_id,athlete_id) WHERE status='active' AND athlete_id IS NOT NULL;
