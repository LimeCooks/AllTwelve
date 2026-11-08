import { getDatabase, type TeamDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';

class AthleteInputError extends Error {}
function failure(error: unknown) {
  const status =
    error instanceof WorkspaceAccessError
      ? error.status
      : error instanceof AthleteInputError || error instanceof SyntaxError
        ? 400
        : error instanceof Error && error.message.includes('UNIQUE')
          ? 409
          : 500;
  return Response.json(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : status === 500
            ? 'Unable to access the roster. Please retry.'
            : status === 409
              ? 'That jersey number or email is already in use.'
              : error instanceof Error
                ? error.message
                : 'Unable to save the athlete.',
    },
    { status },
  );
}
function percentage(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    throw new AthleteInputError('Use a percentage between 0 and 100.');
  return value;
}
import type {
  AthleteMetrics,
  AthletePayload,
  AthleteRecord,
  AthleteStatus,
  AthleteUnit,
} from '@/types/domain';

type AthleteRow = {
  id: string;
  number: number | null;
  first_name: string;
  last_name: string;
  position: string;
  unit: AthleteUnit;
  graduation_year: number;
  height: string;
  weight_lb: number;
  status: AthleteStatus;
  eligibility: string;
  attendance_percent: number;
  install_percent: number;
  email: string;
  phone: string | null;
  staff_note: string;
};

const athleteSelect = `SELECT id, number, first_name, last_name, position, unit,
  graduation_year, height, weight_lb, status, eligibility, attendance_percent,
  install_percent, email, phone, staff_note
  FROM athletes`;

function present(row: AthleteRow): AthleteRecord {
  return {
    id: row.id,
    no: row.number,
    name: `${row.first_name} ${row.last_name}`,
    initials:
      `${row.first_name[0] ?? ''}${row.last_name[0] ?? ''}`.toUpperCase(),
    firstName: row.first_name,
    lastName: row.last_name,
    position: row.position,
    unit: row.unit,
    year: String(row.graduation_year),
    status: row.status,
    height: row.height,
    weight: `${row.weight_lb} lb`,
    weightLb: row.weight_lb,
    install: row.install_percent,
    eligibility: row.eligibility,
    attendance: row.attendance_percent,
    email: row.email,
    phone: row.phone ?? '',
    staffNote: row.staff_note,
  };
}

function isUnit(value: unknown): value is AthleteUnit {
  return (
    value === 'Offence' || value === 'Defence' || value === 'Special teams'
  );
}

function isStatus(value: unknown): value is AthleteStatus {
  return value === 'Active' || value === 'Limited' || value === 'Out';
}

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function parsePayload(input: unknown): AthletePayload {
  if (!input || typeof input !== 'object')
    throw new AthleteInputError('Athlete details are required.');
  const body = input as Record<string, unknown>;
  const rawNumber = body.number;
  const number =
    rawNumber === '' || rawNumber === null || rawNumber === undefined
      ? null
      : Number(rawNumber);
  const graduationYear =
    body.graduationYear === '' || body.graduationYear === undefined
      ? 12
      : Number(body.graduationYear);
  const weightLb =
    body.weightLb === '' || body.weightLb === undefined
      ? 0
      : Number(body.weightLb);
  const firstName = asText(body.firstName).trim();
  const lastName = asText(body.lastName).trim();
  const position = asText(body.position, 'ATH').trim().toUpperCase() || 'ATH';
  const height = asText(body.height, '—').trim() || '—';
  const email = asText(body.email).trim().toLowerCase();
  const unit =
    body.unit === undefined || body.unit === '' ? 'Offence' : body.unit;
  if (
    number !== null &&
    (!Number.isInteger(number) || number < 0 || number > 99)
  )
    throw new AthleteInputError('Use a jersey number from 0 to 99.');
  if (!firstName || !lastName)
    throw new AthleteInputError('First and last name are required.');
  if (
    firstName.length > 80 ||
    lastName.length > 80 ||
    email.length > 254 ||
    height.length > 40 ||
    asText(body.phone).length > 80 ||
    asText(body.staffNote).length > 10000
  )
    throw new AthleteInputError('Use shorter athlete details or notes.');
  if (body.status !== undefined && !isStatus(body.status))
    throw new AthleteInputError('Choose a valid availability status.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AthleteInputError('A valid email address is required.');
  if (!position || position.length > 8)
    throw new AthleteInputError('Enter a valid position.');
  if (!isUnit(unit)) throw new AthleteInputError('Choose a valid unit.');
  if (
    !Number.isInteger(graduationYear) ||
    graduationYear < 9 ||
    graduationYear > 13
  )
    throw new AthleteInputError('Grade must be between 9 and 13.');
  if (!Number.isInteger(weightLb) || weightLb < 0 || weightLb > 450)
    throw new AthleteInputError('Enter a valid weight.');
  return {
    number,
    firstName,
    lastName,
    position,
    unit,
    graduationYear,
    height,
    weightLb,
    status: isStatus(body.status) ? body.status : 'Active',
    eligibility: asText(body.eligibility, 'Cleared'),
    attendancePercent: percentage(body.attendancePercent, 100),
    installPercent: percentage(body.installPercent, 0),
    email,
    phone: asText(body.phone),
    staffNote: asText(body.staffNote),
  };
}

async function metrics(database: TeamDatabase): Promise<AthleteMetrics> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN eligibility = 'Cleared' THEN 1 ELSE 0 END) AS eligible,
      SUM(CASE WHEN status = 'Limited' THEN 1 ELSE 0 END) AS limited,
      SUM(CASE WHEN status = 'Out' THEN 1 ELSE 0 END) AS out,
      ROUND(AVG(install_percent)) AS install_average
     FROM athletes WHERE team_id = ?`,
    )
    .bind(database.teamId)
    .first<Record<string, number>>();
  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    eligible: row?.eligible ?? 0,
    limited: row?.limited ?? 0,
    out: row?.out ?? 0,
    installAverage: row?.install_average ?? 0,
  };
}

export async function GET() {
  try {
    const database = await getDatabase();
    const result = await database
      .prepare(
        `${athleteSelect} WHERE team_id = ? ORDER BY number IS NULL, number, last_name, first_name, id`,
      )
      .bind(database.teamId)
      .all<AthleteRow>();
    return Response.json({
      athletes: result.results.map(present),
      metrics: await metrics(database),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const database = await getDatabase();
    const payload = parsePayload(await request.json());
    const existingEmail = await database
      .prepare('SELECT id FROM athletes WHERE team_id = ? AND lower(email) = ?')
      .bind(database.teamId, payload.email.toLowerCase())
      .first();
    if (existingEmail)
      return Response.json(
        { error: 'An athlete with that email already exists.' },
        { status: 409 },
      );
    if (payload.number !== null) {
      const existingNumber = await database
        .prepare('SELECT id FROM athletes WHERE team_id = ? AND number = ?')
        .bind(database.teamId, payload.number)
        .first();
      if (existingNumber)
        return Response.json(
          { error: 'That jersey number is already in use.' },
          { status: 409 },
        );
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO athletes (
        id, team_id, number, first_name, last_name, position, unit, graduation_year,
        height, weight_lb, status, eligibility, attendance_percent, install_percent,
        email, phone, staff_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        database.teamId,
        payload.number,
        payload.firstName,
        payload.lastName,
        payload.position,
        payload.unit,
        payload.graduationYear,
        payload.height,
        payload.weightLb,
        payload.status,
        payload.eligibility,
        payload.attendancePercent,
        payload.installPercent,
        payload.email,
        payload.phone,
        payload.staffNote,
        now,
        now,
      )
      .run();
    const row = await database
      .prepare(`${athleteSelect} WHERE id = ? AND team_id = ?`)
      .bind(id, database.teamId)
      .first<AthleteRow>();
    return Response.json(
      { athlete: row ? present(row) : null, metrics: await metrics(database) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const database = await getDatabase();
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new AthleteInputError('Athlete details are required.');
    const id = asText(body.id);
    if (!id) throw new AthleteInputError('Athlete id is required.');
    const existing = await database
      .prepare('SELECT id FROM athletes WHERE id = ? AND team_id = ?')
      .bind(id, database.teamId)
      .first();
    if (!existing)
      return Response.json({ error: 'Athlete not found.' }, { status: 404 });
    const updates: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      updates.push(`${column} = ?`);
      values.push(value);
    };
    if (body.status !== undefined) {
      if (!isStatus(body.status))
        throw new AthleteInputError('Choose a valid availability status.');
      assign('status', body.status);
    }
    if (body.staffNote !== undefined) {
      if (typeof body.staffNote !== 'string' || body.staffNote.length > 10000)
        throw new AthleteInputError('Use a note of up to 10,000 characters.');
      if (
        typeof body.expectedStaffNote !== 'string' ||
        body.expectedStaffNote.length > 10000
      )
        throw new AthleteInputError(
          'Reload the saved athlete note before changing it.',
        );
      assign('staff_note', body.staffNote);
    }
    if (body.installPercent !== undefined)
      assign('install_percent', percentage(body.installPercent, 0));
    if (body.attendancePercent !== undefined)
      assign('attendance_percent', percentage(body.attendancePercent, 100));
    if (updates.length === 0)
      throw new AthleteInputError('No supported changes were supplied.');
    assign('updated_at', new Date().toISOString());
    const saved = await database
      .prepare(
        `UPDATE athletes SET ${updates.join(', ')} WHERE id = ? AND team_id = ?${body.staffNote !== undefined ? ' AND staff_note IS ?' : ''} RETURNING id`,
      )
      .bind(
        ...values,
        id,
        database.teamId,
        ...(body.staffNote !== undefined ? [body.expectedStaffNote] : []),
      )
      .first();
    if (!saved)
      throw new WorkspaceAccessError(
        'This athlete’s saved note changed or the athlete was removed. Your draft is still open. Reload the saved note before retrying.',
        409,
      );
    const row = await database
      .prepare(`${athleteSelect} WHERE id = ? AND team_id = ?`)
      .bind(id, database.teamId)
      .first<AthleteRow>();
    if (!row)
      return Response.json({ error: 'Athlete not found.' }, { status: 404 });
    return Response.json({
      athlete: present(row),
      metrics: await metrics(database),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const database = await getDatabase();
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new AthleteInputError('Athlete details are required.');
    const id = asText(body.id);
    const existing = await database
      .prepare(`${athleteSelect} WHERE id = ? AND team_id = ?`)
      .bind(id, database.teamId)
      .first<AthleteRow>();
    if (!existing)
      return Response.json({ error: 'Athlete not found.' }, { status: 404 });
    // Profile edits must not overwrite a note, availability or progress saved
    // elsewhere while the profile form was open.
    const payload = parsePayload({
      ...body,
      status: existing.status,
      staffNote: '',
      attendancePercent: existing.attendance_percent,
      installPercent: existing.install_percent,
    });
    const duplicateEmail = await database
      .prepare(
        'SELECT id FROM athletes WHERE team_id = ? AND lower(email) = ? AND id != ?',
      )
      .bind(database.teamId, payload.email, id)
      .first();
    if (duplicateEmail)
      return Response.json(
        { error: 'An athlete with that email already exists.' },
        { status: 409 },
      );
    if (payload.number !== null) {
      const duplicateNumber = await database
        .prepare(
          'SELECT id FROM athletes WHERE team_id = ? AND number = ? AND id != ?',
        )
        .bind(database.teamId, payload.number, id)
        .first();
      if (duplicateNumber)
        return Response.json(
          { error: 'That jersey number is already in use.' },
          { status: 409 },
        );
    }
    await database
      .prepare(
        `UPDATE athletes SET number = ?, first_name = ?, last_name = ?, position = ?, unit = ?, graduation_year = ?, height = ?, weight_lb = ?, email = ?, phone = ?, updated_at = ? WHERE id = ? AND team_id = ?`,
      )
      .bind(
        payload.number,
        payload.firstName,
        payload.lastName,
        payload.position,
        payload.unit,
        payload.graduationYear,
        payload.height,
        payload.weightLb,
        payload.email,
        payload.phone,
        new Date().toISOString(),
        id,
        database.teamId,
      )
      .run();
    const row = await database
      .prepare(`${athleteSelect} WHERE id = ? AND team_id = ?`)
      .bind(id, database.teamId)
      .first<AthleteRow>();
    if (!row)
      return Response.json({ error: 'Athlete not found.' }, { status: 404 });
    return Response.json({
      athlete: present(row),
      metrics: await metrics(database),
    });
  } catch (error) {
    return failure(error);
  }
}
