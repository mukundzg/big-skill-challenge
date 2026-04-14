# Admin console (React + Vite)

1. Set `ADMIN_JWT_SECRET` in `backend/.env` for production.
2. Copy `.env.example` to `.env` and set `VITE_API_BASE` to your FastAPI URL.
3. `npm install` / `npm run dev` — open the URL shown; the first-time bootstrap code is printed in the **Python** terminal where uvicorn runs.

Run MySQL migration `backend/sql/004_admin_users.sql` if you use admin accounts.

## Sections

- **Overview** — aggregate stats and status distribution (from `attempts`).
- **Quiz settings** — view/update the `quiz_settings` row (max attempts, seconds per question, marks per question, questions per attempt).
- **Aptitude analytics** — paginated table of quiz attempts (from the `attempts` table): score, status, and time taken.
- **Contest settings** — add settings, optional season dates, and deactivate rows; backend enforces only one active row on creation.
- **Administrators** — invite or disable admins.
