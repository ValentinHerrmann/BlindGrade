# User & Account Management

Guide for creating and managing teacher and administrator accounts in **BlindGrade**.

---

## 1. Create the First Admin Account

Run this command once in the backend environment to bootstrap your initial admin account:

```bash
cd backend
source .venv/bin/activate
python -m app.cli create-user --email admin@school.com --role admin --allow-admin
```
*(You will be prompted to enter a password of at least 12 characters.)*

---

## 2. Create Teacher Accounts (In the Web UI)

Once the first admin account is set up, manage all other accounts directly in the application:

1. Open the app and log in with your Admin credentials.
2. Click **User Management** in the top navigation bar.
3. Fill in:
   - **Email** (e.g. `teacher@school.com`)
   - **Password** (min. 12 characters)
   - **Role** (`Teacher` or `Admin`)
4. Click **Create User**.

---

## 3. Teacher Log In & Authentication

All users authenticate with the server to obtain secure session credentials:

1. Go to the **Unlock / Login** page.
2. Enter your **Email** and **Password**.
3. Click **Unlock Project**.

---

## 4. Personal Data Storage & Privacy Preferences

All server utilities (including LaTeX compilation) require authenticated sessions to prevent unauthorized server use. You can configure how student personal data is stored under **Settings**:

- **Local-Only / Privacy Mode (Default)**: Student identities, scans, and submissions remain exclusively in browser IndexedDB (client-side encrypted). Nothing is synced to backend databases.
- **Server-Synced Mode**: Exams, scores, and encrypted PII are synced to backend PostgreSQL for multi-device access.

---

## Quick Reference Commands

| Action | Command |
| :--- | :--- |
| **Create User** | `python -m app.cli create-user --email user@school.com --role teacher` |
| **Create Admin** | `python -m app.cli create-user --email admin@school.com --role admin --allow-admin` |
| **Reset Password** | `python -m app.cli set-password --email user@school.com` |
| **Generate One-Time Invite** | `python -m app.cli create-invite --expires-days 7` |


