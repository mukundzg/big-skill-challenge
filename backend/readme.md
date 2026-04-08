# Run backend
cd /backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit `.env`: set `DATABASE_URL` or `MYSQL_HOST` / `MYSQL_DB` / `MYSQL_USER` / `MYSQL_PASSWORD` (see `.env.example`).
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Optional: Redis (recommended for Gemini cost/quota)
# If REDIS_URL is set, the server caches the Gemini-generated raw quiz questions per PDF hash,
# so the same PDF can be reused across multiple users without repeated Gemini calls.
#
# Quick start (local):
#   docker run --rm -p 6379:6379 redis:7-alpine
# Then in backend/.env:
#   REDIS_URL=redis://localhost:6379/0
#   QUIZ_CACHE_TTL_SECONDS=604800

# Inbox.com SMTP setup
# In .env:
# VERIFICATION_EMAIL_BYPASS=false
# SMTP_PROVIDER=inbox
# SMTP_USER=<your inbox.com user/email>
# SMTP_PASSWORD=<your inbox.com password>
# SMTP_FROM=<your inbox.com email>
#
# Optional explicit override:
# SMTP_HOST=smtp.inbox.com
# SMTP_PORT=587
# SMTP_SECURITY=starttls

# Gmail SMTP setup (STARTTLS + Gmail App Password)
# In .env:
# VERIFICATION_EMAIL_BYPASS=false
# SMTP_PROVIDER=gmail
# SMTP_USER=<your gmail address>
# SMTP_PASSWORD=<your 16-char Gmail App Password>
# SMTP_FROM=<your gmail address>
#
# Optional overrides:
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_SECURITY=starttls

# MySQL setup (store users on verify/login)
# Option A (recommended): single URL
# DATABASE_URL=mysql+pymysql://user:pass@host:3306/dbname?charset=utf8mb4
#
# Option B: components
# MYSQL_HOST=127.0.0.1
# MYSQL_PORT=3306
# MYSQL_DB=demo_proj
# MYSQL_USER=root
# MYSQL_PASSWORD=your-password
#
# Connection pool (optional; defaults shown):
# MYSQL_POOL_SIZE=5
# MYSQL_MAX_OVERFLOW=10
# MYSQL_POOL_RECYCLE=3600
#
# Fail startup/verify if DB is missing (recommended for production):
# DATABASE_REQUIRED=true
#
# Check DB status: GET /health (shows database.configured / database.connected)
#
# If you use app consent (POST /auth/consent), add column once:
# ALTER TABLE users ADD COLUMN consent_accepted_at DATETIME NULL AFTER updated_by;
#
# Pre-startup checks (see app/core/preflight.py): MySQL must be configured and reachable
# before uvicorn loads the app, unless you explicitly skip (dev only):
# SKIP_PREFLIGHT_CHECKS=true