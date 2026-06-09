# Repository Guidelines

## Project Structure & Module Organization

This repository contains a full-stack English learning platform. The backend lives in `backend/` and is a Go 1.22 Gin service. Use `backend/handlers/` for HTTP endpoints, `backend/services/` for external integrations and shared business logic, `backend/middleware/` for auth/admin/premium gates, `backend/models/` for GORM models, `backend/database/` for PostgreSQL/Redis setup and seed data, and `backend/config/` for TOML configuration loading.

The frontend lives in `frontend/` and is a Next.js 14 App Router application. Use `frontend/src/app/` for routes, `frontend/src/components/` for reusable UI, `frontend/src/lib/` for API helpers and utilities, `frontend/src/store/` for Zustand state, and `frontend/src/types/` for shared TypeScript types. Current route areas include articles, journals/latest feeds, AO3 search/reading, study, vocabulary, subscriptions, membership, profile, and admin article management.

Detailed maintainability rules live in `docs/development/`. Read `docs/development/gin-backend.md` before backend changes and `docs/development/nextjs-frontend.md` before frontend changes. These documents are binding for AI-generated code and human maintenance work.

## Build, Test, and Development Commands

Backend:

```bash
cd backend
go mod download        # install Go dependencies
go run main.go         # run API on localhost:8080
go build ./...         # compile all backend packages
go test ./...          # run backend tests
```

Frontend:

```bash
cd frontend
npm install            # install Node dependencies
npm run dev            # run Next.js on localhost:3000
npm run build          # create production build
npm run lint           # run Next.js ESLint checks
```

Docker:

```bash
docker compose up -d   # run PostgreSQL, Redis, backend, and frontend
docker compose down    # stop local stack
```

Run Go commands from `backend/`; the repository root is not a Go module. Local development expects PostgreSQL and Redis. See `README.md`, `backend/config.toml.example`, and `docker-compose.yml` for startup details.

## Configuration

The backend uses `backend/config.toml`, not `.env`. Start from:

```bash
cd backend
cp config.toml.example config.toml
```

Important config blocks are `[database]`, `[redis]`, `[jwt]`, `[server]`, `[cors]`, `[translation]`, `[ai]`, `[tts]`, `[rss]`, `[ao3]`, and `[[rss.feeds]]`. External credentials are optional for local development, but production must use real secrets and narrow CORS origins. The frontend API base URL defaults to `http://localhost:8080/api` and can be overridden with `frontend/.env.local` via `NEXT_PUBLIC_API_URL`.

## Coding Style & Naming Conventions

Format Go code with `gofmt`; keep package names short and lowercase. Keep route handlers in `backend/handlers`, external clients/parsers in `backend/services`, and exported request/response types named with clear domain prefixes. Prefer structured parsing and typed data over ad hoc string manipulation when working with RSS, AO3 HTML, translation responses, or API payloads.

For frontend code, use TypeScript, React function components, Tailwind CSS utilities, and PascalCase component filenames such as `ArticleCard.tsx`. Keep hooks and stores camelCase, for example `authStore.ts`. Prefer typed API helpers in `frontend/src/lib/api.ts` over inline Axios/fetch calls, except where streaming or browser APIs require direct `fetch`.

## Testing Guidelines

Backend service tests already exist for AI request serialization, AO3 parsing/sanitization, RSS importing, article analysis, and dictionary merging. Add Go tests beside implementation files using the `_test.go` suffix and run `go test ./...` from `backend/`.

For frontend changes, there is no committed unit-test runner yet. Validate UI and type-sensitive changes with:

```bash
cd frontend
npm run lint
npm run build
```

If you introduce a frontend test runner, add the command to `frontend/package.json` and document it here.

## Architecture Notes

Backend startup in `backend/main.go` loads TOML config, initializes PostgreSQL and Redis, sets JWT middleware, initializes translation/dictionary/AI/TTS/RSS/AO3 services, then registers public, protected, admin, and premium-gated routes.

Translations and dictionary lookups use Redis and PostgreSQL caches before calling external providers where available. Vocabulary review uses simplified spaced repetition fields on the vocabulary model. Membership and order flows are demo-ready but payment is not fully integrated. Premium features are gated in middleware and should not be exposed without checking the current user state.

RSS and AO3 integrations call external sites. Treat these paths carefully: preserve timeouts, proxy support, sanitization, and tests; add caching, limits, or auth before expanding production exposure. Do not describe `/api/admin/rss/import` as production-safe token-protected unless the code has been updated to enforce that behavior.

## Commit & Pull Request Guidelines

Git history may be unavailable in this checkout, so use concise imperative commits such as `Add vocabulary progress endpoint` or `Fix article card metadata`. Pull requests should include a short summary, affected frontend/backend areas, linked issues when applicable, screenshots for UI changes, and the commands run for validation.

## Security & Configuration Tips

Do not commit `config.toml`, `.env*` files, JWT secrets, database credentials, translation API keys, AI/TTS API keys, or production CORS settings. Keep allowed CORS origins narrow in production. Be careful with admin and import routes, user-uploaded assets, external HTML sanitization, and logs that might contain tokens, API responses, or private user text.
