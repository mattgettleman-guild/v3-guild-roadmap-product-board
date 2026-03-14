# V3 Guild Roadmap

## Overview
A full-stack roadmap management application built for Guild, featuring a React frontend and Express/Node.js backend with PostgreSQL.

## Architecture
- **Monorepo** with npm workspaces: `shared`, `backend`, `frontend`
- **Frontend**: React + Vite + TanStack Router + TanStack Query, runs on port 5000
- **Backend**: Express + TypeScript (tsx), runs on port 3001 in dev
- **Database**: PostgreSQL via Drizzle ORM
- **Shared**: Common TypeScript types used by both frontend and backend

## Development Setup

### Workflow
Single workflow runs both frontend and backend concurrently:
```
npm run dev
```
- Frontend: http://localhost:5000 (Vite dev server, proxies /api to backend)
- Backend: http://localhost:3001 (Express API)

### Environment Variables
Required (set in Replit secrets or .env):
- `DATABASE_URL` - PostgreSQL connection string (provided by Replit)
- `DEV_AUTH_BYPASS=true` - Bypass auth in dev mode (allows admin access)
- `ALLOWED_EMAIL_DOMAIN=guild.com` - Domain for magic link auth
- Optional: `OPENAI_API_KEY`, `SMTP_*`, `JIRA_*` for AI/email/Jira features

### Backend .env
Located at `backend/.env`:
```
PORT=3001
DEV_AUTH_BYPASS=true
ALLOWED_EMAIL_DOMAIN=guild.com
APP_BASE_URL=http://localhost:5000
```

## Production
In production, the backend serves the built frontend static files from `frontend/dist`.
- Build: `npm run build` (builds shared, backend, then frontend)
- Start: `npm run start` (starts backend which serves static frontend)
- Port: 5000 (set via `PORT` env var)

## Database Schema
Tables (all created via Drizzle schema + migrations):
- `roadmap_rows` - Core investment/roadmap items
- `product_priorities` - V3 priority entities  
- `saved_views` - User-saved filter configurations
- `metric_definitions` - KPI/metric definitions
- `users` - User accounts (magic link auth)
- `magic_links` - Auth tokens
- `user_sessions` - Active sessions
- `taxonomy` - Pillars, priorities, domains, etc.
- `app_settings` - Application settings
- `audit_events` - Change audit log
- `telemetry_events` - Usage telemetry
- `import_jobs` - Async import job tracking
- `documents` / `document_chunks` / `document_links` - Knowledge base
- `ai_threads` / `ai_messages` / `ai_reports` - AI conversation history
- `changelog_events` - Roadmap change log

## Key Features
- Magic link email authentication (restricted to @guild.com)
- Roadmap grid/gantt view with rich filtering
- Jira integration for syncing initiative/epic data
- AI assistant (OpenAI) for roadmap Q&A
- Document knowledge base (PDF, DOCX upload + RAG)
- CSV/XLSX import with AI-powered field mapping
- Weekly email digest of roadmap changes
- External roadmap sharing (visibility levels)
- Priority briefs with AI summaries
