<script lang="ts">
    import { onMount } from "svelte";
    import { api, ApiError } from "$lib/api/client";
    import { isUnlocked, sessionStore } from "$lib/stores/session";

    type UserRole = "teacher" | "admin";

    let email = "";
    let password = "";
    let role: UserRole = "teacher";

    let isSubmitting = false;
    let errorMsg = "";
    let successMsg = "";

    $: canAccess =
        $isUnlocked &&
        $sessionStore.role === "admin";

    $: {
        if (email.trim() || password) {
            sessionStore.setDirty(true);
        }
    }

    onMount(() => {
        if (!$isUnlocked) {
            window.location.href = "/unlock";
            return;
        }
    });

    function validate(): string | null {
        const normalizedEmail = email.trim();
        if (!normalizedEmail) return "Email is required.";
        if (!password) return "Password is required.";
        if (password.length < 12)
            return "Password must be at least 12 characters long.";
        return null;
    }

    async function handleCreateUser() {
        errorMsg = "";
        successMsg = "";

        if (!canAccess) {
            errorMsg = "Admin access is required.";
            return;
        }

        const validationError = validate();
        if (validationError) {
            errorMsg = validationError;
            return;
        }

        isSubmitting = true;
        try {
            const payload = {
                email: email.trim(),
                password,
                role,
            };
            const created = await api.post<{
                id: string;
                email: string;
                role: UserRole;
            }>("/admin/users", payload);

            successMsg = `Created ${created.role} account for ${created.email}.`;
            password = "";
            sessionStore.setDirty(false);
        } catch (err: unknown) {
            if (err instanceof ApiError) {
                if (err.status === 403) {
                    errorMsg = "Only admins can create users.";
                } else if (err.status === 409) {
                    errorMsg = "A user with this email already exists.";
                } else {
                    errorMsg = err.message;
                }
            } else {
                errorMsg = "Failed to create user. Please try again.";
            }
        } finally {
            isSubmitting = false;
        }
    }
</script>

<div class="admin-users-page">
    <div class="header">
        <h2>User Management</h2>
        <p>Create teacher or admin accounts for Hybrid Server Mode.</p>
    </div>

    {#if !$isUnlocked}
        <div class="state-card">
            <p>Session is locked. Unlock to continue.</p>
            <a href="/unlock" class="primary-link">Go to Unlock</a>
        </div>
    {:else if $sessionStore.role !== "admin"}
        <div class="state-card danger">
            <p>Admin role required.</p>
            <p class="sub">Sign in with an admin account to create users.</p>
        </div>
    {:else}
        <div class="form-card">
            {#if successMsg}
                <div class="banner success">{successMsg}</div>
            {/if}
            {#if errorMsg}
                <div class="banner error">{errorMsg}</div>
            {/if}

            <form on:submit|preventDefault={handleCreateUser}>
                <div class="field">
                    <label for="email">Email</label>
                    <input
                        id="email"
                        type="email"
                        bind:value={email}
                        placeholder="teacher@school.example"
                        autocomplete="off"
                        required
                    />
                </div>

                <div class="field">
                    <label for="password">Password</label>
                    <input
                        id="password"
                        type="password"
                        bind:value={password}
                        placeholder="At least 12 characters"
                        autocomplete="new-password"
                        required
                        minlength="12"
                    />
                    <small>Stored only as Argon2id hash on server.</small>
                </div>

                <div class="field">
                    <label for="role">Role</label>
                    <select id="role" bind:value={role}>
                        <option value="teacher">Teacher</option>
                        <option value="admin">Admin</option>
                    </select>
                    <small
                        >Create admin accounts only when operationally
                        necessary.</small
                    >
                </div>

                <button
                    class="primary-btn"
                    type="submit"
                    disabled={isSubmitting}
                >
                    {isSubmitting ? "Creating User..." : "Create User"}
                </button>
            </form>
        </div>
    {/if}
</div>

<style>
    .admin-users-page {
        max-width: 760px;
        margin: 2rem auto;
        padding: 1rem;
    }

    .header h2 {
        margin: 0;
        color: #f8fafc;
    }

    .header p {
        margin-top: 0.5rem;
        color: #94a3b8;
    }

    .form-card,
    .state-card {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 1.25rem;
        margin-top: 1rem;
    }

    .state-card.warning {
        border-color: #f59e0b;
    }

    .state-card.danger {
        border-color: #ef4444;
    }

    .sub {
        color: #94a3b8;
        margin-top: 0.25rem;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        margin-bottom: 1rem;
    }

    label {
        color: #cbd5e1;
        font-size: 0.9rem;
        font-weight: 600;
    }

    input,
    select {
        padding: 0.625rem 0.75rem;
        border-radius: 8px;
        border: 1px solid #475569;
        background: #0f172a;
        color: #f8fafc;
        font-size: 0.95rem;
    }

    input:focus,
    select:focus {
        outline: none;
        border-color: #38bdf8;
    }

    small {
        color: #94a3b8;
        font-size: 0.75rem;
    }

    .primary-btn,
    .primary-link {
        display: inline-block;
        background: #0284c7;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        padding: 0.65rem 1rem;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
    }

    .primary-btn:hover,
    .primary-link:hover {
        background: #0369a1;
    }

    .primary-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .banner {
        border-radius: 8px;
        padding: 0.65rem 0.75rem;
        margin-bottom: 1rem;
        font-size: 0.9rem;
    }

    .banner.success {
        border: 1px solid #16a34a;
        background: rgba(22, 163, 74, 0.2);
        color: #86efac;
    }

    .banner.error {
        border: 1px solid #dc2626;
        background: rgba(220, 38, 38, 0.2);
        color: #fca5a5;
    }
</style>
