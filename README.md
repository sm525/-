# Resonance Archive — deploy-ready full-stack package

## What this is
- Public bilingual website at `/`
- Admin panel at `/admin`
- Express API and PostgreSQL schema
- Render deployment blueprint and Dockerfile
- Admin key is entered into the admin page and kept in memory only, not local storage.

## Deploy to Render
1. Create or sign in to your Render account.
2. Put this project in a Git repository you control, including `render.yaml`.
3. In Render, create a new Blueprint and select that repository.
4. Review the services and database in the Blueprint, then confirm deployment. Render will create the database, generate `ADMIN_API_KEY`, and deploy the app.
5. Once deployment finishes, open the public service URL. The site is `/`; admin is `/admin`.
6. In the Render service's Environment settings, reveal/copy the generated `ADMIN_API_KEY` and paste it into the admin page when you need to edit character records. Never share this key or put it in public code.
7. The database schema must be applied once. Open the database's SQL console and execute the contents of `schema.sql`. If your platform offers a shell, `psql "$DATABASE_URL" -f schema.sql` can be used from the project directory.
8. Verify `/health` returns `{ "ok": true, "database": "connected" }`.

## Local setup
- Node.js 20+ and PostgreSQL are required.
- Create a database and execute `schema.sql`.
- Copy `.env.example` to `.env` and set `DATABASE_URL` plus a long random `ADMIN_API_KEY` (at least 24 characters).
- `npm install` then `npm start`.
- Open `http://localhost:3000/` and `http://localhost:3000/admin`.

## Important limits
- This package is prepared for deployment, but has not been deployed because no hosting project/account has been connected in this conversation.
- It does not contain a fully populated or officially verified character roster. The database starts empty on purpose rather than mislabeling guessed data as official.
- The admin page edits character core fields and bilingual descriptions. It does not yet manage skills, materials, stat tables, or media assets.
- Before changing a record to `verified`, record a specific source URL and verification date. Use official published sources, e.g. the official Jiyan profile reveal:
  https://wutheringwaves.kurogames.com/en/main/news/detail/795
- Public visibility of official artwork does not automatically grant permission to republish it. Store only assets you have permission to use, or link to official sources.
- The generated admin API key is a shared-secret starter mechanism. For a larger public project, replace it with proper user accounts, sessions, role permissions, rate limiting, and audit-log attribution.

## API routes
Public: `GET /health`, `GET /api/characters`, `GET /api/characters/:id`
Admin (Authorization: Bearer ADMIN_API_KEY): `POST /api/characters`, `PATCH /api/characters/:id`, `DELETE /api/characters/:id`
