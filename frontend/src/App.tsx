import { motion } from 'framer-motion';
import { Activity, ArrowRight, Bell, Check, Clock3, HeartPulse, Hospital, LocateFixed, MapPin, Plus, ShieldCheck, Siren, TrafficCone, Users, X, type LucideIcon } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import * as THREE from 'three';
import 'maplibre-gl/dist/maplibre-gl.css';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

type Role = 'ADMIN' | 'EMERGENCY_VEHICLE' | 'HOSPITAL' | 'TRAFFIC_CONTROLLER' | 'PUBLIC_USER';

type MissionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'ROUTE_ANALYSIS'
  | 'HOSPITAL_NOTIFIED'
  | 'HOSPITAL_READY'
  | 'CORRIDOR_PREPARING'
  | 'CORRIDOR_ACTIVE'
  | 'ARRIVED'
  | 'COMPLETED'
  | 'CANCELLED';

type SignalStatus = 'NORMAL' | 'PREPARING' | 'EMERGENCY_PRIORITY' | 'AMBULANCE_PASSED';
type EventStatus = 'UNVERIFIED' | 'REPORTED' | 'VERIFIED' | 'RESPONDERS_ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED' | 'FALSE_REPORT';
type EventType = 'MEDICAL_EMERGENCY' | 'ROAD_ACCIDENT' | 'FIRE_EMERGENCY' | 'PUBLIC_SAFETY' | 'TRAFFIC_EMERGENCY' | 'NATURAL_DISASTER' | 'OTHER_EMERGENCY';
type EventSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

type Mission = {
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
  routeName?: string;
  progress: number;
  signalStatus?: SignalStatus;
};

type Hospital = {
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

type Ambulance = {
  id: string;
  vehicleNumber: string;
  driverName: string;
  status: string;
  latitude: number;
  longitude: number;
};

type Signal = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: SignalStatus;
  missionId: string | null;
};

type EventReport = {
  id: string;
  eventCode: string;
  title: string;
  description: string;
  notes: string;
  eventType: EventType;
  severity: EventSeverity;
  status: EventStatus;
  latitude: number | null;
  longitude: number | null;
  address: string;
  reporterRole: Role;
  missionId: string | null;
  createdAt: string;
  updatedAt: string;
};

type EventActivity = {
  id: string;
  eventId: string;
  actorRole: Role;
  action: string;
  description: string;
  createdAt: string;
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

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');

const eventTypeLabels: Record<EventType, string> = {
  MEDICAL_EMERGENCY: 'Medical emergency',
  ROAD_ACCIDENT: 'Road accident',
  FIRE_EMERGENCY: 'Fire emergency',
  PUBLIC_SAFETY: 'Public safety incident',
  TRAFFIC_EMERGENCY: 'Traffic emergency',
  NATURAL_DISASTER: 'Natural disaster',
  OTHER_EMERGENCY: 'Other emergency',
};

const severityColors: Record<EventSeverity, string> = {
  LOW: '#34d399',
  MEDIUM: '#facc15',
  HIGH: '#fb923c',
  CRITICAL: '#ef4444',
};

const demoUsers: Record<string, { email: string; password: string; role: Role; name: string }> = {
  admin: { email: 'admin@rescueflow.demo', password: 'admin123', role: 'ADMIN', name: 'Admin Operator' },
  ambulance: { email: 'ambulance@rescueflow.demo', password: 'emergencyvehicle123', role: 'EMERGENCY_VEHICLE', name: 'Ambulance Unit' },
  hospital: { email: 'hospital@rescueflow.demo', password: 'hospital123', role: 'HOSPITAL', name: 'Hospital Team' },
  traffic: { email: 'traffic@rescueflow.demo', password: 'traffic123', role: 'TRAFFIC_CONTROLLER', name: 'Traffic Controller' },
  public: { email: 'public@rescueflow.demo', password: 'public123', role: 'PUBLIC_USER', name: 'Public User' },
};

const routeStyles: Record<string, string> = {
  NORMAL: 'bg-slate-400 text-slate-900',
  PREPARING: 'bg-amber-400 text-amber-950',
  EMERGENCY_PRIORITY: 'bg-red-500 text-white',
  AMBULANCE_PASSED: 'bg-emerald-400 text-emerald-950',
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function useMouseGlow() {
  const [glow, setGlow] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const update = (event: MouseEvent) => {
      setGlow({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('pointermove', update);
    return () => window.removeEventListener('pointermove', update);
  }, []);

  return glow;
}

function getRoleRoute(role: Role) {
  const map: Record<Role, string> = {
    ADMIN: '/admin',
    EMERGENCY_VEHICLE: '/ambulance',
    HOSPITAL: '/hospital',
    TRAFFIC_CONTROLLER: '/traffic',
    PUBLIC_USER: '/public',
  };
  return map[role];
}

function RoleGate({ user, ready, role, children }: { user: User | null; ready: boolean; role: Role; children: ReactNode }) {
  if (!ready) {
    return <div role="status" className="p-8 text-center text-slate-300">Restoring your session...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== role) {
    return <Navigate to={getRoleRoute(user.role)} replace />;
  }
  return children;
}

function OperationalDataState({ ready }: { ready: boolean }) {
  return (
    <div role="status" className="min-h-screen bg-slate-950 p-8 text-center text-slate-300">
      {ready ? 'No mission data is available from the RescueFlow database.' : 'Loading live operational data...'}
    </div>
  );
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Request failed');
  }
  return response.json() as Promise<T>;
}

function App() {
  const navigate = useNavigate();
  const glowPosition = useMouseGlow();
  const [user, setUser] = useState<User | null>(() => {
    if (!localStorage.getItem('rescueflow-token')) {
      localStorage.removeItem('rescueflow-user');
      return null;
    }
    try {
      const stored = localStorage.getItem('rescueflow-user');
      return stored ? JSON.parse(stored) as User : null;
    } catch {
      localStorage.removeItem('rescueflow-user');
      return null;
    }
  });
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('rescueflow-token'));
  const [authReady, setAuthReady] = useState(() => !localStorage.getItem('rescueflow-token'));
  const [mission, setMission] = useState<Mission | null>(null);
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [events, setEvents] = useState<EventReport[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [missionCount, setMissionCount] = useState(0);
  const [dataReady, setDataReady] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  useEffect(() => {
    if (!authToken) return;

    let cancelled = false;
    void fetchJson<{ user: User }>(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    }).then(({ user: verifiedUser }) => {
      if (cancelled) return;
      setUser(verifiedUser);
      localStorage.setItem('rescueflow-user', JSON.stringify(verifiedUser));
    }).catch((error: unknown) => {
      if (cancelled) return;
      localStorage.removeItem('rescueflow-user');
      localStorage.removeItem('rescueflow-token');
      setUser(null);
      setAuthReady(true);
      setAuthToken(null);
      setEvents([]);
      setNotifications([]);
      setAppError(error instanceof Error ? 'Your session has expired. Please sign in again.' : 'Unable to verify your session.');
    }).finally(() => {
      if (!cancelled) setAuthReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    const socket: Socket = io(API_BASE || undefined, { auth: { token: authToken }, transports: ['websocket'] });

    socket.on('connect', () => {
      setSocketConnected(true);
      setAppError(null);
    });
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('mission:updated', (nextMission: Mission) => setMission(nextMission));
    socket.on('mission:completed', (nextMission: Mission) => setMission(nextMission));
    socket.on('mission:created', (nextMission: Mission) => {
      setMission(nextMission);
      void fetchJson<{ missions: Mission[] }>(`${API_BASE}/api/missions`)
        .then((response) => setMissionCount(response.missions.length))
        .catch((error: unknown) => setAppError(error instanceof Error ? error.message : 'Unable to refresh mission totals.'));
    });
    socket.on('event:reported', (nextEvent: EventReport) => {
      setEvents((current) => [nextEvent, ...current.filter((event) => event.id !== nextEvent.id)]);
    });
    socket.on('event:updated', (nextEvent: EventReport) => {
      setEvents((current) => [nextEvent, ...current.filter((event) => event.id !== nextEvent.id)]);
    });
    socket.on('event:status:changed', (nextEvent: EventReport) => {
      setEvents((current) => [nextEvent, ...current.filter((event) => event.id !== nextEvent.id)]);
    });
    socket.on('event:resolved', (nextEvent: EventReport) => {
      setEvents((current) => [nextEvent, ...current.filter((event) => event.id !== nextEvent.id)]);
    });
    socket.on('event:assigned', (payload: { event: EventReport; mission: Mission | Pick<Mission, 'id' | 'missionCode' | 'status'> }) => {
      setEvents((current) => [payload.event, ...current.filter((event) => event.id !== payload.event.id)]);
      if ('ambulanceId' in payload.mission) setMission(payload.mission);
      void Promise.all([
        fetchJson<{ ambulances: Ambulance[] }>(`${API_BASE}/api/ambulances`),
        fetchJson<{ hospitals: Hospital[] }>(`${API_BASE}/api/hospitals`),
      ]).then(([ambulanceResponse, hospitalResponse]) => {
        setAmbulances(ambulanceResponse.ambulances);
        setHospitals(hospitalResponse.hospitals);
      }).catch((error: unknown) => setAppError(error instanceof Error ? error.message : 'Unable to refresh assigned resources.'));
    });
    socket.on('notification:new', (notification: NotificationRecord) => {
      setNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)]);
    });
    socket.on('hospital:notification', (payload: { hospitalId: string; hospital?: Hospital }) => {
      if (payload.hospital) {
        setHospitals((current) => current.map((hospital) => hospital.id === payload.hospitalId ? payload.hospital! : hospital));
      }
    });
    socket.on('traffic:signal:update', (updatedSignal: Signal) => {
      setSignals((current) => current.map((signal) => signal.id === updatedSignal.id ? updatedSignal : signal));
    });
    socket.on('ambulance:location', (payload: { ambulanceId: string; latitude: number; longitude: number; status?: string; progress?: number }) => {
      setAmbulances((current) => current.map((ambulance) => ambulance.id === payload.ambulanceId
        ? { ...ambulance, latitude: payload.latitude, longitude: payload.longitude, status: payload.status ?? ambulance.status }
        : ambulance));
      setMission((current) => current ? ({
        ...current,
        currentLatitude: payload.latitude,
        currentLongitude: payload.longitude,
        progress: payload.progress ?? current.progress,
      }) : current);
    });
    socket.on('connect_error', () => setAppError('Cannot connect to the RescueFlow server. Start the backend and try again.'));

    return () => {
      socket.disconnect();
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    let cancelled = false;
    const headers = { Authorization: `Bearer ${authToken}` };
    void Promise.all([
      fetchJson<{ events: EventReport[] }>(`${API_BASE}/api/events`, { headers }),
      fetchJson<{ notifications: NotificationRecord[] }>(`${API_BASE}/api/notifications`, { headers }),
    ]).then(([eventResponse, notificationResponse]) => {
      if (cancelled) return;
      setEvents(eventResponse.events);
      setNotifications(notificationResponse.notifications);
    }).catch((error: unknown) => {
      if (!cancelled) setAppError(error instanceof Error ? error.message : 'Unable to load events and notifications.');
    });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [missionResponse, ambulanceResponse, hospitalResponse, signalResponse] = await Promise.all([
          fetchJson<{ missions: Mission[] }>(`${API_BASE}/api/missions`),
          fetchJson<{ ambulances: Ambulance[] }>(`${API_BASE}/api/ambulances`),
          fetchJson<{ hospitals: Hospital[] }>(`${API_BASE}/api/hospitals`),
          fetchJson<{ trafficSignals: Signal[] }>(`${API_BASE}/api/traffic-signals`),
        ]);
        setMission(missionResponse.missions[0] ?? null);
        setMissionCount(missionResponse.missions.length);
        setAmbulances(ambulanceResponse.ambulances);
        setHospitals(hospitalResponse.hospitals);
        setSignals(signalResponse.trafficSignals);
      } catch (error) {
        setAppError(error instanceof Error ? error.message : 'Failed to load RescueFlow data.');
      } finally {
        setDataReady(true);
      }
    };

    void loadData();
  }, []);

  const stats = useMemo(() => ({
    totalMissions: missionCount,
    activeAmbulances: ambulances.filter((entry) => entry.status !== 'READY').length,
  }), [ambulances, missionCount]);

  async function handleLogin(email: string, password: string) {
    setAppError(null);
    const payload = await fetchJson<{ token: string; user: User }>(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('rescueflow-user', JSON.stringify(payload.user));
    localStorage.setItem('rescueflow-token', payload.token);
    setAuthToken(payload.token);
    setUser(payload.user);
    setAuthReady(true);
    navigate(getRoleRoute(payload.user.role));
  }

  async function startMissionLegacy() {
    try {
      const response = await fetchJson<{ mission: Mission }>(`${API_BASE}/api/missions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer demo-token`,
        },
        body: JSON.stringify({ emergencyType: 'Critical Medical Emergency', priority: 'HIGH' }),
      });
      setMission(response.mission);
      navigate('/admin');
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Unable to start the mission.');
    }
  }

  async function createAndStartMission(token: string) {
    const created = await fetchJson<{ mission: Mission }>(`${API_BASE}/api/missions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ emergencyType: 'Critical Medical Emergency', priority: 'HIGH' }),
    });
    const started = await fetchJson<{ mission: Mission }>(`${API_BASE}/api/missions/${created.mission.id}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    setMission(started.mission);
    return started.mission;
  }

  async function startMission() {
    if (!authToken) {
      setAppError('Please sign in before starting an emergency mission.');
      return;
    }
    setAppError(null);
    try {
      await createAndStartMission(authToken);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Unable to start the mission.');
    }
  }

  async function runDemoMode() {
    setAppError(null);
    try {
      let token = authToken;
      if (!token || (user?.role !== 'ADMIN' && user?.role !== 'EMERGENCY_VEHICLE')) {
        const login = await fetchJson<{ token: string; user: User }>(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          body: JSON.stringify({ email: demoUsers.admin.email, password: demoUsers.admin.password }),
        });
        token = login.token;
        localStorage.setItem('rescueflow-user', JSON.stringify(login.user));
        localStorage.setItem('rescueflow-token', login.token);
        setAuthToken(login.token);
        setUser(login.user);
      }
      await createAndStartMission(token);
      navigate('/admin');
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Unable to run the simulation.');
    }
  }

  void startMissionLegacy;

  async function acceptHospitalMission() {
    if (!authToken || !mission) return;
    try {
      const response = await fetchJson<{ mission: Mission; hospital: Hospital }>(`${API_BASE}/api/missions/${mission.id}/hospital/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setMission(response.mission);
      setHospitals((current) => current.map((hospital) => hospital.id === response.hospital.id ? response.hospital : hospital));
      setAppError(null);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Unable to accept the incoming mission.');
    }
  }

  async function updateHospitalCapacity(hospitalId: string, emergencyBeds: number) {
    if (!authToken) return;
    try {
      const response = await fetchJson<{ hospital: Hospital }>(`${API_BASE}/api/hospitals/${hospitalId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ emergencyBeds }),
      });
      setHospitals((current) => current.map((hospital) => hospital.id === hospitalId ? response.hospital : hospital));
      setAppError(null);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Unable to update hospital capacity.');
    }
  }

  async function updateSignal(signalId: string, status: SignalStatus) {
    if (!authToken) return;
    try {
      const response = await fetchJson<{ signal: Signal }>(`${API_BASE}/api/traffic-signals/${signalId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ status }),
      });
      setSignals((current) => current.map((signal) => signal.id === signalId ? response.signal : signal));
      setAppError(null);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Unable to update the traffic signal.');
    }
  }

  async function submitEventReport(input: Omit<EventReport, 'id' | 'eventCode' | 'status' | 'reporterRole' | 'missionId' | 'createdAt' | 'updatedAt'>) {
    if (!authToken) throw new Error('Sign in before reporting an event.');
    const response = await fetchJson<{ event: EventReport }>(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(input),
    });
    setEvents((current) => [response.event, ...current.filter((event) => event.id !== response.event.id)]);
    return response.event;
  }

  async function changeEventStatus(eventId: string, status: EventStatus) {
    if (!authToken) throw new Error('Sign in to update event status.');
    const response = await fetchJson<{ event: EventReport }>(`${API_BASE}/api/events/${eventId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status }),
    });
    setEvents((current) => current.map((event) => event.id === eventId ? response.event : event));
    return response.event;
  }

  async function createMissionFromEvent(eventId: string, ambulanceId: string, hospitalId: string) {
    if (!authToken) throw new Error('Sign in to create a rescue mission.');
    const response = await fetchJson<{ event: EventReport; mission: Mission }>(`${API_BASE}/api/events/${eventId}/mission`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ ambulanceId, hospitalId }),
    });
    setMission(response.mission);
    setEvents((current) => current.map((event) => event.id === eventId ? response.event : event));
    const [ambulanceResponse, hospitalResponse] = await Promise.all([
      fetchJson<{ ambulances: Ambulance[] }>(`${API_BASE}/api/ambulances`),
      fetchJson<{ hospitals: Hospital[] }>(`${API_BASE}/api/hospitals`),
    ]);
    setAmbulances(ambulanceResponse.ambulances);
    setHospitals(hospitalResponse.hospitals);
    return response;
  }

  async function markNotificationRead(notification: NotificationRecord) {
    if (!authToken) return;
    if (!notification.read) {
      try {
        await fetchJson<{ notification: NotificationRecord }>(`${API_BASE}/api/notifications/${notification.id}/read`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
      } catch (error) {
        setAppError(error instanceof Error ? error.message : 'Unable to mark the notification as read.');
      }
    }
    const event = events.find((entry) => entry.id === notification.missionId);
    if (event) navigate(`/events/${event.id}`);
    else navigate(getRoleRoute(user?.role ?? 'PUBLIC_USER'));
  }

  const logout = () => {
    localStorage.removeItem('rescueflow-user');
    localStorage.removeItem('rescueflow-token');
    setAuthToken(null);
    setUser(null);
    setEvents([]);
    setNotifications([]);
    setAuthReady(true);
    navigate('/');
  };


  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-90" style={{ background: `radial-gradient(circle at ${glowPosition.x}px ${glowPosition.y}px, rgba(251,146,60,0.18), transparent 18%)` }} />
      <div className="relative z-10">
        {user && authReady && (
          <div className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 px-4 py-3 shadow-xl backdrop-blur-xl">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
              <Link to={getRoleRoute(user.role)} className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <HeartPulse className="h-5 w-5 text-orange-300" />
                <span className="hidden sm:inline">RescueFlow</span>
              </Link>
              <div className="flex items-center gap-2">
                <Link to="/events" className="rounded-full border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-orange-400 sm:text-sm">
                  Event history <span className="ml-1 text-slate-400">{events.length}</span>
                </Link>
                <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => setIsReportOpen(true)} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-orange-500/20 sm:text-sm">
                  <Plus className="h-4 w-4" /><span className="hidden sm:inline">Report event</span><span className="sm:hidden">Report</span>
                </motion.button>
                <NotificationBell notifications={notifications} onSelect={markNotificationRead} />
              </div>
            </div>
          </div>
        )}
        {appError && <div role="alert" className="mx-auto mt-4 max-w-7xl rounded-xl border border-red-500/40 bg-red-950/80 px-4 py-3 text-sm text-red-100">{appError}</div>}
        <Routes>
          <Route path="/" element={<LandingPage onLoginClick={() => navigate('/login')} onDemoClick={runDemoMode} totalMissions={missionCount} activeAmbulances={stats.activeAmbulances} socketConnected={socketConnected} />} />
          <Route path="/login" element={<LoginPage onLogin={handleLogin} demoUsers={demoUsers} />} />
          <Route path="/role-select" element={<RoleSelectionPage />} />
          <Route path="/admin" element={<RoleGate user={user} ready={authReady} role="ADMIN">{mission ? <AdminDashboard mission={mission} ambulances={ambulances} hospitals={hospitals} signals={signals} events={events} socketConnected={socketConnected} onLogout={logout} stats={stats} onViewEvent={(eventId) => navigate(`/events/${eventId}`)} /> : <OperationalDataState ready={dataReady} />}</RoleGate>} />
          <Route path="/ambulance" element={<RoleGate user={user} ready={authReady} role="EMERGENCY_VEHICLE">{mission ? <AmbulanceDashboard mission={mission} ambulances={ambulances} hospitals={hospitals} signals={signals} onStartMission={startMission} onLogout={logout} /> : <OperationalDataState ready={dataReady} />}</RoleGate>} />
          <Route path="/hospital" element={<RoleGate user={user} ready={authReady} role="HOSPITAL">{mission ? <HospitalDashboard mission={mission} hospitals={hospitals} onAcceptMission={acceptHospitalMission} onUpdateCapacity={updateHospitalCapacity} onLogout={logout} /> : <OperationalDataState ready={dataReady} />}</RoleGate>} />
          <Route path="/traffic" element={<RoleGate user={user} ready={authReady} role="TRAFFIC_CONTROLLER">{mission ? <TrafficDashboard mission={mission} signals={signals} onUpdateSignal={updateSignal} onLogout={logout} /> : <OperationalDataState ready={dataReady} />}</RoleGate>} />
          <Route path="/public" element={<RoleGate user={user} ready={authReady} role="PUBLIC_USER">{mission ? <PublicAlertPage mission={mission} onLogout={logout} /> : <OperationalDataState ready={dataReady} />}</RoleGate>} />
          <Route path="/demo" element={<DemoModePage onStart={runDemoMode} />} />
          <Route path="/ai" element={mission ? <AiPage mission={mission} /> : <OperationalDataState ready={dataReady} />} />
          <Route path="/events" element={<RoleGate user={user} ready={authReady} role={user?.role ?? 'PUBLIC_USER'}><EventHistoryPage events={events} ready={Boolean(authToken)} onViewEvent={(eventId) => navigate(`/events/${eventId}`)} /></RoleGate>} />
          <Route path="/events/:id" element={<RoleGate user={user} ready={authReady} role={user?.role ?? 'PUBLIC_USER'}><EventDetailsPage events={events} token={authToken} user={user} ambulances={ambulances} hospitals={hospitals} onChangeStatus={changeEventStatus} onCreateMission={createMissionFromEvent} /></RoleGate>} />
        </Routes>
        {isReportOpen && <EventReportModal onClose={() => setIsReportOpen(false)} onSubmit={submitEventReport} />}
      </div>
    </div>
  );
}

function LandingPage({ onLoginClick, onDemoClick, totalMissions, activeAmbulances, socketConnected }: { onLoginClick: () => void; onDemoClick: () => void; totalMissions: number; activeAmbulances: number; socketConnected: boolean }) {
  return (
    <div className="min-h-screen bg-[#020817] text-slate-100">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-orange-500/50 bg-orange-500/10 p-2">
            <HeartPulse className="h-5 w-5 text-orange-300" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">RescueFlow</p>
            <p className="text-sm text-slate-400">Emergency command center</p>
          </div>
        </div>
        <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
          <Link to="/ai">AI Intelligence</Link>
          <Link to="/demo">Demo Mode</Link>
          <button type="button" onClick={onLoginClick} className="rounded-full border border-slate-700 px-4 py-2 text-slate-100 transition hover:border-orange-400 hover:text-orange-300">Login</button>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-16 pt-10">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs uppercase tracking-[0.2em] text-orange-200">
              <Siren className="h-4 w-4" />
              Every second matters
            </div>
            <h1 className="max-w-xl text-5xl font-black tracking-tight text-white md:text-6xl">
              EVERY SECOND MATTERS.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              RescueFlow connects emergency vehicles, hospitals and traffic networks to create intelligent emergency corridors and improve emergency response coordination.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <button type="button" onClick={onLoginClick} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:scale-[1.02]">
                <Siren className="h-4 w-4" /> Launch Command Center
              </button>
              <button type="button" onClick={onDemoClick} className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/60 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-400">
                <ArrowRight className="h-4 w-4" /> View Live Simulation
              </button>
            </div>
            <div className="mt-10 grid max-w-xl grid-cols-3 gap-4">
              <StatCard label="Total missions" value={String(totalMissions)} />
              <StatCard label="Active ambulances" value={String(activeAmbulances)} />
              <StatCard label="Live updates" value={socketConnected ? 'Connected' : 'Offline'} />
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8 }} className="relative h-[560px] rounded-[32px] border border-slate-800 bg-slate-900/60 shadow-2xl shadow-orange-950/30 backdrop-blur-xl">
            <div className="absolute inset-4 rounded-[28px] border border-slate-700/80 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_rgba(2,6,23,0.7))]" />
            <CityScene />
          </motion.div>
        </div>
      </main>
    </div>
  );
}

function LoginPage({ onLogin, demoUsers }: { onLogin: (email: string, password: string) => Promise<void>; demoUsers: Record<string, { email: string; password: string; role: Role; name: string }> }) {
  const [selected, setSelected] = useState(Object.values(demoUsers)[0].email);
  const [password, setPassword] = useState('admin123');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin() {
    setLoginError(null);
    setIsSubmitting(true);
    try {
      await onLogin(selected, password);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10">
      <div className="w-full max-w-5xl overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900/80 shadow-2xl shadow-orange-950/20 backdrop-blur-xl">
        <div className="grid lg:grid-cols-2">
          <div className="bg-[radial-gradient(circle_at_center,_rgba(251,146,60,0.15),_rgba(15,23,42,0.7))] p-10">
            <p className="text-xs uppercase tracking-[0.35em] text-orange-300">Secure access</p>
            <h2 className="mt-4 text-4xl font-bold text-white">Welcome to RescueFlow</h2>
            <p className="mt-4 text-slate-300">Deploy emergency coordination across admin, ambulance, hospital and traffic teams.</p>
            <div className="mt-8 space-y-4">
              {Object.values(demoUsers).map((account) => (
                <button key={account.email} type="button" onClick={() => { setSelected(account.email); setPassword(account.password); }} className={classNames('flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition', selected === account.email ? 'border-orange-400 bg-orange-500/10' : 'border-slate-700 bg-slate-900/60')}>
                  <div>
                    <p className="font-medium text-white">{account.name}</p>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{account.role}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-orange-300" />
                </button>
              ))}
            </div>
          </div>

          <div className="p-10">
            <div className="mb-8 flex items-center gap-3">
              <div className="rounded-xl border border-orange-500/50 bg-orange-500/10 p-2">
                <ShieldCheck className="h-5 w-5 text-orange-200" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Role login</p>
              </div>
            </div>

            <label className="mb-2 block text-sm text-slate-300">Email</label>
            <input value={selected} onChange={(event) => setSelected(event.target.value)} className="mb-5 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-slate-100 outline-none ring-0 placeholder:text-slate-500" placeholder="name@company.com" />

            <label className="mb-2 block text-sm text-slate-300">Password</label>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="mb-6 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-slate-100 outline-none ring-0" />

            {loginError && <p role="alert" className="mb-4 rounded-xl border border-red-500/40 bg-red-950/60 p-3 text-sm text-red-200">{loginError}</p>}
            <button type="button" onClick={() => void submitLogin()} disabled={isSubmitting} className="w-full rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-6 py-3 font-semibold text-white shadow-lg shadow-orange-500/20 disabled:cursor-wait disabled:opacity-60">
              {isSubmitting ? 'Signing in...' : 'Sign in to command center'}
            </button>

            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/80 p-4 text-sm text-slate-300">
              <p className="font-medium text-white">Demo accounts</p>
              <p className="mt-2">admin@rescueflow.demo / admin123</p>
              <p>ambulance@rescueflow.demo / emergencyvehicle123</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoleSelectionPage() {
  const roleCards: Array<{ role: string; path: string; icon: LucideIcon }> = [
    { role: 'ADMIN', path: '/admin', icon: ShieldCheck },
    { role: 'EMERGENCY_VEHICLE', path: '/ambulance', icon: Siren },
    { role: 'HOSPITAL', path: '/hospital', icon: Hospital },
    { role: 'TRAFFIC_CONTROLLER', path: '/traffic', icon: TrafficCone },
    { role: 'PUBLIC_USER', path: '/public', icon: Users },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10">
      <div className="w-full max-w-5xl rounded-[28px] border border-slate-800 bg-slate-900/80 p-10 shadow-2xl shadow-orange-950/20">
        <p className="text-xs uppercase tracking-[0.35em] text-orange-300">Choose a role</p>
        <h2 className="mt-4 text-4xl font-bold text-white">Emergency coordination access</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {roleCards.map(({ role, path, icon: Icon }) => (
            <Link key={role} to={path} className="rounded-2xl border border-slate-700 bg-slate-950/80 p-5 transition hover:border-orange-400">
              <div className="mb-4 inline-flex rounded-xl border border-orange-500/30 bg-orange-500/10 p-3">
                <Icon className="h-5 w-5 text-orange-300" />
              </div>
              <p className="text-lg font-semibold text-white">{role}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ mission, ambulances, hospitals, signals, events, socketConnected, onLogout, stats, onViewEvent }: { mission: Mission; ambulances: Ambulance[]; hospitals: Hospital[]; signals: Signal[]; events: EventReport[]; socketConnected: boolean; onLogout: () => void; stats: { totalMissions: number; activeAmbulances: number }; onViewEvent: (eventId: string) => void }) {
  const signalSummary = signals.slice(0, 3).map((signal) => ({ ...signal, label: signal.status }));
  const assignedAmbulance = ambulances.find((ambulance) => ambulance.id === mission.ambulanceId);
  const assignedHospital = hospitals.find((hospital) => hospital.id === mission.hospitalId);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-7xl">
        <aside className="mb-6 rounded-[24px] border border-slate-800 bg-slate-900/85 p-4 backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-orange-500/15 p-2 text-orange-200">
                <HeartPulse className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">RescueFlow</p>
                <p className="text-sm font-medium text-white">Emergency command center</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={classNames('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium', socketConnected ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-200')}>
                <span className={classNames('h-2 w-2 rounded-full', socketConnected ? 'bg-emerald-400' : 'bg-amber-400')} />
                {socketConnected ? 'Live synchronized' : 'Reconnecting'}
              </span>
              <button type="button" onClick={onLogout} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">Logout</button>
            </div>
          </div>
        </aside>

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <KpiCard label="Total missions" value={String(stats.totalMissions)} icon={<Activity className="h-4 w-4" />} />
          <KpiCard label="Active ambulances" value={String(stats.activeAmbulances)} icon={<Siren className="h-4 w-4" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_0.7fr]">
          <div className="space-y-6">
            <div className="overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900/80">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Live emergency map</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">Road network overview</h3>
                </div>
                <button type="button" className="rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-200">AI route live</button>
              </div>
              <div className="h-[420px]">
                <MapPanel mission={mission} signals={signals} hospitals={hospitals} events={events} onEventSelect={onViewEvent} />
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-[24px] border border-slate-800 bg-slate-900/80 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Mission details</p>
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between"><span>Mission</span><strong className="text-white">{mission.missionCode}</strong></div>
                  <div className="flex items-center justify-between"><span>Status</span><span className="rounded-full bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-200">{mission.status}</span></div>
                  <div className="flex items-center justify-between"><span>ETA</span><strong className="text-white">{mission.estimatedArrivalTime}</strong></div>
                  <div className="flex items-center justify-between"><span>Distance</span><strong className="text-white">{mission.distanceRemaining.toFixed(1)} km</strong></div>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-800 bg-slate-900/80 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Smart traffic signals</p>
                <div className="mt-4 space-y-3">
                  {signalSummary.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                      <span className="text-slate-200">{item.name}</span>
                      <span className={classNames('rounded-full px-2 py-1 text-[10px] font-semibold uppercase', routeStyles[item.status])}>{item.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-[24px] border border-slate-800 bg-slate-900/80 p-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Live event reports</p>
                  <p className="mt-1 text-sm text-slate-300">{events.filter((event) => !['RESOLVED', 'CANCELLED', 'FALSE_REPORT'].includes(event.status)).length} require attention</p>
                </div>
                <Link to="/events" className="text-xs font-semibold text-orange-300 hover:text-orange-200">View history</Link>
              </div>
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                {events.slice(0, 5).map((event) => (
                  <button key={event.id} type="button" onClick={() => onViewEvent(event.id)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-3 text-left transition hover:border-orange-400/50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white">{event.title}</span>
                      <span className="mt-1 block text-xs text-slate-400">{event.eventCode} · {event.eventType.replaceAll('_', ' ')}</span>
                    </span>
                    <EventStatusBadge status={event.status} severity={event.severity} />
                  </button>
                ))}
                {events.length === 0 && <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">No events have been reported.</p>}
              </div>
            </section>
            <div className="rounded-[24px] border border-slate-800 bg-slate-900/80 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Active ambulance</p>
              <div className="mt-4 flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="rounded-xl bg-red-500/10 p-3 text-red-200"><Siren className="h-6 w-6" /></div>
                <div>
                  <p className="text-lg font-semibold text-white">{assignedAmbulance?.vehicleNumber ?? 'No ambulance assigned'}</p>
                  <p className="text-sm text-slate-400">Driver: {assignedAmbulance?.driverName ?? '—'}</p>
                </div>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <div className="flex items-center justify-between"><span>Priority</span><span className="font-medium text-orange-300">{mission.priority}</span></div>
                <div className="flex items-center justify-between"><span>Route</span><span className="font-medium text-white">{mission.routeName ?? 'No route selected'}</span></div>
                <div className="flex items-center justify-between"><span>Hospital</span><span className="font-medium text-white">{assignedHospital?.name ?? 'No hospital assigned'}</span></div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-800 bg-slate-900/80 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Hospital readiness</p>
              <div className="mt-4 space-y-2">
                {hospitals.slice(0, 3).map((hospital) => (
                  <div key={hospital.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-3">
                    <div>
                      <p className="font-medium text-white">{hospital.name}</p>
                      <p className="text-xs text-slate-400">{hospital.emergencyBeds} emergency beds</p>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-200">{hospital.availabilityStatus}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AmbulanceDashboard({ mission, ambulances, hospitals, signals, onStartMission, onLogout }: { mission: Mission; ambulances: Ambulance[]; hospitals: Hospital[]; signals: Signal[]; onStartMission: () => void; onLogout: () => void }) {
  const assignedAmbulance = ambulances.find((ambulance) => ambulance.id === mission.ambulanceId);
  const destinationHospital = hospitals.find((hospital) => hospital.id === mission.hospitalId);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-5xl rounded-[28px] border border-slate-800 bg-slate-900/80 p-6 backdrop-blur-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Ambulance</p>
            <h2 className="mt-2 text-3xl font-bold text-white">Mission control</h2>
          </div>
          <button type="button" onClick={onLogout} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">Logout</button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            <div className="rounded-[24px] border border-slate-800 bg-slate-950/80 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Emergency status</span>
                <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-200">{mission.status}</span>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <ValueBox title="Destination" value={destinationHospital?.name ?? 'No hospital assigned'} />
                <ValueBox title="ETA" value={mission.estimatedArrivalTime} />
                <ValueBox title="Distance" value={`${mission.distanceRemaining.toFixed(1)} km`} />
                <ValueBox title="Corridor" value={mission.routeName ?? 'No route selected'} />
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-800 bg-slate-950/80 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Upcoming traffic signals</p>
              <div className="mt-4 space-y-3">
                {signals.slice(0, 3).map((signal) => (
                  <div key={signal.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2">
                    <span className="text-slate-200">{signal.name}</span>
                    <span className={classNames('rounded-full px-2 py-1 text-[10px] font-semibold uppercase', routeStyles[signal.status])}>{signal.status.replaceAll('_', ' ')}</span>
                  </div>
                ))}
                {signals.length === 0 && <p className="text-sm text-slate-400">No traffic signal data is available.</p>}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-800 bg-slate-950/80 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-red-500/10 p-3 text-red-200"><Siren className="h-6 w-6" /></div>
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Mission</p>
                <h3 className="text-xl font-semibold text-white">{mission.missionCode}</h3>
              </div>
            </div>
            <button type="button" onClick={onStartMission} className="mt-3 w-full rounded-2xl bg-gradient-to-r from-red-500 to-orange-500 px-6 py-4 text-lg font-bold text-white shadow-xl shadow-red-500/20">
              🚨 START EMERGENCY MISSION
            </button>
            <div className="mt-6 space-y-3 text-sm">
              <InfoLine label="Vehicle" value={assignedAmbulance?.vehicleNumber ?? 'Not assigned'} />
              <InfoLine label="Driver" value={assignedAmbulance?.driverName ?? 'Not assigned'} />
              <InfoLine label="Emergency" value={mission.emergencyType} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HospitalDashboard({ mission, hospitals, onAcceptMission, onUpdateCapacity, onLogout }: { mission: Mission; hospitals: Hospital[]; onAcceptMission: () => void; onUpdateCapacity: (hospitalId: string, emergencyBeds: number) => void; onLogout: () => void }) {
  const assignedHospital = hospitals.find((hospital) => hospital.id === mission.hospitalId);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-5xl rounded-[28px] border border-slate-800 bg-slate-900/80 p-6 backdrop-blur-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Hospital operations</p>
            <h2 className="mt-2 text-3xl font-bold text-white">Incoming emergency</h2>
          </div>
          <button type="button" onClick={onLogout} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">Logout</button>
        </div>

        <div className="rounded-[24px] border border-red-500/30 bg-gradient-to-br from-red-500/10 to-slate-900 p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-red-200">🚨 Incoming emergency</p>
          <h3 className="mt-4 text-3xl font-bold text-white">Ambulance: {mission.ambulanceId.toUpperCase()}</h3>
          <p className="mt-3 text-slate-200">Emergency: {mission.emergencyType}</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <ValueBox title="ETA" value={mission.estimatedArrivalTime} />
            <ValueBox title="Status" value={mission.status} />
            <ValueBox title="Beds" value={assignedHospital ? String(assignedHospital.emergencyBeds) : 'Unavailable'} />
          </div>
          <div className="mt-6 flex flex-wrap gap-4">
            <button type="button" onClick={onAcceptMission} className="rounded-full bg-emerald-500 px-5 py-3 font-semibold text-emerald-950">✓ ACCEPT & PREPARE</button>
            {assignedHospital && <button type="button" onClick={() => onUpdateCapacity(assignedHospital.id, Math.max(0, assignedHospital.emergencyBeds - 1))} className="rounded-full border border-slate-600 bg-slate-900/80 px-5 py-3 font-semibold text-slate-100">🛏 Decrease available beds</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrafficDashboard({ mission, signals, onUpdateSignal, onLogout }: { mission: Mission; signals: Signal[]; onUpdateSignal: (signalId: string, status: SignalStatus) => void; onLogout: () => void }) {
  const routeTitle = mission.missionCode;
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-6xl rounded-[28px] border border-slate-800 bg-slate-900/80 p-6 backdrop-blur-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Traffic network</p>
            <h2 className="mt-2 text-3xl font-bold text-white">Emergency corridor</h2>
            <p className="mt-2 text-sm text-slate-400">Mission: {routeTitle}</p>
          </div>
          <button type="button" onClick={onLogout} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">Logout</button>
        </div>

        <div className="mb-6 flex items-center gap-3 text-lg text-slate-200">
          <span>🚑</span>
          <div className="flex flex-wrap items-center gap-3">
            {signals.slice(0, 4).map((signal, index) => (
              <div key={signal.id} className="flex items-center gap-2">
                <span>→</span>
                <span className="rounded-full bg-slate-800 px-2 py-1 text-xs">{signal.name}</span>
                {index < 3 && <span>→</span>}
              </div>
            ))}
            <span>🏥</span>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {signals.map((signal) => (
            <div key={signal.id} className="rounded-[22px] border border-slate-800 bg-slate-950/80 p-5">
              <div className="flex items-center justify-between">
                <p className="font-medium text-white">{signal.name}</p>
                <span className={classNames('rounded-full px-2 py-1 text-[10px] font-semibold uppercase', routeStyles[signal.status])}>{signal.status}</span>
              </div>
              <div className="mt-4 h-2 rounded-full bg-slate-800">
                <div className={classNames('h-full rounded-full', signal.status === 'EMERGENCY_PRIORITY' ? 'w-full bg-red-500' : signal.status === 'PREPARING' ? 'w-2/3 bg-amber-400' : 'w-1/3 bg-emerald-400')} />
              </div>
              <label className="mt-4 block text-xs text-slate-400" htmlFor={`signal-${signal.id}`}>Signal state</label>
              <select id={`signal-${signal.id}`} value={signal.status} onChange={(event) => onUpdateSignal(signal.id, event.target.value as SignalStatus)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
                <option value="NORMAL">Normal</option>
                <option value="PREPARING">Preparing</option>
                <option value="EMERGENCY_PRIORITY">Emergency priority</option>
                <option value="AMBULANCE_PASSED">Ambulance passed</option>
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PublicAlertPage({ mission, onLogout }: { mission: Mission; onLogout: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-md rounded-[28px] border border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-slate-900 p-6 shadow-2xl shadow-orange-950/20">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.35em] text-orange-200">Public alert</p>
          <button type="button" onClick={onLogout} className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200">Logout</button>
        </div>
        <h2 className="text-3xl font-bold text-white">🚨 AMBULANCE APPROACHING</h2>
        <div className="mt-6 space-y-4 rounded-2xl border border-slate-700 bg-slate-950/80 p-4 text-sm">
          <InfoLine label="Distance" value="500 meters" />
          <InfoLine label="Direction" value="Northbound" />
          <InfoLine label="Route" value={mission.routeName ?? 'No route selected'} />
        </div>
        <p className="mt-6 leading-7 text-slate-200">Please give way and keep the emergency corridor clear. Follow the local traffic guidance and remain calm while the ambulance passes.</p>
      </div>
    </div>
  );
}

function DemoModePage({ onStart }: { onStart: () => void }) {
  const steps = [
    'Emergency created',
    'Admin notified',
    'Hospital notified',
    'Hospital ready',
    'Traffic corridor prepared',
    'Ambulance starts',
    'Signals activate',
    'Public alert sent',
    'Ambulance arrives',
    'Mission completed',
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-4xl rounded-[28px] border border-slate-800 bg-slate-900/80 p-8 backdrop-blur-xl">
        <p className="text-xs uppercase tracking-[0.35em] text-orange-300">Demo mode</p>
        <h2 className="mt-4 text-4xl font-bold text-white">🎬 Full simulation</h2>
        <button type="button" onClick={onStart} className="mt-6 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-6 py-3 font-semibold text-white">▶ START FULL SIMULATION</button>
        <div className="mt-8 space-y-4">
          {steps.map((step, index) => (
            <div key={step} className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/15 text-sm font-bold text-orange-200">{index + 1}</div>
              <span className="text-slate-200">{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AiPage({ mission }: { mission: Mission }) {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl rounded-[28px] border border-slate-800 bg-slate-900/80 p-6 backdrop-blur-xl">
        <p className="text-xs uppercase tracking-[0.35em] text-orange-300">AI intelligence</p>
        <h2 className="mt-4 text-4xl font-bold text-white">Route optimization engine</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-4">
          <AiPill label="GPS tracking" status="Live" />
          <AiPill label="Traffic analysis" status="Stable" />
          <AiPill label="Route optimization" status="Recommended" />
          <AiPill label="Signal prediction" status="Active" />
        </div>

        <div className="mt-8 rounded-[24px] border border-slate-800 bg-slate-950/80 p-5">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Decision pipeline</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {['GPS DATA', 'TRAFFIC DATA', 'ROUTE ANALYSIS', 'DECISION ENGINE', 'EMERGENCY CORRIDOR'].map((step) => (
              <div key={step} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-200">{step}</div>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[24px] border border-slate-800 bg-slate-950/80 p-5">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Current decision</p>
            <h3 className="mt-4 text-2xl font-semibold text-white">Route analysis</h3>
            <p className="mt-3 text-slate-300">Selected route: {mission.routeName ?? 'Not available'}. Route scoring uses seeded simulation data, not live traffic predictions.</p>
          </div>
          <div className="rounded-[24px] border border-slate-800 bg-slate-950/80 p-5">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Mission insight</p>
            <div className="mt-4 space-y-4 text-sm text-slate-300">
              <InfoLine label="Mission" value={mission.missionCode} />
              <InfoLine label="Priority" value={mission.priority} />
              <InfoLine label="ETA" value={mission.estimatedArrivalTime} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventLocationPicker({ latitude, longitude, onSelect }: { latitude: number | null; longitude: number | null; onSelect: (latitude: number, longitude: number) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [77.611, 12.972],
      zoom: 11,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('click', (click) => onSelectRef.current(click.lngLat.lat, click.lngLat.lng));
    map.on('error', () => setMapError(true));
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || latitude === null || longitude === null) return;
    if (!markerRef.current) markerRef.current = new maplibregl.Marker({ color: '#fb923c' });
    markerRef.current.setLngLat([longitude, latitude]).addTo(map);
    map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14), duration: 500 });
  }, [latitude, longitude]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-700">
      <div ref={containerRef} className="h-52 w-full" />
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-slate-950/85 px-3 py-1 text-[10px] text-slate-200">Click map to choose event location</span>
      {mapError && <span role="status" className="absolute right-2 top-2 rounded-lg bg-slate-950/90 px-2 py-1 text-[10px] text-amber-200">Map tiles unavailable; use coordinates or current location.</span>}
    </div>
  );
}

function EventReportModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (input: Omit<EventReport, 'id' | 'eventCode' | 'status' | 'reporterRole' | 'missionId' | 'createdAt' | 'updatedAt'>) => Promise<EventReport>;
}) {
  const [step, setStep] = useState(1);
  const [eventType, setEventType] = useState<EventType>('MEDICAL_EMERGENCY');
  const [severity, setSeverity] = useState<EventSeverity>('HIGH');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submittedEvent, setSubmittedEvent] = useState<EventReport | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (step < 3) {
      if (step === 1 && !title.trim()) {
        setError('Enter a short event title to continue.');
        return;
      }
      if (step === 2 && ((latitude === null) !== (longitude === null) || (latitude === null && !address.trim()))) {
        setError('Choose a map location, use current location, or enter a location address.');
        return;
      }
      setStep((current) => current + 1);
      return;
    }

    setSaving(true);
    try {
      const report = await onSubmit({ title: title.trim(), description: description.trim(), notes: notes.trim(), eventType, severity, latitude, longitude, address: address.trim() });
      setSubmittedEvent(report);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit the event report.');
    } finally {
      setSaving(false);
    }
  }

  function useCurrentLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError('This browser does not support location access. Choose a point on the map or enter coordinates.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
      },
      () => setError('Location access was unavailable. Choose a point on the map or enter the location manually.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <motion.section role="dialog" aria-modal="true" aria-labelledby="report-event-title" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-300">Emergency coordination · Step {submittedEvent ? 3 : step} of 3</p>
            <h2 id="report-event-title" className="mt-2 text-2xl font-bold text-white">{submittedEvent ? 'Report submitted' : 'Report an event'}</h2>
          </div>
          {!submittedEvent && <button type="button" onClick={onClose} aria-label="Close event form" className="rounded-full border border-slate-700 p-2 text-slate-300 hover:text-white"><X className="h-4 w-4" /></button>}
        </div>

        {submittedEvent ? (
          <div className="mt-6">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
              <p className="flex items-center gap-2 font-semibold text-emerald-200"><Check className="h-5 w-5" /> Event successfully reported</p>
              <p className="mt-3 text-sm text-slate-200">Event ID: <strong>{submittedEvent.eventCode}</strong></p>
              <p className="mt-2 text-sm text-slate-300">Emergency networks have been notified. {submittedEvent.status === 'UNVERIFIED' ? 'This public report is awaiting admin verification.' : 'The event is now visible in event history.'}</p>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200">Close</button>
              <Link to={`/events/${submittedEvent.id}`} onClick={onClose} className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">View event</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <div className="mt-6">
              <div className="mb-5 flex gap-2" aria-label="Report steps">
                {[1, 2, 3].map((stepNumber) => <span key={stepNumber} className={classNames('h-1.5 flex-1 rounded-full', stepNumber <= step ? 'bg-orange-400' : 'bg-slate-700')} />)}
              </div>
              {step === 1 && (
                <motion.div key="step-1" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  <label className="block text-sm text-slate-300">Event type
                    <select value={eventType} onChange={(change) => setEventType(change.target.value as EventType)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white">
                      {(Object.keys(eventTypeLabels) as EventType[]).map((type) => <option key={type} value={type}>{eventTypeLabels[type]}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm text-slate-300">Event title
                    <input value={title} onChange={(change) => setTitle(change.target.value)} maxLength={120} required placeholder="e.g. Road accident near city centre" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500" />
                    <span className="mt-1 block text-right text-xs text-slate-500">{title.length}/120</span>
                  </label>
                </motion.div>
              )}
              {step === 2 && (
                <motion.div key="step-2" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <label className="min-w-52 flex-1 text-sm text-slate-300">Severity
                      <select value={severity} onChange={(change) => setSeverity(change.target.value as EventSeverity)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white">
                        {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as EventSeverity[]).map((level) => <option key={level} value={level}>{level}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={useCurrentLocation} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-200 hover:border-orange-400"><LocateFixed className="h-4 w-4" />Use current location</button>
                  </div>
                  <EventLocationPicker latitude={latitude} longitude={longitude} onSelect={(nextLatitude, nextLongitude) => { setLatitude(nextLatitude); setLongitude(nextLongitude); }} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-slate-400">Latitude
                      <input type="number" step="any" min="-90" max="90" value={latitude ?? ''} onChange={(change) => setLatitude(change.target.value === '' ? null : Number(change.target.value))} placeholder="Click map or enter latitude" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-600" />
                    </label>
                    <label className="text-xs text-slate-400">Longitude
                      <input type="number" step="any" min="-180" max="180" value={longitude ?? ''} onChange={(change) => setLongitude(change.target.value === '' ? null : Number(change.target.value))} placeholder="Click map or enter longitude" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-600" />
                    </label>
                  </div>
                  <label className="block text-sm text-slate-300">Location address <span className="text-xs text-slate-500">(optional when coordinates are provided)</span>
                    <input value={address} onChange={(change) => setAddress(change.target.value)} maxLength={240} placeholder="Street, landmark, or area" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500" />
                  </label>
                </motion.div>
              )}
              {step === 3 && (
                <motion.div key="step-3" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm">
                    <p className="font-semibold text-white">{title}</p>
                    <p className="mt-1 text-slate-400">{eventTypeLabels[eventType]} · {severity}</p>
                    <p className="mt-1 text-slate-400">{address || (latitude !== null && longitude !== null ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : '')}</p>
                  </div>
                  <label className="block text-sm text-slate-300">Description <span className="text-xs text-slate-500">(optional)</span>
                    <textarea value={description} onChange={(change) => setDescription(change.target.value)} maxLength={2000} rows={4} placeholder="Describe what happened and any immediate hazards." className="mt-2 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500" />
                  </label>
                  <label className="block text-sm text-slate-300">Additional notes <span className="text-xs text-slate-500">(optional)</span>
                    <textarea value={notes} onChange={(change) => setNotes(change.target.value)} maxLength={1000} rows={2} placeholder="Share other relevant, non-sensitive details." className="mt-2 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500" />
                  </label>
                  <p className="text-xs leading-5 text-slate-500">Do not include patient names or other sensitive personal information. Reports submitted by public users remain unverified until reviewed by an administrator.</p>
                </motion.div>
              )}
            </div>

            {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
            <div className="mt-6 flex justify-between gap-3">
              <button type="button" disabled={step === 1 || saving} onClick={() => { setError(null); setStep((current) => current - 1); }} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-40">Back</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Submitting…' : step < 3 ? 'Continue' : 'Submit report'}</button>
            </div>
          </form>
        )}
      </motion.section>
    </div>
  );
}

function EventStatusBadge({ status, severity }: { status: EventStatus; severity?: EventSeverity }) {
  const tone = status === 'FALSE_REPORT' || status === 'CANCELLED'
    ? 'border-slate-700 bg-slate-800 text-slate-300'
    : severity === 'CRITICAL'
      ? 'border-red-500/30 bg-red-500/10 text-red-200'
      : status === 'UNVERIFIED'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  return <span className={classNames('inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide', tone)}>{status.replaceAll('_', ' ')}</span>;
}

function NotificationBell({ notifications, onSelect }: { notifications: NotificationRecord[]; onSelect: (notification: NotificationRecord) => void }) {
  const [open, setOpen] = useState(false);
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <div className="relative">
      <button type="button" aria-label={`Notifications, ${unreadCount} unread`} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-700 text-slate-200 transition hover:border-orange-400">
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-5 text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications" className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {notifications.slice(0, 12).map((notification) => (
              <button key={notification.id} type="button" onClick={() => { setOpen(false); onSelect(notification); }} className={classNames('mb-1 w-full rounded-xl p-3 text-left transition hover:bg-slate-900', !notification.read && 'bg-orange-500/5')}>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">{notification.title}</span>
                  {!notification.read && <span className="h-2 w-2 shrink-0 rounded-full bg-orange-400" />}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">{notification.message}</span>
              </button>
            ))}
            {notifications.length === 0 && <p className="p-5 text-center text-sm text-slate-400">You’re all caught up.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function EventHistoryPage({ events, ready, onViewEvent }: { events: EventReport[]; ready: boolean; onViewEvent: (eventId: string) => void }) {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <Link to="/" className="text-sm text-slate-400 hover:text-white">← RescueFlow</Link>
        <div className="mt-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-orange-300">Incident response</p>
            <h1 className="mt-2 text-3xl font-bold text-white">Event history</h1>
          </div>
          <p className="text-sm text-slate-400">{events.length} {events.length === 1 ? 'report' : 'reports'}</p>
        </div>
        <div className="mt-6 space-y-3">
          {!ready && <p className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-slate-300">Loading event history…</p>}
          {ready && events.length === 0 && <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">No event reports yet. Use Report event to submit an incident.</p>}
          {events.map((event) => (
            <motion.button key={event.id} type="button" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onClick={() => onViewEvent(event.id)} className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 text-left transition hover:border-orange-400/50">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-white">{event.title}</span>
                <span className="mt-1 block text-xs text-slate-400">{event.eventCode} · {eventTypeLabels[event.eventType]} · {new Date(event.createdAt).toLocaleString()}</span>
                {event.address && <span className="mt-2 flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3 w-3" />{event.address}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-2">
                <EventStatusBadge status={event.status} severity={event.severity} />
                <span className="text-[10px] font-semibold uppercase text-slate-400">{event.severity}</span>
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </main>
  );
}

const nextEventStatuses: Record<EventStatus, EventStatus[]> = {
  UNVERIFIED: ['VERIFIED', 'FALSE_REPORT', 'CANCELLED'],
  REPORTED: ['VERIFIED', 'FALSE_REPORT', 'CANCELLED'],
  VERIFIED: ['RESPONDERS_ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  RESPONDERS_ASSIGNED: ['IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
  IN_PROGRESS: ['RESOLVED', 'CANCELLED'],
  RESOLVED: [],
  CANCELLED: [],
  FALSE_REPORT: [],
};

function EventDetailsPage({ events, token, user, ambulances, hospitals, onChangeStatus, onCreateMission }: {
  events: EventReport[];
  token: string | null;
  user: User | null;
  ambulances: Ambulance[];
  hospitals: Hospital[];
  onChangeStatus: (eventId: string, status: EventStatus) => Promise<EventReport>;
  onCreateMission: (eventId: string, ambulanceId: string, hospitalId: string) => Promise<{ event: EventReport; mission: Mission }>;
}) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [loadedEvent, setLoadedEvent] = useState<EventReport | null>(null);
  const [activity, setActivity] = useState<EventActivity[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<EventStatus | ''>('');
  const [ambulanceId, setAmbulanceId] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [loadedEventId, setLoadedEventId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const event = events.find((entry) => entry.id === id || entry.eventCode === id) ?? loadedEvent;
  const loading = loadedEventId !== id;
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!token || !id) return;
    let cancelled = false;
    void fetchJson<{ event: EventReport; activity: EventActivity[] }>(`${API_BASE}/api/events/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => {
      if (cancelled) return;
      setLoadedEvent(response.event);
      setActivity(response.activity);
    }).catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load event details.');
    }).finally(() => {
      if (!cancelled) setLoadedEventId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  async function updateStatus(status: EventStatus) {
    if (!event) return;
    setSaving(true);
    setError(null);
    try {
      await onChangeStatus(event.id, status);
      const response = await fetchJson<{ event: EventReport; activity: EventActivity[] }>(`${API_BASE}/api/events/${encodeURIComponent(event.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLoadedEvent(response.event);
      setActivity(response.activity);
      setSelectedStatus('');
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to update the event.');
    } finally {
      setSaving(false);
    }
  }

  async function createMission() {
    if (!event) return;
    setSaving(true);
    setError(null);
    try {
      await onCreateMission(event.id, ambulanceId, hospitalId);
      navigate('/admin');
    } catch (missionError) {
      setError(missionError instanceof Error ? missionError.message : 'Unable to create the rescue mission.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !event) return <OperationalDataState ready={false} />;
  if (!event) {
    return <main className="min-h-screen bg-slate-950 p-10 text-center text-slate-200"><p>{error ?? 'Event not found.'}</p><Link to="/events" className="mt-4 inline-block text-orange-300">Return to event history</Link></main>;
  }

  const nextStatuses = nextEventStatuses[event.status];
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <Link to="/events" className="text-sm text-slate-400 hover:text-white">← Event history</Link>
        <section className="mt-5 rounded-[28px] border border-slate-800 bg-slate-900/80 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-300">{event.eventCode}</p>
              <h1 className="mt-3 text-3xl font-bold text-white">{event.title}</h1>
              <p className="mt-2 text-sm text-slate-400">{eventTypeLabels[event.eventType]}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <EventStatusBadge status={event.status} severity={event.severity} />
              <span className="text-xs font-bold uppercase" style={{ color: severityColors[event.severity] }}>{event.severity} severity</span>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <ValueBox title="Reported" value={new Date(event.createdAt).toLocaleString()} />
            <ValueBox title="Reporter role" value={event.reporterRole.replaceAll('_', ' ')} />
            <ValueBox title="Location" value={event.address || (event.latitude !== null && event.longitude !== null ? `${event.latitude.toFixed(5)}, ${event.longitude.toFixed(5)}` : 'Not provided')} />
            <ValueBox title="Linked mission" value={event.missionId ? 'Rescue mission assigned' : 'No mission assigned'} />
          </div>
          {event.description && <div className="mt-6"><h2 className="text-sm font-semibold text-slate-200">Incident description</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{event.description}</p></div>}
          {event.notes && <div className="mt-4"><h2 className="text-sm font-semibold text-slate-200">Additional notes</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{event.notes}</p></div>}
          {event.status === 'UNVERIFIED' && <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">This public report is unverified. Confirm its details before coordinating a response.</p>}
          {error && <p role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

          {isAdmin && nextStatuses.length > 0 && (
            <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-slate-800 pt-5">
              <label className="min-w-56 flex-1 text-xs text-slate-400">Update event status
                <select value={selectedStatus} onChange={(change) => setSelectedStatus(change.target.value as EventStatus | '')} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                  <option value="">Select a status…</option>
                  {nextStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
                </select>
              </label>
              <button type="button" disabled={!selectedStatus || saving} onClick={() => selectedStatus && void updateStatus(selectedStatus)} className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Update status'}</button>
            </div>
          )}

          {isAdmin && event.status === 'VERIFIED' && !event.missionId && (
            <div className="mt-6 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5">
              <h2 className="font-semibold text-white">Create rescue mission</h2>
              <p className="mt-1 text-sm text-slate-400">Assign an available ambulance and receiving hospital to this verified event.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-400">Available ambulance
                  <select value={ambulanceId} onChange={(change) => setAmbulanceId(change.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                    <option value="">Select ambulance…</option>
                    {ambulances.filter((ambulance) => ambulance.status === 'READY').map((ambulance) => <option key={ambulance.id} value={ambulance.id}>{ambulance.vehicleNumber} · {ambulance.driverName}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-400">Available hospital
                  <select value={hospitalId} onChange={(change) => setHospitalId(change.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                    <option value="">Select hospital…</option>
                    {hospitals.filter((hospital) => hospital.availabilityStatus === 'AVAILABLE').map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name} · {hospital.emergencyBeds} beds</option>)}
                  </select>
                </label>
              </div>
              <button type="button" disabled={!ambulanceId || !hospitalId || saving} onClick={() => void createMission()} className="mt-4 rounded-xl bg-gradient-to-r from-red-500 to-orange-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Creating mission…' : '🚑 Create rescue mission'}</button>
            </div>
          )}
        </section>

        <section className="mt-6 rounded-[24px] border border-slate-800 bg-slate-900/80 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Clock3 className="h-5 w-5 text-orange-300" /> Event timeline</h2>
          <div className="mt-5 space-y-4">
            {activity.map((entry) => (
              <div key={entry.id} className="relative border-l border-slate-700 pl-5">
                <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-orange-400" />
                <p className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()} · {entry.actorRole.replaceAll('_', ' ')}</p>
                <p className="mt-1 text-sm text-slate-200">{entry.description}</p>
              </div>
            ))}
            {activity.length === 0 && <p className="text-sm text-slate-400">No event history is available.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/30">
      <div className="mb-3 flex items-center justify-between text-slate-300">
        <span className="text-sm">{label}</span>
        <span className="rounded-lg border border-slate-700 bg-slate-950 p-2">{icon}</span>
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

function ValueBox({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{title}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur-xl">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

function AiPill({ label, status }: { label: string; status: string }) {
  return (
    <div className="rounded-[22px] border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{label}</p>
      <p className="mt-3 text-lg font-semibold text-white">{status}</p>
    </div>
  );
}

function MapPanel({ mission, signals, hospitals, events, onEventSelect }: { mission: Mission; signals: Signal[]; hospitals: Hospital[]; events: EventReport[]; onEventSelect: (eventId: string) => void }) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const ambulanceMarkerRef = useRef<maplibregl.Marker | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const eventMarkersRef = useRef<maplibregl.Marker[]>([]);
  const onEventSelectRef = useRef(onEventSelect);
  const [mapReady, setMapReady] = useState(false);
  const positionRef = useRef<[number, number]>([mission.currentLongitude, mission.currentLatitude]);
  const operationalDataRef = useRef({ signals, hospitals });

  useEffect(() => {
    onEventSelectRef.current = onEventSelect;
  }, [onEventSelect]);

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [77.611, 12.972],
      zoom: 12,
      pitch: 45,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      setMapReady(true);
      const position = positionRef.current;
      const routeCoords = [
        [77.5946, 12.9716],
        [77.6006, 12.9738],
        [77.6074, 12.9751],
        [77.6151, 12.9766],
        [77.6211, 12.9759],
      ];

      map.addSource('emergency-route', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: routeCoords },
          }],
        },
      });

      map.addLayer({
        id: 'route-layer',
        type: 'line',
        source: 'emergency-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#f97316',
          'line-width': 5,
        },
      });

      const markCoords = [
        ...operationalDataRef.current.signals.map((signal) => ({ ...signal, color: '#60a5fa' })),
        ...operationalDataRef.current.hospitals.map((hospital) => ({ ...hospital, color: '#34d399' })),
      ];

      markCoords.forEach((item) => {
        const marker = new maplibregl.Marker({ color: item.color })
          .setLngLat([item.longitude, item.latitude])
          .addTo(map);

        marker.getElement().title = item.name ?? 'Feature';
      });

      ambulanceMarkerRef.current = new maplibregl.Marker({ color: '#fb7185' })
        .setLngLat(position)
        .addTo(map);
      map.flyTo({ center: position, zoom: 14, speed: 1.2 });
    });

    return () => {
      ambulanceMarkerRef.current?.remove();
      ambulanceMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      eventMarkersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    eventMarkersRef.current.forEach((marker) => marker.remove());
    eventMarkersRef.current = events
      .filter((event): event is EventReport & { latitude: number; longitude: number } =>
        event.latitude !== null && event.longitude !== null && !['CANCELLED', 'FALSE_REPORT'].includes(event.status))
      .map((event) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = `event-map-marker event-map-marker--${event.severity.toLowerCase()}`;
        element.textContent = '!';
        element.setAttribute('aria-label', `${event.severity} ${eventTypeLabels[event.eventType]}: ${event.title}`);

        const popupContent = document.createElement('div');
        popupContent.className = 'min-w-40 text-slate-950';
        const heading = document.createElement('strong');
        heading.textContent = event.title;
        const details = document.createElement('p');
        details.textContent = `${event.eventCode} · ${event.severity} · ${event.status.replaceAll('_', ' ')}`;
        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'mt-2 font-semibold text-orange-700';
        view.textContent = 'View event';
        view.addEventListener('click', () => onEventSelectRef.current(event.id));
        popupContent.append(heading, details, view);

        const popup = new maplibregl.Popup({ offset: 18 }).setDOMContent(popupContent);
        const marker = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([event.longitude, event.latitude])
          .setPopup(popup)
          .addTo(map);
        element.addEventListener('click', () => onEventSelectRef.current(event.id));
        return marker;
      });
  }, [events, mapReady]);

  useEffect(() => {
    operationalDataRef.current = { signals, hospitals };
  }, [hospitals, signals]);

  useEffect(() => {
    const position: [number, number] = [mission.currentLongitude, mission.currentLatitude];
    positionRef.current = position;
    ambulanceMarkerRef.current?.setLngLat(position);
  }, [mission.currentLatitude, mission.currentLongitude]);

  return <div ref={mapContainer} className="h-full w-full" />;
}

function CityScene() {
  return (
    <Canvas camera={{ position: [0, 4, 8], fov: 45 }}>
      <CitySceneContent />
    </Canvas>
  );
}

function CitySceneContent() {
  const meshRef = useRef<THREE.Mesh | null>(null);
  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y = state.clock.elapsedTime * 0.35;
  });

  return (
    <>
      <ambientLight intensity={1.3} color="#dbeafe" />
      <directionalLight position={[5, 9, 5]} intensity={2} color="#fbbf24" />
      <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.8}>
        <mesh ref={meshRef} position={[0, 0.2, 0]}>
          <boxGeometry args={[1.5, 0.6, 1]} />
          <meshStandardMaterial color="#f97316" metalness={0.6} roughness={0.2} />
        </mesh>
      </Float>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]}>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>

      {[[-3, -0.2, 0], [0, -0.2, 0], [3, -0.2, 0]].map((pos, index) => (
        <mesh key={index} position={pos as [number, number, number]}>
          <boxGeometry args={[2.4, 0.3, 0.7]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
      ))}

      {[[-4, 0, 3], [4, 0, 3], [0, 0, -3]].map((pos, index) => (
        <mesh key={index} position={pos as [number, number, number]}>
          <boxGeometry args={[0.8, 1.4, 0.8]} />
          <meshStandardMaterial color="#94a3b8" />
        </mesh>
      ))}

      {[[[-3, 0.1, 0], [0, 0.5, 0], [3, 0.1, 0]], [[-2, 0.1, 2], [0, 0.5, 1], [2, 0.1, 2]], [[-2, 0.1, -2], [0, 0.5, -1], [2, 0.1, -2]]].map((points, index) => (
        <line key={index}>
          <bufferGeometry attach="geometry" setFromPoints={points.map((point) => new THREE.Vector3(point[0], point[1], point[2]))} />
          <lineBasicMaterial attach="material" color="#f97316" linewidth={2} />
        </line>
      ))}
    </>
  );
}

export default App;
