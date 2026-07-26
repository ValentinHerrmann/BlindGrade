# User & Account Management

Guide for creating and managing teacher and administrator accounts in **BlindGrade (Hybrid Server Mode)**.

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

1. Open the app and log in using **Hybrid Server Mode** with your Admin credentials.
2. Click **User Management** in the top navigation bar.
3. Fill in:
   - **Email** (e.g. `teacher@school.com`)
   - **Password** (min. 12 characters)
   - **Role** (`Teacher` or `Admin`)
4. Click **Create User**.

---

## 3. Teacher Log In

To log in as a teacher:

1. Go to the **Unlock / Login** page.
2. Select **Hybrid Server Mode**.
3. Enter your teacher **Email** and **Password**.
4. Click **Unlock Project**.

---

## Quick Reference Commands

| Action                       | Command                                                                             |
| :--------------------------- | :---------------------------------------------------------------------------------- |
| **Create User**              | `python -m app.cli create-user --email user@school.com --role teacher`              |
| **Create Admin**             | `python -m app.cli create-user --email admin@school.com --role admin --allow-admin` |
| **Reset Password**           | `python -m app.cli set-password --email user@school.com`                            |
| **Generate One-Time Invite** | `python -m app.cli create-invite --expires-days 7`                                  |

