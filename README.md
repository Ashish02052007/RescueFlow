# RescueFlow

RescueFlow is an emergency-response coordination **demo** with role-based dashboards, a simulated ambulance mission, real-time Socket.IO updates, and SQLite persistence. It is an academic/demo project, not a medical, dispatch, or traffic-control service. Never use it to coordinate real emergencies.

## Run locally

Requirements: Node.js 22 or newer and npm.

In the first terminal:

```powershell
cd backend
Copy-Item .env.example .env
npm ci
npm run dev
```

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. The backend listens on http://localhost:4000. SQLite creates `backend/data/rescueflow.sqlite` automatically. Set `DATABASE_PATH` in `backend/.env` to select another location. Vite proxies API and WebSocket traffic to the backend during development.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@rescueflow.demo | admin123 |
| Ambulance | ambulance@rescueflow.demo | emergencyvehicle123 |
| Hospital | hospital@rescueflow.demo | hospital123 |
| Traffic controller | traffic@rescueflow.demo | traffic123 |
| Public user | public@rescueflow.demo | public123 |

These public demo credentials are intentionally seeded for demonstrations. Do not reuse them for real services or put sensitive information in this app.

## Verify builds

```powershell
cd backend
npm ci
npm run build
cd ..\frontend
npm ci
npm run lint
npm run build
```

## Deploy a hosted demo on Render

1. Push this project to a GitHub repository.
2. In Render, choose **New → Blueprint**, connect the repository, and approve the included `render.yaml`.
3. Wait for the Docker build and `/health` check to pass; Render will provide the public HTTPS URL.

The blueprint builds the frontend and backend into one service, generates a strong JWT secret, and mounts persistent storage for SQLite. It uses a paid Starter service because SQLite needs persistent disk storage. Keep it as a single instance: local SQLite is not suitable for horizontally scaled services. Back up the disk before replacing or deleting the service. Check current Render pricing before deploying.

The seeded demo passwords are public. The hosted app is only suitable for a non-sensitive submission demo; it is **not production-ready for real emergency operations or personal/medical data**. Do not deploy it for real patients, dispatch, or traffic control. Live maps require internet access; route optimization and traffic behavior use seeded simulation data.

## CI

GitHub Actions runs backend build, frontend lint, and frontend build on pushes and pull requests to `main`.

## Main API

- `GET /health` — backend and database health
- `POST /api/auth/login` — authenticate and receive a JWT
- `POST /api/auth/register` — create a public-user account
- `GET /api/missions` and `POST /api/missions` — list/create missions
- `POST /api/missions/:id/start` and `POST /api/missions/:id/complete` — control a mission
- `GET /api/events`, `POST /api/events`, and `GET /api/events/:id` — report and review incidents
- `PATCH /api/events/:id/status`, `DELETE /api/events/:id`, and `POST /api/events/:id/mission` — admin event review, cancellation, and mission conversion
- `GET /api/notifications` and `PATCH /api/notifications/:id/read` — view and acknowledge notifications
- `GET /api/ambulances`, `GET /api/hospitals`, `GET /api/traffic-signals` — read operational resources
- `PATCH /api/hospitals/:id` and `PATCH /api/traffic-signals/:id/status` — update capacity and signal state

Event reports and their activity history are stored in SQLite. Public-user reports require admin verification before mission conversion. Authenticated Socket.IO clients receive role-specific event and notification updates; public-facing payloads omit report descriptions, notes, addresses, and reporter identifiers.
