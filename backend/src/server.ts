import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  database,
  createEventWithActivity,
  loadActivityLogs,
  loadAmbulances,
  loadEventActivityLogs,
  loadEvents,
  loadHospitals,
  loadMissions,
  loadNotifications,
  loadTrafficSignals,
  loadUsers,
  saveActivityLog,
  saveAmbulance,
  saveEventActivityLog,
  saveHospital,
  saveMission,
  saveNotification,
  saveTrafficSignal,
  saveUser,
  updateEventRecord,
  type EventActivityRecord,
  type EventRecord,
} from './database';

dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  throw new Error('Set a JWT_SECRET of at least 32 characters in production.');
}
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL ?? (IS_PRODUCTION ? false : CLIENT_URL),
    methods: ['GET', 'POST', 'PATCH'],
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string') return next(new Error('Authentication required'));

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = users.find((entry) => entry.id === decoded.userId);
    if (!user) return next(new Error('User not found'));
    socket.data.userId = user.id;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

app.use(cors({ origin: process.env.CLIENT_URL ?? (IS_PRODUCTION ? false : CLIENT_URL) }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const missionStatuses = [
  'PENDING',
  'ACTIVE',
  'ROUTE_ANALYSIS',
  'HOSPITAL_NOTIFIED',
  'HOSPITAL_READY',
  'CORRIDOR_PREPARING',
  'CORRIDOR_ACTIVE',
  'ARRIVED',
  'COMPLETED',
  'CANCELLED',
] as const;

type Role = 'ADMIN' | 'EMERGENCY_VEHICLE' | 'HOSPITAL' | 'TRAFFIC_CONTROLLER' | 'PUBLIC_USER';
type MissionStatus = (typeof missionStatuses)[number];
type SignalStatus = 'NORMAL' | 'PREPARING' | 'EMERGENCY_PRIORITY' | 'AMBULANCE_PASSED';
type EventStatus = 'UNVERIFIED' | 'REPORTED' | 'VERIFIED' | 'RESPONDERS_ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED' | 'FALSE_REPORT';

const eventTypes = ['MEDICAL_EMERGENCY', 'ROAD_ACCIDENT', 'FIRE_EMERGENCY', 'PUBLIC_SAFETY', 'TRAFFIC_EMERGENCY', 'NATURAL_DISASTER', 'OTHER_EMERGENCY'] as const;
const eventSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const eventStatuses: EventStatus[] = ['UNVERIFIED', 'REPORTED', 'VERIFIED', 'RESPONDERS_ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED', 'FALSE_REPORT'];

interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

interface Ambulance {
  id: string;
  vehicleNumber: string;
  driverName: string;
  status: string;
  latitude: number;
  longitude: number;
}

interface Hospital {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  emergencyBeds: number;
  icuBeds: number;
  emergencyTeamStatus: string;
  availabilityStatus: string;
}

interface TrafficSignal {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: SignalStatus;
  missionId: string | null;
}

interface Mission {
  id: string;
  missionCode: string;
  emergencyType: string;
  priority: string;
  status: MissionStatus;
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
  routeScore?: number;
  routeName?: string;
  progress: number;
  signalStatus?: SignalStatus;
  lastSignalIndex?: number;
}

interface NotificationRecord {
  id: string;
  userId: string;
  missionId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
}

interface ActivityLog {
  id: string;
  missionId: string;
  event: string;
  description: string;
  createdAt: string;
}

const baseRouteTemplates = [
  { id: 'route-a', routeName: 'Route A', distance: 5.0, estimatedTime: 15, trafficDensity: 90 },
  { id: 'route-b', routeName: 'Route B', distance: 6.0, estimatedTime: 9, trafficDensity: 45 },
  { id: 'route-c', routeName: 'Route C', distance: 5.5, estimatedTime: 12, trafficDensity: 68 },
];

const ambulances: Ambulance[] = [
  { id: 'amb-101', vehicleNumber: 'AMB-101', driverName: 'Aarav Kumar', status: 'READY', latitude: 12.9716, longitude: 77.5946 },
  { id: 'amb-102', vehicleNumber: 'AMB-102', driverName: 'Sneha Verma', status: 'READY', latitude: 12.9691, longitude: 77.5962 },
  { id: 'amb-103', vehicleNumber: 'AMB-103', driverName: 'Rohan Sethi', status: 'READY', latitude: 12.9732, longitude: 77.5892 },
];

const hospitals: Hospital[] = [
  { id: 'hosp-1', name: 'City General Hospital', address: 'MG Road', latitude: 12.9759, longitude: 77.6211, emergencyBeds: 12, icuBeds: 6, emergencyTeamStatus: 'READY', availabilityStatus: 'AVAILABLE' },
  { id: 'hosp-2', name: 'Sunrise Multi-Specialty', address: 'Indiranagar', latitude: 12.9792, longitude: 77.6408, emergencyBeds: 10, icuBeds: 5, emergencyTeamStatus: 'READY', availabilityStatus: 'AVAILABLE' },
  { id: 'hosp-3', name: 'Lakeview Emergency Center', address: 'Koramangala', latitude: 12.9352, longitude: 77.6245, emergencyBeds: 8, icuBeds: 4, emergencyTeamStatus: 'STANDBY', availabilityStatus: 'BUSY' },
];

const trafficSignals: TrafficSignal[] = [
  { id: 'signal-1', name: 'Signal 01', latitude: 12.9738, longitude: 77.6006, status: 'NORMAL', missionId: null },
  { id: 'signal-2', name: 'Signal 02', latitude: 12.9751, longitude: 77.6074, status: 'NORMAL', missionId: null },
  { id: 'signal-3', name: 'Signal 03', latitude: 12.9766, longitude: 77.6151, status: 'NORMAL', missionId: null },
  { id: 'signal-4', name: 'Signal 04', latitude: 12.9781, longitude: 77.6188, status: 'NORMAL', missionId: null },
  { id: 'signal-5', name: 'Signal 05', latitude: 12.9795, longitude: 77.6214, status: 'NORMAL', missionId: null },
  { id: 'signal-6', name: 'Signal 06', latitude: 12.9810, longitude: 77.6297, status: 'NORMAL', missionId: null },
];

let users: User[] = [];
let missions: Mission[] = [];
let notifications: NotificationRecord[] = [];
let activityLogs: ActivityLog[] = [];
let events: EventRecord[] = [];
const missionTimers = new Map<string, NodeJS.Timeout>();
const eventReportAttempts = new Map<string, number[]>();

const routeLibrary = {
  'route-a': [
    { latitude: 12.9716, longitude: 77.5946 },
    { latitude: 12.9726, longitude: 77.5988 },
    { latitude: 12.9738, longitude: 77.6006 },
    { latitude: 12.9751, longitude: 77.6074 },
    { latitude: 12.9766, longitude: 77.6151 },
    { latitude: 12.9781, longitude: 77.6188 },
    { latitude: 12.9795, longitude: 77.6214 },
    { latitude: 12.9759, longitude: 77.6211 },
  ],
  'route-b': [
    { latitude: 12.9716, longitude: 77.5946 },
    { latitude: 12.9729, longitude: 77.6009 },
    { latitude: 12.9744, longitude: 77.6068 },
    { latitude: 12.9761, longitude: 77.6113 },
    { latitude: 12.9781, longitude: 77.6188 },
    { latitude: 12.9802, longitude: 77.6229 },
    { latitude: 12.9759, longitude: 77.6211 },
  ],
  'route-c': [
    { latitude: 12.9716, longitude: 77.5946 },
    { latitude: 12.9732, longitude: 77.6019 },
    { latitude: 12.9746, longitude: 77.6087 },
    { latitude: 12.9753, longitude: 77.6133 },
    { latitude: 12.9762, longitude: 77.6172 },
    { latitude: 12.9759, longitude: 77.6211 },
  ],
} as const;

function buildRouteScores() {
  return baseRouteTemplates.map((route) => {
    const score = route.distance + route.trafficDensity / 18 + route.estimatedTime * 0.8;
    return { ...route, score };
  });
}

function createJwt(user: User) {
  return jwt.sign({ userId: user.id, name: user.name, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
}

function ensureAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: Role; email: string };
    const user = users.find((entry) => entry.id === decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    req.user = user as User;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function authorize(...allowedRoles: Role[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = req.user as User | undefined;
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
  };
}

function toIsoDate(timestamp: Date) {
  return timestamp.toISOString();
}

function addActivity(missionId: string, event: string, description: string) {
  const entry: ActivityLog = {
    id: randomUUID(),
    missionId,
    event,
    description,
    createdAt: toIsoDate(new Date()),
  };
  activityLogs.unshift(entry);
  saveActivityLog(entry);
}

function pushNotification(userId: string, missionId: string, title: string, message: string, type: string) {
  const record: NotificationRecord = {
    id: randomUUID(),
    userId,
    missionId,
    title,
    message,
    type,
    read: false,
    createdAt: toIsoDate(new Date()),
  };
  notifications.unshift(record);
  saveNotification(record);
}

function addEventActivity(event: EventRecord, actor: User, action: string, description: string) {
  const entry: EventActivityRecord = {
    id: randomUUID(),
    eventId: event.id,
    actorId: actor.id,
    actorRole: actor.role,
    action,
    description,
    createdAt: toIsoDate(new Date()),
  };
  saveEventActivityLog(entry);
  return entry;
}

function eventForRole(event: EventRecord, role: Role) {
  const { reporterId: _reporterId, ...safeEvent } = event;
  if (role !== 'PUBLIC_USER') return safeEvent;
  return {
    ...safeEvent,
    title: 'Emergency incident reported',
    description: '',
    notes: '',
    address: '',
    reporterRole: 'PUBLIC_USER',
  };
}

function eventNotificationMessage(event: EventRecord, role: Role) {
  if (role === 'PUBLIC_USER') return { title: 'Emergency alert', message: 'An emergency incident has been reported. Please cooperate with responders and avoid the affected area.' };
  if (role === 'HOSPITAL') return { title: 'Incoming emergency event', message: 'An incident has been reported. Prepare for a possible incoming patient.' };
  if (role === 'TRAFFIC_CONTROLLER') return { title: 'Traffic coordination required', message: 'An incident has been reported. Review the event and prepare for possible coordination.' };
  if (role === 'EMERGENCY_VEHICLE') return { title: 'New emergency reported', message: 'An incident has been reported. Stand by for an assignment.' };
  return { title: 'New event reported', message: `${event.severity} ${event.eventType.replaceAll('_', ' ').toLowerCase()} requires review.` };
}

function notifyEventUsers(event: EventRecord) {
  for (const recipient of users) {
    const message = eventNotificationMessage(event, recipient.role);
    const notification = {
      id: randomUUID(),
      userId: recipient.id,
      missionId: event.id,
      title: message.title,
      message: message.message,
      type: 'event',
      read: false,
      createdAt: toIsoDate(new Date()),
    };
    notifications.unshift(notification);
    saveNotification(notification);
    io.to(`user:${recipient.id}`).emit('notification:new', notification);
    io.to(`user:${recipient.id}`).emit('event:reported', eventForRole(event, recipient.role));
  }

  const roleActivity: Array<[Role, string, string]> = [
    ['ADMIN', 'admin_notified', 'Admin operators were notified.'],
    ['HOSPITAL', 'hospitals_notified', 'Hospital teams were notified.'],
    ['TRAFFIC_CONTROLLER', 'traffic_notified', 'Traffic controllers were notified.'],
    ['EMERGENCY_VEHICLE', 'responders_notified', 'Emergency vehicle teams were notified.'],
  ];
  for (const [role, action, description] of roleActivity) {
    const actor = users.find((user) => user.role === role);
    if (actor) addEventActivity(event, actor, action, description);
  }
}

function rateLimitEventReports(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = req.user as User;
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1000;
  const attempts = (eventReportAttempts.get(user.id) ?? []).filter((attempt) => attempt > windowStart);
  const limit = user.role === 'PUBLIC_USER' ? 3 : 10;

  if (attempts.length >= limit) {
    res.setHeader('Retry-After', String(Math.ceil((attempts[0] + 15 * 60 * 1000 - now) / 1000)));
    return res.status(429).json({ message: 'Too many event reports. Please try again later.' });
  }

  attempts.push(now);
  eventReportAttempts.set(user.id, attempts);
  return next();
}

const eventStatusTransitions: Record<EventStatus, EventStatus[]> = {
  UNVERIFIED: ['VERIFIED', 'FALSE_REPORT', 'CANCELLED'],
  REPORTED: ['VERIFIED', 'FALSE_REPORT', 'CANCELLED'],
  VERIFIED: ['RESPONDERS_ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  RESPONDERS_ASSIGNED: ['IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
  IN_PROGRESS: ['RESOLVED', 'CANCELLED'],
  RESOLVED: [],
  CANCELLED: [],
  FALSE_REPORT: [],
};

function getEventById(id: string) {
  return events.find((event) => event.id === id || event.eventCode === id);
}

function updateEventStatus(event: EventRecord, status: EventStatus, actor: User, description: string) {
  event.status = status;
  event.updatedAt = toIsoDate(new Date());
  updateEventRecord(event);
  addEventActivity(event, actor, `status_${status.toLowerCase()}`, description);

  for (const recipient of users) {
    io.to(`user:${recipient.id}`).emit('event:updated', eventForRole(event, recipient.role));
    io.to(`user:${recipient.id}`).emit('event:status:changed', eventForRole(event, recipient.role));
    const message = recipient.role === 'PUBLIC_USER'
      ? { title: 'Emergency alert updated', message: 'The status of a nearby emergency incident has changed.' }
      : { title: `Event ${status.replaceAll('_', ' ').toLowerCase()}`, message: `${event.eventCode} is now ${status.replaceAll('_', ' ').toLowerCase()}.` };
    const notification = {
      id: randomUUID(),
      userId: recipient.id,
      missionId: event.id,
      title: message.title,
      message: message.message,
      type: 'event',
      read: false,
      createdAt: event.updatedAt,
    };
    notifications.unshift(notification);
    saveNotification(notification);
    io.to(`user:${recipient.id}`).emit('notification:new', notification);
  }
  if (status === 'RESOLVED') {
    for (const recipient of users) io.to(`user:${recipient.id}`).emit('event:resolved', eventForRole(event, recipient.role));
  }
}

function syncLinkedEventStatus(mission: Mission, status: 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED', actor?: User) {
  const event = events.find((entry) => entry.missionId === mission.id);
  if (!event || !eventStatusTransitions[event.status as EventStatus]?.includes(status)) return;
  const responsibleUser = actor ?? users.find((user) => user.role === 'ADMIN');
  if (!responsibleUser) return;
  updateEventStatus(event, status, responsibleUser, `Linked mission ${mission.missionCode} moved the event to ${status.replaceAll('_', ' ').toLowerCase()}.`);
}

function persistMission(mission: Mission) {
  saveMission({
    ...mission,
    routeScore: mission.routeScore ?? null,
    routeName: mission.routeName ?? null,
    signalStatus: mission.signalStatus ?? null,
    lastSignalIndex: mission.lastSignalIndex ?? null,
  });
}

function getMissionById(missionId: string) {
  return missions.find((mission) => mission.id === missionId);
}

function getParamId(req: express.Request) {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

function updateSignalState(mission: Mission) {
  trafficSignals.forEach((signal, index) => {
    const distanceToMission = Math.abs(signal.latitude - mission.currentLatitude) + Math.abs(signal.longitude - mission.currentLongitude);
    let status: SignalStatus = 'NORMAL';
    let missionId: string | null = null;
    if (mission.status === 'COMPLETED') {
      status = 'NORMAL';
    } else if (distanceToMission < 0.002) {
      status = 'EMERGENCY_PRIORITY';
      missionId = mission.id;
      mission.lastSignalIndex = index;
    } else if (distanceToMission < 0.008) {
      status = 'PREPARING';
      missionId = mission.id;
    }

    if (signal.status !== status || signal.missionId !== missionId) {
      signal.status = status;
      signal.missionId = missionId;
      saveTrafficSignal(signal);
      io.emit('traffic:signal:update', signal);
    }
  });
}

function startMissionTimer(missionId: string) {
  if (missionTimers.has(missionId)) {
    clearInterval(missionTimers.get(missionId)!);
  }

  const timer = setInterval(() => {
    const mission = getMissionById(missionId);
    if (!mission) {
      clearInterval(timer);
      return;
    }

    if (mission.status === 'CANCELLED' || mission.status === 'COMPLETED') {
      clearInterval(timer);
      return;
    }

    const routeKey = mission.routeName?.toLowerCase().replace(/\s+/g, '-') ?? 'route-b';
    const route = routeLibrary[routeKey as keyof typeof routeLibrary] ?? routeLibrary['route-b'];

    if (mission.progress < 1) {
      mission.progress = Math.min(1, mission.progress + 0.12);
      const stepIndex = Math.min(route.length - 1, Math.floor(mission.progress * (route.length - 1)));
      const nextPoint = route[stepIndex];
      mission.currentLatitude = nextPoint.latitude;
      mission.currentLongitude = nextPoint.longitude;
      mission.distanceRemaining = Math.max(0, mission.distanceRemaining - 0.75);
      mission.estimatedArrivalTime = new Date(Date.now() + mission.distanceRemaining * 120000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    updateSignalState(mission);
    mission.updatedAt = toIsoDate(new Date());
    const ambulance = ambulances.find((entry) => entry.id === mission.ambulanceId);
    if (ambulance) {
      ambulance.latitude = mission.currentLatitude;
      ambulance.longitude = mission.currentLongitude;
      saveAmbulance(ambulance);
    }

    if (mission.progress >= 1) {
      mission.status = 'ARRIVED';
      mission.distanceRemaining = 0;
      syncLinkedEventStatus(mission, 'RESOLVED');
      addActivity(mission.id, 'mission_arrived', 'Ambulance arrived at the selected hospital.');
      persistMission(mission);
      io.emit('mission:completed', mission);
      io.emit('mission:updated', mission);
      clearInterval(timer);
      missionTimers.delete(missionId);
      return;
    }

    persistMission(mission);
    io.emit('mission:updated', mission);
    io.emit('ambulance:location', {
      ambulanceId: mission.ambulanceId,
      latitude: mission.currentLatitude,
      longitude: mission.currentLongitude,
      status: ambulance?.status ?? 'ON_MISSION',
      progress: mission.progress,
    });
  }, 3000);

  missionTimers.set(missionId, timer);
}

async function seedUsers() {
  users = loadUsers() as User[];
  const nameMap = [
    { name: 'Admin Operator', email: 'admin@rescueflow.demo', role: 'ADMIN' as const, password: 'admin123' },
    { name: 'Ambulance Unit', email: 'ambulance@rescueflow.demo', role: 'EMERGENCY_VEHICLE' as const, password: 'emergencyvehicle123' },
    { name: 'Hospital Team', email: 'hospital@rescueflow.demo', role: 'HOSPITAL' as const, password: 'hospital123' },
    { name: 'Traffic Controller', email: 'traffic@rescueflow.demo', role: 'TRAFFIC_CONTROLLER' as const, password: 'traffic123' },
    { name: 'Public User', email: 'public@rescueflow.demo', role: 'PUBLIC_USER' as const, password: 'public123' },
  ];

  for (const userEntry of nameMap) {
    const existing = users.find((user) => user.email.toLowerCase() === userEntry.email);
    if (existing && !(await bcrypt.compare(userEntry.password, existing.passwordHash))) {
      existing.passwordHash = await bcrypt.hash(userEntry.password, 10);
      existing.updatedAt = toIsoDate(new Date());
      saveUser(existing);
    } else if (!existing) {
      const passwordHash = await bcrypt.hash(userEntry.password, 10);
      const user: User = {
        id: randomUUID(),
        name: userEntry.name,
        email: userEntry.email,
        passwordHash,
        role: userEntry.role,
        createdAt: toIsoDate(new Date()),
        updatedAt: toIsoDate(new Date()),
      };
      saveUser(user);
    }
  }
  users = loadUsers() as User[];
}

function seedStaticData() {
  const savedAmbulances = loadAmbulances();
  ambulances.filter((item) => !savedAmbulances.some((saved) => saved.id === item.id)).forEach(saveAmbulance);
  const savedHospitals = loadHospitals();
  hospitals.filter((item) => !savedHospitals.some((saved) => saved.id === item.id)).forEach(saveHospital);
  const savedSignals = loadTrafficSignals();
  trafficSignals.filter((item) => !savedSignals.some((saved) => saved.id === item.id)).forEach(saveTrafficSignal);
  ambulances.splice(0, ambulances.length, ...(loadAmbulances() as Ambulance[]));
  hospitals.splice(0, hospitals.length, ...(loadHospitals() as Hospital[]));
  trafficSignals.splice(0, trafficSignals.length, ...(loadTrafficSignals() as TrafficSignal[]));
}

function seedMission() {
  const savedMissions = loadMissions();
  if (savedMissions.length > 0) {
    missions = savedMissions as Mission[];
    activityLogs = loadActivityLogs() as ActivityLog[];
    notifications = loadNotifications() as NotificationRecord[];
    return;
  }

  const missionId = 'mission-001';
  const hospital = hospitals[0];
  const routeOptions = buildRouteScores();
  const recommended = [...routeOptions].sort((a, b) => a.score - b.score)[0];

  const mission: Mission = {
    id: missionId,
    missionCode: 'RF-2026-001',
    emergencyType: 'Critical Medical Emergency',
    priority: 'HIGH',
    status: 'HOSPITAL_READY',
    ambulanceId: ambulances[0].id,
    hospitalId: hospital.id,
    currentLatitude: 12.9716,
    currentLongitude: 77.5946,
    destinationLatitude: hospital.latitude,
    destinationLongitude: hospital.longitude,
    estimatedArrivalTime: '08:42',
    distanceRemaining: recommended.distance,
    createdAt: toIsoDate(new Date()),
    updatedAt: toIsoDate(new Date()),
    routeScore: recommended.score,
    routeName: recommended.routeName,
    progress: 0.2,
    signalStatus: 'PREPARING',
    lastSignalIndex: 1,
  };

  missions = [mission];
  persistMission(mission);
  activityLogs = [
    { id: randomUUID(), missionId, event: 'mission_created', description: 'Emergency mission created for RF-2026-001.', createdAt: toIsoDate(new Date()) },
  ];
  notifications = [
    { id: randomUUID(), userId: users.find((user) => user.role === 'ADMIN')?.id ?? 'admin-user', missionId, title: 'Mission Active', message: 'Emergency corridor prepared for RF-2026-001.', type: 'system', read: false, createdAt: toIsoDate(new Date()) },
  ];
  activityLogs.forEach(saveActivityLog);
  notifications.forEach(saveNotification);
}

app.get('/health', (_req, res) => {
  database.prepare('SELECT 1').get();
  res.json({ ok: true, service: 'rescueflow-backend', database: 'connected' });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'Name, email, and a password of at least 8 characters are required.' });
  }

  const existing = users.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
  if (existing) {
    return res.status(409).json({ message: 'Email already in use.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser: User = {
    id: randomUUID(),
    name,
    email,
    passwordHash,
    role: 'PUBLIC_USER',
    createdAt: toIsoDate(new Date()),
    updatedAt: toIsoDate(new Date()),
  };

  users.push(newUser);
  saveUser(newUser);
  return res.status(201).json({ user: { ...newUser, passwordHash: undefined }, token: createJwt(newUser) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'Email and password are required.' });
  }
  const user = users.find((entry) => entry.email.toLowerCase() === String(email ?? '').toLowerCase());
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password ?? '', user.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  return res.json({ token: createJwt(user), user: { ...user, passwordHash: undefined } });
});

app.get('/api/auth/me', ensureAuth, (req, res) => {
  const user = req.user as User;
  return res.json({ user: { ...user, passwordHash: undefined } });
});

app.get('/api/missions', (_req, res) => {
  res.json({ missions });
});

app.get('/api/missions/:id', (req, res) => {
  const mission = getMissionById(getParamId(req));
  if (!mission) {
    return res.status(404).json({ message: 'Mission not found' });
  }
  return res.json({ mission });
});

app.get('/api/missions/:id/activity', ensureAuth, (req, res) => {
  const mission = getMissionById(getParamId(req));
  if (!mission) return res.status(404).json({ message: 'Mission not found' });
  return res.json({ activity: activityLogs.filter((entry) => entry.missionId === mission.id) });
});

app.get('/api/notifications', ensureAuth, (req, res) => {
  const user = req.user as User;
  return res.json({ notifications: notifications.filter((entry) => entry.userId === user.id) });
});

app.patch('/api/notifications/:id/read', ensureAuth, (req, res) => {
  const user = req.user as User;
  const notification = notifications.find((entry) => entry.id === getParamId(req) && entry.userId === user.id);
  if (!notification) return res.status(404).json({ message: 'Notification not found' });
  notification.read = true;
  saveNotification(notification);
  return res.json({ notification });
});

app.get('/api/events', ensureAuth, (req, res) => {
  const user = req.user as User;
  return res.json({ events: events.map((event) => eventForRole(event, user.role)) });
});

app.post('/api/events', ensureAuth, rateLimitEventReports, (req, res) => {
  const user = req.user as User;
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'A valid event report is required.' });
  }

  const input = body as Record<string, unknown>;
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  const address = typeof input.address === 'string' ? input.address.trim() : '';
  if (!title || title.length > 120 || description.length > 2000 || notes.length > 1000 || address.length > 240) {
    return res.status(400).json({ message: 'Provide a title up to 120 characters, description up to 2,000, notes up to 1,000, and address up to 240.' });
  }
  if (!eventTypes.includes(input.eventType as (typeof eventTypes)[number])) {
    return res.status(400).json({ message: 'Select a valid event type.' });
  }
  if (!eventSeverities.includes(input.severity as (typeof eventSeverities)[number])) {
    return res.status(400).json({ message: 'Select a valid event severity.' });
  }

  const hasLatitude = input.latitude !== null && input.latitude !== undefined && input.latitude !== '';
  const hasLongitude = input.longitude !== null && input.longitude !== undefined && input.longitude !== '';
  if (hasLatitude !== hasLongitude) return res.status(400).json({ message: 'Latitude and longitude must be provided together.' });
  const latitude = hasLatitude ? Number(input.latitude) : null;
  const longitude = hasLongitude ? Number(input.longitude) : null;
  if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
    || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    return res.status(400).json({ message: 'Enter valid latitude and longitude coordinates.' });
  }
  if (latitude === null && !address) return res.status(400).json({ message: 'Select a location on the map or enter a location address.' });

  const createdAt = toIsoDate(new Date());
  const initialStatus: EventStatus = user.role === 'PUBLIC_USER' ? 'UNVERIFIED' : 'REPORTED';
  const id = randomUUID();
  const event = createEventWithActivity({
    id,
    title,
    description,
    notes,
    eventType: input.eventType as string,
    severity: input.severity as string,
    status: initialStatus,
    latitude,
    longitude,
    address,
    reporterId: user.id,
    reporterRole: user.role,
    missionId: null,
    createdAt,
    updatedAt: createdAt,
  }, {
    id: randomUUID(),
    eventId: id,
    actorId: user.id,
    actorRole: user.role,
    action: 'event_reported',
    description: user.role === 'PUBLIC_USER' ? 'Event reported by a public user. Verification is required.' : `Event reported by ${user.role.toLowerCase().replaceAll('_', ' ')}.`,
    createdAt,
  });

  events.unshift(event);
  notifyEventUsers(event);
  io.emit('public:alert', { message: 'An emergency incident has been reported. Please cooperate with responders and avoid the affected area.' });
  return res.status(201).json({ event: eventForRole(event, user.role) });
});

app.get('/api/events/:id', ensureAuth, (req, res) => {
  const user = req.user as User;
  const event = getEventById(getParamId(req));
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const activity = loadEventActivityLogs(event.id).map(({ id, eventId, actorRole, action, description, createdAt }) => ({
    id, eventId, actorRole, action, description, createdAt,
  }));
  return res.json({ event: eventForRole(event, user.role), activity });
});

app.patch('/api/events/:id/status', ensureAuth, authorize('ADMIN'), (req, res) => {
  const event = getEventById(getParamId(req));
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const status = req.body?.status as EventStatus;
  if (!eventStatuses.includes(status)) return res.status(400).json({ message: 'Select a valid event status.' });
  if (!eventStatusTransitions[event.status as EventStatus]?.includes(status)) {
    return res.status(409).json({ message: `An event cannot move from ${event.status} to ${status}.` });
  }

  const user = req.user as User;
  updateEventStatus(event, status, user, `Event status changed to ${status.replaceAll('_', ' ').toLowerCase()}.`);
  return res.json({ event: eventForRole(event, user.role) });
});

app.delete('/api/events/:id', ensureAuth, authorize('ADMIN'), (req, res) => {
  const event = getEventById(getParamId(req));
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  if (!eventStatusTransitions[event.status as EventStatus]?.includes('CANCELLED')) {
    return res.status(409).json({ message: 'This event can no longer be cancelled.' });
  }

  const user = req.user as User;
  updateEventStatus(event, 'CANCELLED', user, 'Event was cancelled by an admin. The audit history was retained.');
  return res.json({ event: eventForRole(event, user.role) });
});

app.post('/api/events/:id/mission', ensureAuth, authorize('ADMIN'), (req, res) => {
  const event = getEventById(getParamId(req));
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  if (event.status !== 'VERIFIED') {
    return res.status(409).json({ message: 'Verify the event before creating a rescue mission.' });
  }

  const ambulanceId = typeof req.body?.ambulanceId === 'string' ? req.body.ambulanceId : '';
  const hospitalId = typeof req.body?.hospitalId === 'string' ? req.body.hospitalId : '';
  const ambulance = ambulances.find((entry) => entry.id === ambulanceId && entry.status === 'READY');
  const hospital = hospitals.find((entry) => entry.id === hospitalId && entry.availabilityStatus === 'AVAILABLE');
  if (!ambulance || !hospital) {
    return res.status(409).json({ message: 'Select an available ambulance and hospital.' });
  }

  const recommended = [...buildRouteScores()].sort((a, b) => a.score - b.score)[0];
  const createdAt = toIsoDate(new Date());
  const missionId = randomUUID();
  const priority = event.severity === 'CRITICAL' || event.severity === 'HIGH' ? event.severity : 'MEDIUM';
  const mission: Mission = {
    id: missionId,
    missionCode: `RF-${new Date().getFullYear()}-${String(missions.length + 1).padStart(3, '0')}`,
    emergencyType: event.eventType.replaceAll('_', ' '),
    priority,
    status: 'PENDING',
    ambulanceId: ambulance.id,
    hospitalId: hospital.id,
    currentLatitude: event.latitude ?? ambulance.latitude,
    currentLongitude: event.longitude ?? ambulance.longitude,
    destinationLatitude: hospital.latitude,
    destinationLongitude: hospital.longitude,
    estimatedArrivalTime: new Date(Date.now() + recommended.estimatedTime * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    distanceRemaining: recommended.distance,
    createdAt,
    updatedAt: createdAt,
    routeScore: recommended.score,
    routeName: recommended.routeName,
    progress: 0,
    signalStatus: 'NORMAL',
    lastSignalIndex: 0,
  };
  const nextAmbulance = { ...ambulance, status: 'ON_MISSION' };
  const nextHospital = { ...hospital, availabilityStatus: 'SELECTED' };
  const nextEvent = { ...event, status: 'RESPONDERS_ASSIGNED', missionId, updatedAt: createdAt };

  const missionActivity: EventActivityRecord = {
    id: randomUUID(),
    eventId: event.id,
    actorId: (req.user as User).id,
    actorRole: 'ADMIN',
    action: 'mission_created',
    description: `Rescue mission ${mission.missionCode} created for this event.`,
    createdAt,
  };
  database.transaction(() => {
    saveMission({
      ...mission,
      routeScore: mission.routeScore ?? null,
      routeName: mission.routeName ?? null,
      signalStatus: mission.signalStatus ?? null,
      lastSignalIndex: mission.lastSignalIndex ?? null,
    });
    saveAmbulance(nextAmbulance);
    saveHospital(nextHospital);
    updateEventRecord(nextEvent);
    saveEventActivityLog(missionActivity);
  })();

  Object.assign(ambulance, nextAmbulance);
  Object.assign(hospital, nextHospital);
  Object.assign(event, nextEvent);
  missions.unshift(mission);
  addActivity(mission.id, 'mission_created', `Mission created from event ${event.eventCode}.`);
  const adminUser = req.user as User;
  for (const recipient of users) {
    const notification = {
      id: randomUUID(),
      userId: recipient.id,
      missionId: event.id,
      title: 'Emergency response assigned',
      message: recipient.role === 'PUBLIC_USER'
        ? 'Responders are coordinating assistance for an emergency.'
        : `Rescue mission ${mission.missionCode} has been assigned.`,
      type: 'event',
      read: false,
      createdAt,
    };
    notifications.unshift(notification);
    saveNotification(notification);
    io.to(`user:${recipient.id}`).emit('notification:new', notification);
    io.to(`user:${recipient.id}`).emit('event:updated', eventForRole(event, recipient.role));
    io.to(`user:${recipient.id}`).emit('event:assigned', {
      event: eventForRole(event, recipient.role),
      mission: recipient.role === 'PUBLIC_USER'
        ? { id: mission.id, missionCode: mission.missionCode, status: mission.status }
        : mission,
    });
  }
  io.emit('mission:created', mission);
  io.emit('ambulance:location', {
    ambulanceId: ambulance.id,
    latitude: mission.currentLatitude,
    longitude: mission.currentLongitude,
    status: ambulance.status,
  });
  io.emit('hospital:notification', { hospitalId: hospital.id, hospital, message: 'A rescue mission has been assigned to your hospital.' });
  return res.status(201).json({ event: eventForRole(event, adminUser.role), mission });
});

app.post('/api/missions', ensureAuth, authorize('ADMIN', 'EMERGENCY_VEHICLE'), (req, res) => {
  const { emergencyType = 'Critical Medical Emergency', priority = 'HIGH' } = req.body || {};
  const hospital = hospitals.find((entry) => entry.availabilityStatus === 'AVAILABLE');
  const ambulance = ambulances.find((entry) => entry.status === 'READY');
  if (!hospital || !ambulance) {
    return res.status(409).json({ message: 'No available ambulance or emergency hospital is currently ready.' });
  }
  const routeOptions = buildRouteScores();
  const recommended = [...routeOptions].sort((a, b) => a.score - b.score)[0];
  const missionId = randomUUID();
  const mission: Mission = {
    id: missionId,
    missionCode: `RF-${new Date().getFullYear()}-${String(missions.length + 1).padStart(3, '0')}`,
    emergencyType,
    priority,
    status: 'PENDING',
    ambulanceId: ambulance.id,
    hospitalId: hospital.id,
    currentLatitude: ambulance.latitude,
    currentLongitude: ambulance.longitude,
    destinationLatitude: hospital.latitude,
    destinationLongitude: hospital.longitude,
    estimatedArrivalTime: '08:42',
    distanceRemaining: recommended.distance,
    createdAt: toIsoDate(new Date()),
    updatedAt: toIsoDate(new Date()),
    routeScore: recommended.score,
    routeName: recommended.routeName,
    progress: 0,
    signalStatus: 'NORMAL',
    lastSignalIndex: 0,
  };

  ambulance.status = 'ON_MISSION';
  saveAmbulance(ambulance);
  io.emit('ambulance:location', {
    ambulanceId: ambulance.id,
    latitude: ambulance.latitude,
    longitude: ambulance.longitude,
    status: ambulance.status,
  });
  missions.unshift(mission);
  persistMission(mission);
  addActivity(mission.id, 'mission_created', 'Emergency mission created and route analysis started.');
  const adminUser = users.find((user) => user.role === 'ADMIN');
  if (adminUser) {
    pushNotification(adminUser.id, mission.id, 'Mission created', 'New emergency vehicle dispatch initiated.', 'mission');
  }
  io.emit('mission:created', mission);
  io.emit('public:alert', { message: 'Emergency vehicle is moving through the corridor.' });
  return res.status(201).json({ mission });
});

app.post('/api/missions/:id/start', ensureAuth, authorize('ADMIN', 'EMERGENCY_VEHICLE'), (req, res) => {
  const mission = getMissionById(getParamId(req));
  if (!mission) {
    return res.status(404).json({ message: 'Mission not found' });
  }

  mission.status = 'ACTIVE';
  mission.updatedAt = toIsoDate(new Date());
  persistMission(mission);
  const ambulance = ambulances.find((entry) => entry.id === mission.ambulanceId);
  if (ambulance) {
    ambulance.status = 'ON_MISSION';
    saveAmbulance(ambulance);
  }
  addActivity(mission.id, 'mission_started', 'Ambulance has been activated and route simulation started.');
  syncLinkedEventStatus(mission, 'IN_PROGRESS', req.user as User);
  io.emit('mission:status', { missionId: mission.id, status: mission.status });
  io.emit('mission:updated', mission);
  startMissionTimer(mission.id);
  return res.json({ mission });
});

app.post('/api/missions/:id/complete', ensureAuth, authorize('ADMIN', 'EMERGENCY_VEHICLE'), (req, res) => {
  const mission = getMissionById(getParamId(req));
  if (!mission) {
    return res.status(404).json({ message: 'Mission not found' });
  }

  mission.status = 'COMPLETED';
  mission.updatedAt = toIsoDate(new Date());
  mission.distanceRemaining = 0;
  mission.progress = 1;
  persistMission(mission);
  const ambulance = ambulances.find((entry) => entry.id === mission.ambulanceId);
  if (ambulance) {
    ambulance.status = 'READY';
    saveAmbulance(ambulance);
  }
  const hospital = hospitals.find((entry) => entry.id === mission.hospitalId);
  if (hospital && hospital.availabilityStatus === 'SELECTED') {
    hospital.availabilityStatus = 'AVAILABLE';
    saveHospital(hospital);
  }
  updateSignalState(mission);
  addActivity(mission.id, 'mission_completed', 'Emergency mission marked as completed.');
  syncLinkedEventStatus(mission, 'RESOLVED', req.user as User);
  const timer = missionTimers.get(mission.id);
  if (timer) clearInterval(timer);
  missionTimers.delete(mission.id);
  if (ambulance) {
    io.emit('ambulance:location', {
      ambulanceId: ambulance.id,
      latitude: ambulance.latitude,
      longitude: ambulance.longitude,
      status: ambulance.status,
    });
  }
  if (hospital) {
    io.emit('hospital:notification', { hospitalId: hospital.id, hospital, message: 'Hospital capacity is available again.' });
  }
  io.emit('mission:completed', mission);
  return res.json({ mission });
});

app.patch('/api/missions/:id', ensureAuth, authorize('ADMIN'), (req, res) => {
  const mission = getMissionById(getParamId(req));
  if (!mission) {
    return res.status(404).json({ message: 'Mission not found' });
  }

  const { status, priority } = req.body || {};
  if (status !== undefined && !missionStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid mission status.' });
  }
  if (status !== undefined) mission.status = status;
  if (typeof priority === 'string') mission.priority = priority;
  mission.updatedAt = toIsoDate(new Date());
  persistMission(mission);
  if (status === 'CANCELLED') syncLinkedEventStatus(mission, 'CANCELLED', req.user as User);
  io.emit('mission:updated', mission);
  return res.json({ mission });
});

app.get('/api/ambulances', (_req, res) => {
  res.json({ ambulances });
});

app.get('/api/ambulances/:id', (req, res) => {
  const ambulance = ambulances.find((entry) => entry.id === getParamId(req));
  if (!ambulance) return res.status(404).json({ message: 'Ambulance not found' });
  return res.json({ ambulance });
});

app.patch('/api/ambulances/:id/location', ensureAuth, authorize('ADMIN', 'EMERGENCY_VEHICLE'), (req, res) => {
  const ambulance = ambulances.find((entry) => entry.id === getParamId(req));
  if (!ambulance) return res.status(404).json({ message: 'Ambulance not found' });

  ambulance.latitude = Number(req.body.latitude ?? ambulance.latitude);
  ambulance.longitude = Number(req.body.longitude ?? ambulance.longitude);
  if (!Number.isFinite(ambulance.latitude) || !Number.isFinite(ambulance.longitude)) {
    return res.status(400).json({ message: 'Latitude and longitude must be valid numbers.' });
  }
  if (typeof req.body.status === 'string') ambulance.status = req.body.status;
  saveAmbulance(ambulance);
  io.emit('ambulance:location', {
    ambulanceId: ambulance.id,
    latitude: ambulance.latitude,
    longitude: ambulance.longitude,
    status: ambulance.status,
  });
  return res.json({ ambulance });
});

app.get('/api/hospitals', (_req, res) => {
  res.json({ hospitals });
});

app.patch('/api/hospitals/:id', ensureAuth, authorize('ADMIN', 'HOSPITAL'), (req, res) => {
  const hospital = hospitals.find((entry) => entry.id === getParamId(req));
  if (!hospital) return res.status(404).json({ message: 'Hospital not found' });

  const { emergencyBeds, icuBeds, emergencyTeamStatus, availabilityStatus } = req.body || {};
  if (emergencyBeds !== undefined) {
    if (!Number.isInteger(emergencyBeds) || emergencyBeds < 0) return res.status(400).json({ message: 'Emergency beds must be a non-negative integer.' });
    hospital.emergencyBeds = emergencyBeds;
  }
  if (icuBeds !== undefined) {
    if (!Number.isInteger(icuBeds) || icuBeds < 0) return res.status(400).json({ message: 'ICU beds must be a non-negative integer.' });
    hospital.icuBeds = icuBeds;
  }
  if (typeof emergencyTeamStatus === 'string') hospital.emergencyTeamStatus = emergencyTeamStatus;
  if (typeof availabilityStatus === 'string') hospital.availabilityStatus = availabilityStatus;
  saveHospital(hospital);
  io.emit('hospital:notification', { hospitalId: hospital.id, hospital: hospital.name, message: 'Hospital updated.' });
  return res.json({ hospital });
});

app.post('/api/missions/:id/hospital/accept', ensureAuth, authorize('ADMIN', 'HOSPITAL'), (req, res) => {
  const mission = getMissionById(getParamId(req));
  if (!mission) return res.status(404).json({ message: 'Mission not found' });

  mission.status = 'HOSPITAL_READY';
  mission.updatedAt = toIsoDate(new Date());
  persistMission(mission);
  const hospital = hospitals.find((entry) => entry.id === mission.hospitalId);
  if (hospital) {
    hospital.availabilityStatus = 'SELECTED';
    hospital.emergencyTeamStatus = 'READY';
    saveHospital(hospital);
    io.emit('hospital:notification', { hospitalId: hospital.id, hospital, message: 'Hospital is ready for the incoming mission.' });
  }

  io.emit('hospital:ready', { missionId: mission.id, hospitalId: mission.hospitalId });
  io.emit('mission:updated', mission);
  return res.json({ mission, hospital });
});

app.get('/api/traffic-signals', (_req, res) => {
  res.json({ trafficSignals });
});

app.patch('/api/traffic-signals/:id/status', ensureAuth, authorize('ADMIN', 'TRAFFIC_CONTROLLER'), (req, res) => {
  const signal = trafficSignals.find((entry) => entry.id === getParamId(req));
  if (!signal) return res.status(404).json({ message: 'Signal not found' });

  const status = req.body?.status;
  if (!['NORMAL', 'PREPARING', 'EMERGENCY_PRIORITY', 'AMBULANCE_PASSED'].includes(status)) {
    return res.status(400).json({ message: 'Invalid traffic signal status.' });
  }
  signal.status = status;
  saveTrafficSignal(signal);
  io.emit('traffic:signal:update', signal);
  return res.json({ signal });
});

const frontendBuildPath = resolve(__dirname, '../../frontend/dist');
if (existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ message: 'API route not found' });
    }
    return res.sendFile(resolve(frontendBuildPath, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}

io.on('connection', (socket) => {
  const user = users.find((entry) => entry.id === socket.data.userId);
  if (!user) {
    socket.disconnect(true);
    return;
  }
  socket.join(`user:${user.id}`);
  socket.emit('system:connected', { message: 'Connected to RescueFlow.' });
  socket.on('demo:run', () => {
    const mission = missions[0];
    if (mission) {
      io.emit('mission:created', mission);
      io.emit('mission:updated', mission);
    }
  });
});

async function bootstrap() {
  seedStaticData();
  await seedUsers();
  seedMission();
  events = loadEvents();
  missions
    .filter((mission) => ['ACTIVE', 'CORRIDOR_ACTIVE', 'CORRIDOR_PREPARING'].includes(mission.status))
    .forEach((mission) => startMissionTimer(mission.id));

  server.listen(PORT, () => {
    console.log(`RescueFlow backend running on http://localhost:${PORT}`);
  });
}

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start RescueFlow backend:', error);
  database.close();
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  });
}
