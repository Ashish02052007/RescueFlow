import 'dotenv/config';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type UserRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: string;
  updatedAt: string;
};

type AmbulanceRecord = {
  id: string;
  vehicleNumber: string;
  driverName: string;
  status: string;
  latitude: number;
  longitude: number;
};

type HospitalRecord = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  emergencyBeds: number;
  icuBeds: number;
  emergencyTeamStatus: string;
  availabilityStatus: string;
};

type SignalRecord = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: string;
  missionId: string | null;
};

type MissionRecord = {
  id: string;
  missionCode: string;
  emergencyType: string;
  priority: string;
  status: string;
  ambulanceId: string;
  hospitalId: string;
  currentLatitude: number;
  currentLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  estimatedArrivalTime: string;
  distanceRemaining: number;
  createdAt: string;
  updatedAt: string;
  routeScore: number | null;
  routeName: string | null;
  progress: number;
  signalStatus: string | null;
  lastSignalIndex: number | null;
};

type NotificationRecord = {
  id: string;
  userId: string;
  missionId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
};

type ActivityRecord = {
  id: string;
  missionId: string;
  event: string;
  description: string;
  createdAt: string;
};

export type EventRecord = {
  id: string;
  eventCode: string;
  title: string;
  description: string;
  notes: string;
  eventType: string;
  severity: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  reporterId: string;
  reporterRole: string;
  missionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EventActivityRecord = {
  id: string;
  eventId: string;
  actorId: string;
  actorRole: string;
  action: string;
  description: string;
  createdAt: string;
};

const databasePath = resolve(process.cwd(), process.env.DATABASE_PATH ?? 'data/rescueflow.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ambulances (
    id TEXT PRIMARY KEY,
    vehicleNumber TEXT NOT NULL UNIQUE,
    driverName TEXT NOT NULL,
    status TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hospitals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    emergencyBeds INTEGER NOT NULL,
    icuBeds INTEGER NOT NULL,
    emergencyTeamStatus TEXT NOT NULL,
    availabilityStatus TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS traffic_signals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    status TEXT NOT NULL,
    missionId TEXT
  );
  CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY,
    missionCode TEXT NOT NULL UNIQUE,
    emergencyType TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    ambulanceId TEXT NOT NULL,
    hospitalId TEXT NOT NULL,
    currentLatitude REAL NOT NULL,
    currentLongitude REAL NOT NULL,
    destinationLatitude REAL NOT NULL,
    destinationLongitude REAL NOT NULL,
    estimatedArrivalTime TEXT NOT NULL,
    distanceRemaining REAL NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    routeScore REAL,
    routeName TEXT,
    progress REAL NOT NULL,
    signalStatus TEXT,
    lastSignalIndex INTEGER
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    missionId TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    missionId TEXT NOT NULL,
    event TEXT NOT NULL,
    description TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    eventCode TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    eventType TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    address TEXT NOT NULL DEFAULT '',
    reporterId TEXT NOT NULL REFERENCES users(id),
    reporterRole TEXT NOT NULL,
    missionId TEXT REFERENCES missions(id),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS event_activity_logs (
    id TEXT PRIMARY KEY,
    eventId TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    actorId TEXT NOT NULL REFERENCES users(id),
    actorRole TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS missions_created_at_idx ON missions(createdAt);
  CREATE INDEX IF NOT EXISTS missions_updated_at_idx ON missions(updatedAt);
  CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(userId, createdAt);
  CREATE INDEX IF NOT EXISTS activity_logs_mission_created_idx ON activity_logs(missionId, createdAt);
  CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(createdAt);
  CREATE INDEX IF NOT EXISTS events_reporter_created_idx ON events(reporterId, createdAt);
  CREATE INDEX IF NOT EXISTS event_activity_event_created_idx ON event_activity_logs(eventId, createdAt);
`);

function readRows<T>(table: string): T[] {
  return database.prepare(`SELECT * FROM ${table}`).all() as T[];
}

export function loadUsers() {
  return readRows<UserRecord>('users');
}

export function loadAmbulances() {
  return readRows<AmbulanceRecord>('ambulances');
}

export function loadHospitals() {
  return readRows<HospitalRecord>('hospitals');
}

export function loadTrafficSignals() {
  return readRows<SignalRecord>('traffic_signals');
}

export function loadMissions() {
  return database.prepare('SELECT * FROM missions ORDER BY createdAt DESC, missionCode DESC').all() as MissionRecord[];
}

export function loadNotifications() {
  return (database.prepare('SELECT * FROM notifications ORDER BY createdAt DESC').all() as NotificationRecord[])
    .map((record) => ({ ...record, read: Boolean(record.read) }));
}

export function loadActivityLogs() {
  return database.prepare('SELECT * FROM activity_logs ORDER BY createdAt DESC').all() as ActivityRecord[];
}

export function loadEvents() {
  return database.prepare('SELECT * FROM events ORDER BY createdAt DESC, eventCode DESC').all() as EventRecord[];
}

export function loadEventActivityLogs(eventId: string) {
  return database.prepare('SELECT * FROM event_activity_logs WHERE eventId = ? ORDER BY createdAt ASC').all(eventId) as EventActivityRecord[];
}

export function createEventWithActivity(event: Omit<EventRecord, 'eventCode'>, activity: EventActivityRecord) {
  const create = database.transaction(() => {
    const year = new Date(event.createdAt).getUTCFullYear();
    const prefix = `RF-EVENT-${year}-`;
    const count = database.prepare('SELECT COUNT(*) AS count FROM events WHERE eventCode LIKE ?').get(`${prefix}%`) as { count: number };
    const eventCode = `${prefix}${String(count.count + 1).padStart(3, '0')}`;
    const record = { ...event, eventCode };

    database.prepare(`
      INSERT INTO events (
        id, eventCode, title, description, notes, eventType, severity, status, latitude, longitude, address,
        reporterId, reporterRole, missionId, createdAt, updatedAt
      ) VALUES (
        @id, @eventCode, @title, @description, @notes, @eventType, @severity, @status, @latitude, @longitude,
        @address, @reporterId, @reporterRole, @missionId, @createdAt, @updatedAt
      )
    `).run(record);
    database.prepare(`
      INSERT INTO event_activity_logs (id, eventId, actorId, actorRole, action, description, createdAt)
      VALUES (@id, @eventId, @actorId, @actorRole, @action, @description, @createdAt)
    `).run(activity);
    return record;
  });

  return create();
}

export function updateEventRecord(event: EventRecord) {
  database.prepare(`
    UPDATE events SET
      title = @title, description = @description, notes = @notes, eventType = @eventType, severity = @severity,
      status = @status, latitude = @latitude, longitude = @longitude, address = @address,
      reporterRole = @reporterRole, missionId = @missionId, updatedAt = @updatedAt
    WHERE id = @id
  `).run(event);
}

export function saveEventActivityLog(activity: EventActivityRecord) {
  database.prepare(`
    INSERT INTO event_activity_logs (id, eventId, actorId, actorRole, action, description, createdAt)
    VALUES (@id, @eventId, @actorId, @actorRole, @action, @description, @createdAt)
  `).run(activity);
}

export function saveUser(user: UserRecord) {
  database.prepare(`
    INSERT INTO users (id, name, email, passwordHash, role, createdAt, updatedAt)
    VALUES (@id, @name, @email, @passwordHash, @role, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email, passwordHash=excluded.passwordHash,
      role=excluded.role, updatedAt=excluded.updatedAt
  `).run(user);
}

export function saveAmbulance(ambulance: AmbulanceRecord) {
  database.prepare(`
    INSERT INTO ambulances (id, vehicleNumber, driverName, status, latitude, longitude)
    VALUES (@id, @vehicleNumber, @driverName, @status, @latitude, @longitude)
    ON CONFLICT(id) DO UPDATE SET vehicleNumber=excluded.vehicleNumber, driverName=excluded.driverName,
      status=excluded.status, latitude=excluded.latitude, longitude=excluded.longitude
  `).run(ambulance);
}

export function saveHospital(hospital: HospitalRecord) {
  database.prepare(`
    INSERT INTO hospitals (id, name, address, latitude, longitude, emergencyBeds, icuBeds, emergencyTeamStatus, availabilityStatus)
    VALUES (@id, @name, @address, @latitude, @longitude, @emergencyBeds, @icuBeds, @emergencyTeamStatus, @availabilityStatus)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, address=excluded.address, latitude=excluded.latitude,
      longitude=excluded.longitude, emergencyBeds=excluded.emergencyBeds, icuBeds=excluded.icuBeds,
      emergencyTeamStatus=excluded.emergencyTeamStatus, availabilityStatus=excluded.availabilityStatus
  `).run(hospital);
}

export function saveTrafficSignal(signal: SignalRecord) {
  database.prepare(`
    INSERT INTO traffic_signals (id, name, latitude, longitude, status, missionId)
    VALUES (@id, @name, @latitude, @longitude, @status, @missionId)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, latitude=excluded.latitude, longitude=excluded.longitude,
      status=excluded.status, missionId=excluded.missionId
  `).run(signal);
}

export function saveMission(mission: MissionRecord) {
  database.prepare(`
    INSERT INTO missions (
      id, missionCode, emergencyType, priority, status, ambulanceId, hospitalId,
      currentLatitude, currentLongitude, destinationLatitude, destinationLongitude, estimatedArrivalTime,
      distanceRemaining, createdAt, updatedAt, routeScore, routeName, progress, signalStatus, lastSignalIndex
    ) VALUES (
      @id, @missionCode, @emergencyType, @priority, @status, @ambulanceId, @hospitalId,
      @currentLatitude, @currentLongitude, @destinationLatitude, @destinationLongitude, @estimatedArrivalTime,
      @distanceRemaining, @createdAt, @updatedAt, @routeScore, @routeName, @progress, @signalStatus, @lastSignalIndex
    )
    ON CONFLICT(id) DO UPDATE SET missionCode=excluded.missionCode, emergencyType=excluded.emergencyType,
      priority=excluded.priority, status=excluded.status, ambulanceId=excluded.ambulanceId, hospitalId=excluded.hospitalId,
      currentLatitude=excluded.currentLatitude, currentLongitude=excluded.currentLongitude,
      destinationLatitude=excluded.destinationLatitude, destinationLongitude=excluded.destinationLongitude,
      estimatedArrivalTime=excluded.estimatedArrivalTime, distanceRemaining=excluded.distanceRemaining,
      updatedAt=excluded.updatedAt, routeScore=excluded.routeScore, routeName=excluded.routeName,
      progress=excluded.progress, signalStatus=excluded.signalStatus, lastSignalIndex=excluded.lastSignalIndex
  `).run(mission);
}

export function saveNotification(notification: NotificationRecord) {
  database.prepare(`
    INSERT INTO notifications (id, userId, missionId, title, message, type, read, createdAt)
    VALUES (@id, @userId, @missionId, @title, @message, @type, @read, @createdAt)
    ON CONFLICT(id) DO UPDATE SET userId=excluded.userId, missionId=excluded.missionId, title=excluded.title,
      message=excluded.message, type=excluded.type, read=excluded.read
  `).run({ ...notification, read: Number(notification.read) });
}

export function saveActivityLog(activity: ActivityRecord) {
  database.prepare(`
    INSERT INTO activity_logs (id, missionId, event, description, createdAt)
    VALUES (@id, @missionId, @event, @description, @createdAt)
    ON CONFLICT(id) DO UPDATE SET missionId=excluded.missionId, event=excluded.event,
      description=excluded.description, createdAt=excluded.createdAt
  `).run(activity);
}
