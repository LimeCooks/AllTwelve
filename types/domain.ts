export type AthleteStatus = 'Active' | 'Limited' | 'Out';
export type AthleteUnit = 'Offence' | 'Defence' | 'Special teams';

export type AthleteRecord = {
  id: string;
  no: number | null;
  name: string;
  initials: string;
  firstName: string;
  lastName: string;
  position: string;
  unit: AthleteUnit;
  year: string;
  status: AthleteStatus;
  height: string;
  weight: string;
  weightLb: number;
  install: number;
  eligibility: string;
  attendance: number;
  email: string;
  phone: string;
  staffNote: string;
};

export type AthleteMetrics = {
  total: number;
  active: number;
  eligible: number;
  limited: number;
  out: number;
  installAverage: number;
};

export type AthletePayload = {
  number: number | null;
  firstName: string;
  lastName: string;
  position: string;
  unit: AthleteUnit;
  graduationYear: number;
  height: string;
  weightLb: number;
  status?: AthleteStatus;
  eligibility?: string;
  attendancePercent?: number;
  installPercent?: number;
  email: string;
  phone?: string;
  staffNote?: string;
};

export type DepthRosterAthlete = Pick<AthleteRecord, 'id' | 'no' | 'name' | 'position' | 'unit' | 'status'>;

export type DepthAssignmentRecord = {
  id: string;
  position: string;
  rank: number;
  x: number;
  y: number;
  athleteId: string;
  athleteName: string;
  athleteInitials: string;
  athleteNo: number | null;
  athleteStatus: AthleteStatus;
};

export type DepthChartRecord = {
  id: string;
  name: string;
  unit: AthleteUnit;
  formation: string;
  publishedAt: string | null;
};

export type DepthChartPayload = {
  chart: DepthChartRecord;
  assignments: DepthAssignmentRecord[];
  athletes: DepthRosterAthlete[];
};

export type CalendarEventType = 'film' | 'install' | 'practice' | 'game' | 'staff' | 'travel' | 'meeting';

export type CalendarEventRecord = {
  id: string;
  title: string;
  eventType: CalendarEventType;
  startsAt: string;
  endsAt: string;
  location: string;
  notes: string;
};
