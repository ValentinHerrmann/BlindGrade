<script lang="ts">
  import { goto } from "$app/navigation";
  import { deriveKey, generateSalt } from "$lib/crypto/keyDerivation";
  import {
    deriveSessionKey,
    generateSessionNonce,
  } from "$lib/crypto/sessionKey";
  import { sessionStore } from "$lib/stores/session";
  import { api } from "$lib/api/client";

  let password = "";
  let email = "";
  let errorMsg = "";
  let isLoading = false;

  async function handleUnlock() {
    errorMsg = "";
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      errorMsg = "Please enter your email.";
      return;
    }
    if (!password) {
      errorMsg = "Please enter your password.";
      return;
    }

    isLoading = true;
    try {
      // Authenticate with server to get httpOnly cookies
      const user = await api.post<{
        email: string;
        role: "teacher" | "admin";
      }>("/auth/login", {
        email: normalizedEmail,
        password,
      });

      // Derive local session keys for client-side encryption
      const salt = generateSalt();
      const masterKey = await deriveKey(password, salt);
      const sessionNonce = generateSessionNonce();
      const sessionKey = await deriveSessionKey(masterKey, sessionNonce);

      sessionStore.unlock({
        masterKey,
        sessionKey,
        sessionNonce,
        email: user.email,
        role: user.role,
        mode: "authenticated",
      });

      // Redirect to settings page per requirement
      await goto("/settings");
    } catch (err: any) {
      errorMsg =
        err.message || "Unlock failed. Check your password or credentials.";
    } finally {
      isLoading = false;
    }
  }

  async function handleUnlockLocal() {
    errorMsg = "";
    isLoading = true;
    try {
      await sessionStore.initAnonymousSession();
      await goto("/");
    } catch (err: any) {
      errorMsg = err?.message || "Failed to initialize local session.";
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="unlock-container">
  <div class="unlock-card">
    <img src="/favicon.png" alt="Examance logo" class="unlock-banner-logo" />
    <h1>Examance</h1>
    <p class="subtitle">Privacy-First Anonymous Exam Management</p>

    {#if errorMsg}
      <div class="error-banner">{errorMsg}</div>
    {/if}

    <form on:submit|preventDefault={handleUnlock}>
      <div class="form-group">
        <label for="email">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder="teacher@school.example"
          required
        />
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder="Enter password to sign in & derive key"
          required
        />
        <small class="hint">
          Authenticates with server and derives local encryption keys.
        </small>
      </div>

      <button type="submit" class="submit-btn" class:is-loading={isLoading} disabled={isLoading}>
        {isLoading ? "Authenticating..." : "Unlock with Server"}
      </button>
    </form>

    <div class="divider"><span>OR</span></div>

    <button
      type="button"
      class="local-unlock-btn"
      on:click={handleUnlockLocal}
      disabled={isLoading}
    >
      🛡️ Continue in Local / Offline Mode
    </button>
  </div>
</div>

<style>
  .unlock-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: calc(100vh - 28px);
    height: 100%;
    padding: 1.5rem;
    box-sizing: border-box;
    background-color: #0f172a;
    color: #f8fafc;
    font-family:
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      sans-serif;
  }

  .unlock-card {
    background: #1e293b;
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    box-sizing: border-box;
  }

  .unlock-banner-logo {
    display: block;
    width: 100%;
    height: auto;
    max-height: 380px;
    object-fit: contain;
    margin: 0 auto 1rem auto;
    border-radius: 15px;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    text-align: center;
    color: #38bdf8;
  }

  .subtitle {
    margin: 0.35rem 0 1.25rem 0;
    text-align: center;
    font-size: 0.875rem;
    color: #94a3b8;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid #ef4444;
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .form-group {
    margin-bottom: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #cbd5e1;
  }

  input {
    padding: 0.625rem 0.875rem;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    color: #f8fafc;
    font-size: 0.95rem;
  }

  input:focus {
    outline: none;
    border-color: #38bdf8;
  }

  .hint {
    font-size: 0.75rem;
    color: #64748b;
  }

  .submit-btn {
    width: 100%;
    padding: 0.75rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    margin-top: 0.5rem;
  }

  .submit-btn:hover {
    background: #0369a1;
  }

  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .divider {
    display: flex;
    align-items: center;
    text-align: center;
    margin: 1.25rem 0;
    color: #64748b;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid #334155;
  }

  .divider span {
    padding: 0 0.75rem;
  }

  .local-unlock-btn {
    width: 100%;
    padding: 0.75rem;
    background: #334155;
    color: #f8fafc;
    border: 1px solid #475569;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .local-unlock-btn:hover {
    background: #475569;
  }

  .local-unlock-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
