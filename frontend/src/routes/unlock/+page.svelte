<script lang="ts">
  import { goto } from "$app/navigation";
  import { deriveKey, generateSalt, getUserSalt, getUserSessionNonce } from "$lib/crypto/keyDerivation";
  import {
    deriveSessionKey,
    generateSessionNonce,
  } from "$lib/crypto/sessionKey";
  import { sessionStore } from "$lib/stores/session";
  import { api } from "$lib/api/client";
  import { backendStore } from "$lib/stores/backendStore";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import { get } from "svelte/store";

  let password = "";
  let email = "";
  let backendUrl = get(backendStore);
  let errorMsg = "";
  let isLoading = false;

  async function handleUnlock() {
    errorMsg = "";
    const trimmedBackendUrl = backendUrl.trim();
    if (!trimmedBackendUrl) {
      errorMsg = "Please enter a server address.";
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      errorMsg = "Please enter your email.";
      return;
    }
    if (!password) {
      errorMsg = "Please enter your password.";
      return;
    }

    // Set transient backend URL for authentication attempt
    backendStore.setTransient(trimmedBackendUrl);

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

      // Save backend URL to localStorage ONLY after successful login
      backendStore.saveSuccessfulBackendUrl(trimmedBackendUrl);

      // Persist server mode configuration in browser if previously set to all-local
      if (get(storagePolicyStore).storageMode === "all-local") {
        storagePolicyStore.updateSetting("storageMode", "all-server");
      }

      // Derive local session keys deterministically from user email & password
      const salt = await getUserSalt(normalizedEmail);
      const masterKey = await deriveKey(password, salt);
      const sessionNonce = await getUserSessionNonce(normalizedEmail);
      const sessionKey = await deriveSessionKey(masterKey, sessionNonce);

      sessionStore.unlock({
        masterKey,
        sessionKey,
        sessionNonce,
        email: user.email,
        role: user.role,
        mode: "authenticated",
      });

      // Redirect to Dashboard
      await goto("/");
    } catch (err: any) {
      // Revert store to last saved URL if authentication failed
      backendStore.restoreSavedUrl();
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
      storagePolicyStore.updateSetting("storageMode", "all-local");
      await sessionStore.initAnonymousSession(true);
      await goto("/");
    } catch (err: any) {
      errorMsg = err?.message || "Failed to initialize local session.";
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="unlock-container">
  <div class="unlock-header">
    <img src="/favicon.png" alt="Examance logo" class="unlock-banner-logo" />
    <h1>Welcome to Examance</h1>
    <p class="subtitle">Privacy-First Anonymous Exam Management & Grading</p>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  <div class="options-grid">
    <!-- Option A: Local Mode -->
    <div class="option-card local-card">
      <div class="card-badge">No Account Required</div>
      <div class="card-icon">🛡️</div>
      <h2>Start Local Workspace</h2>
      <p class="description">
        Ideal for solo offline grading. All data is encrypted with local keys and stored directly in your browser.
      </p>
      <ul class="features-list">
        <li>✨ Zero setup or registration needed</li>
        <li>🔒 Full offline GDPR encryption</li>
        <li>💾 Export/Import workspace as .bgproj file</li>
      </ul>
      <button
        type="button"
        class="local-unlock-btn"
        on:click={handleUnlockLocal}
        disabled={isLoading}
      >
        Start Local Mode
      </button>
    </div>

    <!-- Option B: Cloud Account -->
    <div class="option-card cloud-card">
      <div class="card-badge cloud">School Account</div>
      <div class="card-icon">☁️</div>
      <h2>Connect to Cloud Server</h2>
      <p class="description">
        Sync exams across devices and connect with your institution's backend server.
      </p>

      <form on:submit|preventDefault={handleUnlock} class="cloud-form">
        <div class="form-group">
          <label for="backendUrl">Backend Server URL</label>
          <input
            id="backendUrl"
            type="text"
            bind:value={backendUrl}
            placeholder="e.g. http://localhost:8000"
            required
          />
        </div>

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
            placeholder="Enter password"
            required
          />
        </div>

        <button type="submit" class="submit-btn" class:is-loading={isLoading} disabled={isLoading}>
          {isLoading ? "Authenticating..." : "Connect & Sign In"}
        </button>
      </form>
    </div>
  </div>
</div>

<style>
  .unlock-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 28px);
    padding: 2rem 1.5rem;
    box-sizing: border-box;
    background-color: #0f172a;
    color: #f8fafc;
    max-width: 960px;
    margin: 0 auto;
  }

  .unlock-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .unlock-banner-logo {
    width: 64px;
    height: 64px;
    object-fit: contain;
    margin: 0 auto 0.75rem auto;
    border-radius: 12px;
  }

  h1 {
    margin: 0;
    font-size: 2.25rem;
    font-weight: 800;
    color: #38bdf8;
  }

  .subtitle {
    margin: 0.5rem 0 0 0;
    font-size: 1rem;
    color: #94a3b8;
  }

  .error-banner {
    width: 100%;
    max-width: 840px;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid #ef4444;
    color: #fca5a5;
    padding: 0.85rem 1rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
    box-sizing: border-box;
  }

  .options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    width: 100%;
    max-width: 880px;
  }

  @media (max-width: 768px) {
    .options-grid {
      grid-template-columns: 1fr;
    }
  }

  .option-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    position: relative;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
  }

  .card-badge {
    position: absolute;
    top: 1.25rem;
    right: 1.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.6rem;
    background: #334155;
    color: #38bdf8;
    border-radius: 12px;
    border: 1px solid #0284c7;
  }

  .card-badge.cloud {
    background: #0284c7;
    color: white;
    border: none;
  }

  .card-icon {
    font-size: 2.5rem;
    margin-bottom: 0.75rem;
  }

  h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.35rem;
    color: #f8fafc;
  }

  .description {
    font-size: 0.875rem;
    color: #94a3b8;
    line-height: 1.4;
    margin: 0 0 1.25rem 0;
  }

  .features-list {
    list-style: none;
    padding: 0;
    margin: 0 0 2rem 0;
    font-size: 0.875rem;
    color: #cbd5e1;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    flex: 1;
  }

  .cloud-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  label {
    font-size: 0.8rem;
    font-weight: 500;
    color: #cbd5e1;
  }

  input {
    padding: 0.55rem 0.75rem;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    color: #f8fafc;
    font-size: 0.875rem;
  }

  input:focus {
    outline: none;
    border-color: #38bdf8;
  }

  .submit-btn {
    width: 100%;
    padding: 0.65rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    margin-top: 0.5rem;
  }

  .submit-btn:hover {
    background: #0369a1;
  }

  .local-unlock-btn {
    width: 100%;
    padding: 0.75rem;
    background: #0284c7;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.15s ease;
    margin-top: auto;
  }

  .local-unlock-btn:hover {
    background: #0369a1;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
