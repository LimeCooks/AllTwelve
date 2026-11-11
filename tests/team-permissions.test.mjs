import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
const compile = (source) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
const identity = compile(
  await readFile(
    new URL('../lib/workspace-identity.ts', import.meta.url),
    'utf8',
  ),
);
const {
  hasTeamPermission,
  requireTeamPermission,
  workspaceGrants,
  resolveWorkspaceGrant,
} = await import(
  compile(
    (
      await readFile(
        new URL('../lib/team-permissions.ts', import.meta.url),
        'utf8',
      )
    ).replace("'@/lib/workspace-identity'", JSON.stringify(identity)),
  )
);
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const name of (await readdir(new URL('../drizzle/', import.meta.url)))
  .filter((name) => name.endsWith('.sql'))
  .sort())
  sql.exec(
    await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8'),
  );
const database = {
  prepare(query) {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async all() {
        return { results: sql.prepare(query).all(...args) };
      },
      async first() {
        return sql.prepare(query).get(...args) ?? null;
      },
      async run() {
        return sql.prepare(query).all(...args);
      },
    };
  },
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements)
        results.push({ results: await statement.run() });
      sql.exec('COMMIT');
      return results;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  },
};
const {
  createTeamInvitation,
  pendingTeamInvitations,
  acceptTeamInvitation,
  listTeamAccess,
  revokeTeamAccess,
} = await import(
  compile(
    (
      await readFile(
        new URL('../lib/team-invitations.ts', import.meta.url),
        'utf8',
      )
    ).replace("'@/lib/workspace-identity'", JSON.stringify(identity)),
  )
);
const user = (id) => ({ id, name: id, email: id + '@example.test' });
const member = (id, team, actor, role = 'staff', athlete = null) => {
  sql
    .prepare(
      'INSERT INTO team_invitations(id,team_id,email,role,athlete_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(
      'invite-' + id,
      team,
      actor + '@example.test',
      role,
      athlete,
      'owner',
      '2026-11-08T00:00:00Z',
      '2026-11-15T00:00:00Z',
    );
  sql
    .prepare(
      'INSERT INTO team_memberships(id,team_id,user_id,email,name,role,athlete_id,invitation_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      team,
      actor,
      actor + '@example.test',
      actor,
      role,
      athlete,
      'invite-' + id,
      'active',
      '2026-11-08T00:00:00Z',
      '2026-11-08T00:00:00Z',
    );
};
test('schema migration creates no grants, invites or football data', () => {
  for (const table of [
    'teams',
    'workspace_owners',
    'team_memberships',
    'team_invitations',
    'athletes',
    'plays',
  ])
    assert.equal(sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  sql
    .prepare(
      'INSERT INTO teams(id,name,short_name,season,created_at) VALUES(?,?,?,?,?)',
    )
    .run('team-a', 'Team A', 'A', '2026', '2026-11-08');
  sql
    .prepare(
      'INSERT INTO teams(id,name,short_name,season,created_at) VALUES(?,?,?,?,?)',
    )
    .run('team-b', 'Team B', 'B', '2026', '2026-11-08');
  sql
    .prepare(
      'INSERT INTO workspace_owners(user_id,team_id,created_at) VALUES(?,?,?)',
    )
    .run('owner-a', 'team-a', '2026-11-08');
});
test('staff capabilities exclude owner controls and player acknowledgement; unknown roles fail closed', () => {
  for (const capability of ['team.read', 'coaching.read', 'coaching.write'])
    assert.equal(hasTeamPermission('staff', capability), true);
  for (const capability of [
    'access.manage',
    'settings.write',
    'backup.manage',
    'owner.private',
    'player.own-review.write',
  ])
    assert.equal(hasTeamPermission('staff', capability), false);
  assert.equal(hasTeamPermission('player', 'coaching.read'), false);
  assert.equal(hasTeamPermission('player', 'player.assigned.read'), true);
  assert.equal(hasTeamPermission('player', 'player.own-review.write'), true);
  for (const role of ['admin', 'constructor', '__proto__', null])
    assert.equal(hasTeamPermission(role, 'coaching.write'), false);
  assert.throws(
    () => requireTeamPermission({ role: 'staff' }, 'access.manage'),
    (error) => error.status === 403,
  );
});
test('the real owner grant remains authoritative and a chosen team still requires a real membership', async () => {
  assert.equal(
    (await resolveWorkspaceGrant(database, user('owner-a'))).role,
    'owner',
  );
  assert.equal(await resolveWorkspaceGrant(database, user('stranger')), null);
  await assert.rejects(
    () => resolveWorkspaceGrant(database, user('stranger'), 'team-a'),
    (error) => error.status === 403,
  );
  member('staff-a', 'team-a', 'coach');
  const grant = await resolveWorkspaceGrant(database, user('coach'));
  assert.equal(grant.role, 'staff');
  assert.equal(grant.teamId, 'team-a');
  assert.equal(grant.userId, 'coach');
  await assert.rejects(
    () => resolveWorkspaceGrant(database, user('coach'), 'team-b'),
    (error) => error.status === 403,
  );
  member('staff-b', 'team-b', 'coach');
  await assert.rejects(
    () => resolveWorkspaceGrant(database, user('coach')),
    (error) => error.status === 409,
  );
  assert.equal(
    (await resolveWorkspaceGrant(database, user('coach'), 'team-b')).teamId,
    'team-b',
  );
  member('owner-as-staff', 'team-a', 'owner-a');
  assert.equal(
    (await resolveWorkspaceGrant(database, user('owner-a'), 'team-a')).role,
    'owner',
  );
});
test('revoked membership is rejected immediately, without silently opening another team', async () => {
  sql
    .prepare('UPDATE team_memberships SET status=? WHERE id=?')
    .run('revoked', 'staff-a');
  await assert.rejects(
    () => resolveWorkspaceGrant(database, user('coach'), 'team-a'),
    (error) => error.status === 403,
  );
  assert.deepEqual(
    (await workspaceGrants(database, user('coach'))).map(
      (grant) => grant.teamId,
    ),
    ['team-b'],
  );
});

test('a player binding must resolve to an athlete in the same team, not merely any existing athlete', async () => {
  sql
    .prepare(
      'INSERT INTO athletes(id,team_id,number,first_name,last_name,position,unit,graduation_year,height,weight_lb,status,eligibility,attendance_percent,install_percent,email,phone,staff_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      'athlete-b',
      'team-b',
      55,
      'Test',
      'Player',
      'DB',
      'Defence',
      2026,
      '',
      0,
      'Active',
      'Cleared',
      0,
      0,
      'athlete@example.test',
      null,
      '',
      '2026-11-08',
      '2026-11-08',
    );
  member('wrong-team-player', 'team-a', 'wrong-player', 'player', 'athlete-b');
  await assert.rejects(
    () => resolveWorkspaceGrant(database, user('wrong-player'), 'team-a'),
    (error) => error.status === 403,
  );
  member('same-team-player', 'team-b', 'right-player', 'player', 'athlete-b');
  const grant = await resolveWorkspaceGrant(
    database,
    user('right-player'),
    'team-b',
  );
  assert.equal(grant.athleteId, 'athlete-b');
  assert.equal(grant.role, 'player');
});

test('owner-created email-bound invitations are versioned, retry-safe and accepted only by their recipient', async () => {
  const owner = user('owner-a'),
    grant = await resolveWorkspaceGrant(database, owner, 'team-a');
  const input = {
    id: crypto.randomUUID(),
    email: '  NEW-STAFF@EXAMPLE.TEST ',
    role: 'staff',
  };
  const invite = await createTeamInvitation(database, owner, grant, input);
  assert.equal(invite.email, 'new-staff@example.test');
  assert.equal(invite.status, 'pending');
  assert.deepEqual(
    await createTeamInvitation(database, owner, grant, input),
    invite,
  );
  await assert.rejects(
    () =>
      createTeamInvitation(database, owner, grant, {
        ...input,
        email: 'another@example.test',
      }),
    (error) => error.status === 409,
  );
  assert.deepEqual(
    await pendingTeamInvitations(database, user('other-staff')),
    [],
  );
  const pending = await pendingTeamInvitations(database, user('new-staff'));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].version, invite.version);
  await assert.rejects(
    () =>
      acceptTeamInvitation(
        database,
        user('other-staff'),
        invite.id,
        invite.version,
      ),
    (error) => error.status === 403,
  );
  const staff = await acceptTeamInvitation(
    database,
    user('new-staff'),
    invite.id,
    invite.version,
  );
  assert.equal(staff.role, 'staff');
  assert.equal(staff.user_id, 'new-staff');
  assert.equal(
    (await resolveWorkspaceGrant(database, user('new-staff'))).teamId,
    'team-a',
  );
  assert.deepEqual(
    await acceptTeamInvitation(
      database,
      user('new-staff'),
      invite.id,
      invite.version,
    ),
    staff,
  );
  assert.deepEqual(
    await pendingTeamInvitations(database, user('new-staff')),
    [],
  );
});

test('staff cannot manage access, stale removal cannot remove newer grants, and used invitations cannot undo revocation', async () => {
  const owner = user('owner-a'),
    grant = await resolveWorkspaceGrant(database, owner, 'team-a');
  const staffGrant = await resolveWorkspaceGrant(
    database,
    user('new-staff'),
    'team-a',
  );
  await assert.rejects(
    () => listTeamAccess(database, user('new-staff'), staffGrant),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () =>
      listTeamAccess(database, user('new-staff'), {
        ...staffGrant,
        role: 'owner',
      }),
    (error) => error.status === 403,
  );
  let access = await listTeamAccess(database, owner, grant);
  const member = access.memberships.find((row) => row.user_id === 'new-staff');
  const invite = access.invitations.find(
    (row) => row.id === member.invitation_id,
  );
  await assert.rejects(
    () =>
      revokeTeamAccess(
        database,
        owner,
        grant,
        'membership',
        member.id,
        '0'.repeat(64),
      ),
    (error) => error.status === 409,
  );
  await revokeTeamAccess(
    database,
    owner,
    grant,
    'membership',
    member.id,
    member.version,
  );
  await assert.rejects(
    () => resolveWorkspaceGrant(database, user('new-staff'), 'team-a'),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () =>
      acceptTeamInvitation(
        database,
        user('new-staff'),
        invite.id,
        invite.version,
      ),
    (error) => error.status === 409,
  );
  const replacement = await createTeamInvitation(database, owner, grant, {
    id: crypto.randomUUID(),
    email: 'new-staff@example.test',
    role: 'staff',
  });
  const rejoined = await acceptTeamInvitation(
    database,
    user('new-staff'),
    replacement.id,
    replacement.version,
  );
  assert.equal(rejoined.id, member.id);
  assert.notEqual(rejoined.invitation_id, member.invitation_id);
  await assert.rejects(
    () =>
      revokeTeamAccess(
        database,
        owner,
        grant,
        'membership',
        member.id,
        member.version,
      ),
    (error) => error.status === 409,
  );
  await assert.rejects(
    () =>
      acceptTeamInvitation(
        database,
        user('new-staff'),
        invite.id,
        invite.version,
      ),
    (error) => error.status === 409,
  );
});

test('expired, revoked and late-revoked invitations cannot create a membership', async () => {
  const owner = user('owner-a'),
    grant = await resolveWorkspaceGrant(database, owner, 'team-a');
  for (const state of ['expired', 'revoked', 'late-revoked']) {
    const actor = user('recipient-' + state);
    const invite = await createTeamInvitation(database, owner, grant, {
      id: crypto.randomUUID(),
      email: actor.email,
      role: 'staff',
    });
    const originalBatch = database.batch;
    if (state === 'expired')
      sql
        .prepare('UPDATE team_invitations SET expires_at=? WHERE id=?')
        .run('2000-01-01T00:00:00.000Z', invite.id);
    if (state === 'revoked')
      await revokeTeamAccess(
        database,
        owner,
        grant,
        'invitation',
        invite.id,
        invite.version,
      );
    if (state === 'late-revoked')
      database.batch = async function (statements) {
        sql
          .prepare('UPDATE team_invitations SET revoked_at=? WHERE id=?')
          .run(new Date().toISOString(), invite.id);
        return originalBatch.call(this, statements);
      };
    try {
      await assert.rejects(
        () => acceptTeamInvitation(database, actor, invite.id, invite.version),
        (error) => error.status === 409,
      );
    } finally {
      database.batch = originalBatch;
    }
    assert.equal(
      sql
        .prepare('SELECT COUNT(*) n FROM team_memberships WHERE user_id=?')
        .get(actor.id).n,
      0,
    );
  }
});
