# Run backend
cd /backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000

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

# Mailjet API setup
# In .env:
# VERIFICATION_EMAIL_BYPASS=false
# SMTP_PROVIDER=mailjet
# MJ_APIKEY_PUBLIC=<your mailjet public key>
# MJ_APIKEY_PRIVATE=<your mailjet private key>
# MJ_FROM_EMAIL=<your verified sender email>
# MJ_FROM_NAME=<sender name shown to users>