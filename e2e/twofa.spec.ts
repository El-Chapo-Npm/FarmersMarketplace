/**
 * E2E spec: 2FA TOTP setup and verification flow (#1048)
 *
 * Covers:
 *   - A user navigates to Settings and starts the 2FA setup wizard.
 *   - The QR code and manual-entry secret are displayed.
 *   - The test computes a valid TOTP from the secret returned by the API
 *     (using speakeasy, the same library the backend uses).
 *   - Entering the valid 6-digit code enables 2FA; the success state is
 *     confirmed.
 *   - Entering an invalid code is rejected with a clear error.
 *   - 2FA can be disabled from the same Settings page.
 *
 * NOTE on login-time TOTP enforcement:
 *   The current backend /api/auth/login endpoint does not yet gate access
 *   behind a TOTP challenge — it issues tokens for password-only auth
 *   regardless of 2FA status.  The AC requirement for "subsequent login
 *   prompts for a TOTP code" is therefore covered at the Settings-UI level
 *   (setup → enabled state) with a TODO comment for when the login gate is
 *   wired up server-side.
 *
 * Dependencies:
 *   speakeasy — added to e2e/package.json (same library used by the backend).
 */

import { test, expect, APIRequestContext } from '@playwright/test';
// speakeasy ships CJS; the Playwright/Node context can require it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const speakeasy = require('speakeasy') as {
  totp: (opts: { secret: string; encoding: string; window?: number }) => string;
};

const ts         = Date.now();
const USER_EMAIL = `twofa_user_${ts}@test.invalid`;
const PASS       = 'TestPass1!';

// ─── helpers ─────────────────────────────────────────────────────────────

async function getCsrf(req: APIRequestContext): Promise<string> {
  const res  = await req.get('/api/v1/csrf-token');
  const body = await res.json();
  return body.csrfToken as string;
}

async function apiLogin(req: APIRequestContext, email: string, password: string): Promise<string> {
  const res  = await req.post('/api/v1/auth/login', { data: { email, password } });
  const body = await res.json();
  return body.token as string;
}

/** Ensure 2FA is disabled before a test runs (idempotent cleanup). */
async function ensure2FADisabled(req: APIRequestContext, token: string): Promise<void> {
  const csrf      = await getCsrf(req);
  const statusRes = await req.get('/api/v1/auth/2fa/status', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { enabled } = await statusRes.json();
  if (enabled) {
    await req.post('/api/v1/auth/2fa/disable', {
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrf },
    });
  }
}

// ─── seed ────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/register');
  await page.fill('#reg-name',     `2FA User ${ts}`);
  await page.fill('#reg-email',    USER_EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'buyer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/marketplace/, { timeout: 15_000 });

  await ctx.close();
});

// ─── tests ───────────────────────────────────────────────────────────────

test.describe('2FA TOTP setup and verification (#1048)', () => {
  test.beforeEach(async ({ page, request }) => {
    // Always start with 2FA disabled so tests are independent
    const token = await apiLogin(request, USER_EMAIL, PASS);
    await ensure2FADisabled(request, token);

    // Log in via UI
    await page.goto('/login');
    await page.fill('#login-email',    USER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });
  });

  test('initial state shows 2FA disabled warning on Settings page', async ({ page }) => {
    await page.goto('/settings');

    // TwoFactorAuth component renders the disabled warning
    await expect(
      page.locator('text=2FA is currently disabled').or(
        page.locator('text=⚠️ 2FA is currently disabled'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // "Enable 2FA" button must be present
    await expect(page.locator('button:has-text("Enable 2FA")').first()).toBeVisible();
  });

  test('entering an invalid 6-digit code during setup shows an error', async ({ page }) => {
    await page.goto('/settings');

    // Start setup
    await page.locator('button:has-text("Enable 2FA")').first().click();

    // QR code step: wait for the code input to appear
    const codeInput = page.locator('input[placeholder="000000"]').first();
    await expect(codeInput).toBeVisible({ timeout: 10_000 });

    // Enter an obviously wrong code
    await codeInput.fill('000000');

    const verifyBtn = page.locator('button:has-text("Verify & Enable")').first();
    await expect(verifyBtn).toBeEnabled({ timeout: 3_000 });
    await verifyBtn.click();

    // Backend rejects the wrong code
    await expect(
      page.locator('text=Invalid verification code').or(
        page.locator('text=Verification failed'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // We should still be in the setup step (not flipped to enabled state)
    await expect(page.locator('button:has-text("Verify & Enable")').first()).toBeVisible();
  });

  test('valid TOTP code enables 2FA and the Settings page shows enabled state', async ({
    page,
    request,
  }) => {
    await page.goto('/settings');

    // ── Initiate setup via UI ────────────────────────────────────────────
    await page.locator('button:has-text("Enable 2FA")').first().click();

    // The setup API call returns the secret; we grab it from the page.
    // The component renders: "Enter this code manually: <code>{secret}</code>"
    const secretLocator = page.locator('code').first();
    await expect(secretLocator).toBeVisible({ timeout: 10_000 });
    const secret = (await secretLocator.textContent())?.trim() ?? '';
    expect(secret.length).toBeGreaterThan(0);

    // ── Compute a valid TOTP from the secret ─────────────────────────────
    // Use speakeasy with window:1 to tolerate minor clock skew in CI
    const validCode = speakeasy.totp({ secret, encoding: 'base32', window: 1 });
    expect(validCode).toMatch(/^\d{6}$/);

    // ── Enter the valid code ─────────────────────────────────────────────
    const codeInput = page.locator('input[placeholder="000000"]').first();
    await codeInput.fill(validCode);

    const verifyBtn = page.locator('button:has-text("Verify & Enable")').first();
    await expect(verifyBtn).toBeEnabled();
    await verifyBtn.click();

    // ── Assert success ───────────────────────────────────────────────────
    await expect(
      page.locator('text=2FA enabled successfully').or(
        page.locator('text=2FA enabled'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The enabled indicator should now appear
    await expect(
      page.locator('text=2FA is enabled on your account').or(
        page.locator('text=✓ 2FA is enabled'),
      ).first(),
    ).toBeVisible({ timeout: 5_000 });

    // "Disable 2FA" button must be present instead of "Enable 2FA"
    await expect(page.locator('button:has-text("Disable 2FA")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Enable 2FA")')).toHaveCount(0);

    // ── Verify status via API ────────────────────────────────────────────
    const token     = await apiLogin(request, USER_EMAIL, PASS);
    const statusRes = await request.get('/api/v1/auth/2fa/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { enabled } = await statusRes.json();
    expect(enabled).toBe(true);
  });

  test('2FA can be disabled from Settings after being enabled', async ({ page, request }) => {
    // ── Pre-condition: enable 2FA via API so this test is independent ────
    const token = await apiLogin(request, USER_EMAIL, PASS);
    const csrf  = await getCsrf(request);

    // Call /2fa/setup to obtain a secret
    const setupRes = await request.post('/api/v1/auth/2fa/setup', {
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrf },
    });
    expect(setupRes.ok()).toBeTruthy();
    const { secret, backupCodes } = await setupRes.json();

    // Compute a valid TOTP and call /2fa/verify
    const code = speakeasy.totp({ secret, encoding: 'base32', window: 1 });
    const csrf2 = await getCsrf(request);
    const verifyRes = await request.post('/api/v1/auth/2fa/verify', {
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrf2 },
      data: { secret, code, backupCodes },
    });
    expect(verifyRes.ok(), '2FA should have been enabled via API').toBeTruthy();

    // ── Navigate to Settings and disable via UI ──────────────────────────
    await page.goto('/settings');

    // Confirm enabled state is shown
    await expect(
      page.locator('text=2FA is enabled on your account').or(
        page.locator('text=✓ 2FA is enabled'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Click "Disable 2FA" (triggers a window.confirm dialog)
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('button:has-text("Disable 2FA")').first().click();

    // Disabled state should be restored
    await expect(
      page.locator('text=2FA disabled').or(
        page.locator('text=⚠️ 2FA is currently disabled'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // "Enable 2FA" must be back
    await expect(page.locator('button:has-text("Enable 2FA")').first()).toBeVisible();

    // Confirm via API
    const statusToken = await apiLogin(request, USER_EMAIL, PASS);
    const statusRes   = await request.get('/api/v1/auth/2fa/status', {
      headers: { Authorization: `Bearer ${statusToken}` },
    });
    const { enabled } = await statusRes.json();
    expect(enabled).toBe(false);
  });

  // TODO: When the /api/auth/login endpoint is updated to gate access behind a
  // TOTP challenge (returning HTTP 200 with { requires2fa: true } and a
  // challenge token), add a test here that:
  //   1. Enables 2FA for the user.
  //   2. Logs out.
  //   3. Submits email+password — expects the login page to show a TOTP input.
  //   4. Submits a valid TOTP code — expects successful redirect.
  //   5. Submits an invalid TOTP code — expects an inline error.
});
