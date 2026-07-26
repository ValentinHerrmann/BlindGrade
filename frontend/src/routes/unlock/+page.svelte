<script lang="ts">
  import { goto } from "$app/navigation";
  import { deriveKey, generateSalt } from "$lib/crypto/keyDerivation";
  import {
    deriveSessionKey,
    generateSessionNonce,
  } from "$lib/crypto/sessionKey";
  import { sessionStore } from "$lib/stores/session";
  import { api } from "$lib/api/client";

  let mode: "local" | "hybrid" = "local";
  let password = "";
  let email = "";
  let errorMsg = "";
  let isLoading = false;

  async function handleUnlock() {
    errorMsg = "";
    if (!password) {
      errorMsg = "Please enter a master password.";
      return;
    }

    isLoading = true;
    try {
      if (mode === "hybrid") {
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) {
          errorMsg = "Please enter your email.";
          isLoading = false;
          return;
        }
        // Authenticate with server to get httpOnly cookies
        const user = await api.post<{
          email: string;
          role: "teacher" | "admin";
        }>("/auth/login", {
          email: normalizedEmail,
          password,
        });
        sessionStore.setHybridUser(user.email, user.role);
        email = normalizedEmail;
      }

      // Derive local session keys
      const salt = generateSalt();
      const masterKey = await deriveKey(password, salt);
      const sessionNonce = generateSessionNonce();
      const sessionKey = await deriveSessionKey(masterKey, sessionNonce);

      sessionStore.unlock({
        mode,
        masterKey,
        sessionKey,
        sessionNonce,
        email: mode === "hybrid" ? email : undefined,
      });

      // Redirect to main page without losing in-memory session keys
      await goto("/");
    } catch (err: any) {
      errorMsg =
        err.message || "Unlock failed. Check your password or credentials.";
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="unlock-container">
  <div class="unlock-card">
    <h1>BlindGrade</h1>
    <p class="subtitle">Privacy-First Anonymous Exam Grading</p>

    <div class="mode-tabs">
      <button
        class:active={mode === "local"}
        on:click={() => {
          mode = "local";
          errorMsg = "";
        }}
      >
        Local Mode
      </button>
      <button
        class:active={mode === "hybrid"}
        on:click={() => {
          mode = "hybrid";
          errorMsg = "";
        }}
      >
        Hybrid Server Mode
      </button>
    </div>

    {#if errorMsg}
      <div class="error-banner">{errorMsg}</div>
    {/if}

    <form on:submit|preventDefault={handleUnlock}>
      {#if mode === "hybrid"}
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
      {/if}

      <div class="form-group">
        <label for="password">Master Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder="Enter password to derive key"
          required
        />
        <small class="hint">
          {mode === "local"
            ? "Used to derive local encryption key. Never leaves your browser."
            : "Your teacher password used for server authentication & key derivation."}
        </small>
      </div>

      <button type="submit" class="submit-btn" disabled={isLoading}>
        {isLoading ? "Deriving Keys..." : "Unlock Project"}
      </button>
    </form>
  </div>
</div>

<style>
  .unlock-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
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
    padding: 2.5rem;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    text-align: center;
    color: #38bdf8;
  }

  .subtitle {
    margin: 0.5rem 0 1.5rem 0;
    text-align: center;
    font-size: 0.875rem;
    color: #94a3b8;
  }

  .mode-tabs {
    display: flex;
    gap: 0.5rem;
    background: #0f172a;
    padding: 4px;
    border-radius: 8px;
    margin-bottom: 1.5rem;
  }

  .mode-tabs button {
    flex: 1;
    padding: 0.5rem;
    border: none;
    background: transparent;
    color: #94a3b8;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
  }

  .mode-tabs button.active {
    background: #334155;
    color: #f8fafc;
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
</style>
