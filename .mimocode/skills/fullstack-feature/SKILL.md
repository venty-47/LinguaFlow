---
name: fullstack-feature
description: "Add a new full-stack feature to LinguaFlow (Go Gin backend + Next.js frontend). Follows the proven sequence: read models → implement handler → register route → add frontend types/API → build UI component → dual verification."
---

# Full-Stack Feature Workflow

Step-by-step playbook for adding a new feature to LinguaFlow. Based on repeated patterns from wordbook enhancement and daily sentence implementation sessions.

## Prerequisites

- Read `docs/development/gin-backend.md` before backend changes
- Read `docs/development/nextjs-frontend.md` before frontend changes
- These docs are binding — follow their conventions exactly

## Step 1: Understand the data model

```
Read backend/models/models.go
```

- Find or add the GORM model for the new feature
- Check existing models for similar patterns (e.g., wordbook, article, video)
- Note field names, JSON tags, indexes, and foreign keys

## Step 2: Implement the backend handler

```
Read backend/handlers/<existing_similar>.go   # learn the pattern
Create/Edit backend/handlers/<feature>.go
```

Handler rules (from gin-backend.md):
- Read from `gin.Context`, call service/GORM, return unified JSON
- Keep business logic in `services/` — handlers do HTTP + validation only
- Use `middleware.go` for auth/admin/premium gates

## Step 3: Register routes in main.go

```
Read backend/main.go
Edit backend/main.go — add route group registration
```

Pattern from existing code:
```go
// Find the route group section, add:
featureGroup := api.Group("/feature")
featureGroup.Use(middleware.AuthRequired())
{
    featureGroup.GET("/", handlers.ListFeature)
    featureGroup.POST("/", handlers.CreateFeature)
    // etc.
}
```

**Verify backend compiles:**
```bash
cd backend && go build ./...
```

## Step 4: Add frontend types

```
Read frontend/src/types/index.ts
Edit frontend/src/types/index.ts — add/modify types
```

Rules (from nextjs-frontend.md):
- Backend JSON is snake_case → keep frontend types snake_case
- Do NOT add mapping layers
- Cross-file shared types go here; page-local types stay near the page

## Step 5: Add frontend API client

```
Read frontend/src/lib/api.ts
Edit frontend/src/lib/api.ts — add API functions
```

Pattern:
```typescript
export const featureAPI = {
  list: () => api.get<Feature[]>('/feature'),
  create: (data: CreateFeatureRequest) => api.post<Feature>('/feature', data),
  get: (id: number) => api.get<Feature>(`/feature/${id}`),
  delete: (id: number) => api.delete(`/feature/${id}`),
};
```

## Step 6: Build the frontend UI

```
Read frontend/src/app/<area>/page.tsx          # existing page
Read frontend/src/components/<similar>.tsx     # existing component pattern
Create/Edit frontend/src/components/<Feature>.tsx
Create/Edit frontend/src/app/<area>/<feature>/page.tsx
```

Component rules:
- PascalCase filenames, explicit prop interfaces
- Use Tailwind CSS, no inline styles
- Complex hooks go in `src/lib/` or `src/store/` if shared

## Step 7: Dual verification

**Backend:**
```bash
cd backend && go build ./...
cd backend && go vet ./...
```

**Frontend:**
```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

Fix any errors before proceeding. Both must pass.

## Step 8: Test manually (if applicable)

- Start backend: `cd backend && go run main.go`
- Start frontend: `cd frontend && npm run dev`
- Test the new feature end-to-end

## Common Pitfalls

1. **Route registration**: Always add the route group in `main.go` — the handler alone won't work
2. **Import cycles**: If handler imports another handler's types, move shared types to `models/` or `services/`
3. **JSON tags**: Frontend expects snake_case; if you add `json:"camelCase"` it will break the frontend
4. **Auth middleware**: Protected routes need `middleware.AuthRequired()` — check if the feature requires login
5. **Database migration**: If you add new model fields, ensure GORM auto-migrate handles them (check `database/migrate.go`)

## Example: Wordbook Feature (reference session)

The wordbook enhancement followed this exact sequence:
1. Read `models.go` for WordBook/DailyTask models
2. Edit `handlers/wordbook.go` — add new endpoints
3. Edit `main.go` — register wordbook routes
4. Edit `types/index.ts` — add WordBook types
5. Edit `api.ts` — add wordBookAPI functions
6. Create `wordAudio.ts` — audio utility
7. Rewrite `LearnCard.tsx` — main learning UI
8. Edit `learn/page.tsx` — page integration
9. Verify: `go build ./...` + `npx tsc --noEmit`
