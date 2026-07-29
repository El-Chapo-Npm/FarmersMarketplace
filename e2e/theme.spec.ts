/**
 * E2E spec: Dark-mode toggle and persistence across page reloads (#1047)
 *
 * Covers:
 *   - Toggling dark mode sets data-theme="dark" on <html> and persists in
 *     localStorage so a full page reload keeps the choice.
 *   - Clearing the manual preference ("Use system" button) removes the
 *     localStorage key; the app then falls back to the OS-level
 *     prefers-color-scheme setting (emulated via Playwright's colorScheme
 *     option).
 *
 * Requirements:
 *   - The theme toggle and "Use system" buttons are only rendered while a user
 *     is authenticated (they live in Navbar inside the nav-drawer).
 *   - We register a throwaway user once for the whole describe block so we
 *     can log in quickly for each test.
 *
 * ThemeContext behaviour (from source):
 *   localStorage key: 'theme'  (values: 'light' | 'dark'; absent = system)
 *   document.documentElement attribute: data-theme  ('light' | 'dark')
 *   Toggle aria-label: "Toggle dark mode"
 *   System  aria-label: "Use system theme"
 */

import { test, expect, Browser, BrowserContext } from '@playwright/test';

const ts           = Date.now();
const USER_EMAIL   = `theme_user_${ts}@test.invalid`;
const PASS         = 'TestPass1!';

// ─── one-time registration ────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/register');
  await page.fill('#reg-name',     `Theme User ${ts}`);
  await page.fill('#reg-email',    USER_EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'buyer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/marketplace/, { timeout: 15_000 });

  await ctx.close();
});

// ─── helpers ─────────────────────────────────────────────────────────────

async function loginAs(page: any) {
  await page.goto('/login');
  await page.fill('#login-email',    USER_EMAIL);
  await page.fill('#login-password', PASS);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });
}

// ─── tests ───────────────────────────────────────────────────────────────

test.describe('Theme toggle and persistence (#1047)', () => {
  test('toggling dark mode persists across a full page reload', async ({ page }) => {
    await loginAs(page);

    // Determine the current theme so we know which direction to toggle
    const initialTheme = await page.evaluate(
      () => document.documentElement.getAttribute('data-theme') ?? 'light',
    );
    const targetTheme  = initialTheme === 'light' ? 'dark' : 'light';

    // If already dark, we need to toggle back to light first so the test is
    // deterministic — always drive toward dark-mode-on.
    if (initialTheme === 'dark') {
      await page.click('[aria-label="Toggle dark mode"]');
      await expect(page.locator('html[data-theme="light"]')).toBeVisible({ timeout: 3_000 });
    }

    // ── Toggle to dark mode ──────────────────────────────────────────────
    await page.click('[aria-label="Toggle dark mode"]');
    await expect(page.locator('html[data-theme="dark"]')).toBeVisible({ timeout: 3_000 });

    // localStorage must reflect the manual choice
    const storedTheme = await page.evaluate(
      () => localStorage.getItem('theme'),
    );
    expect(storedTheme).toBe('dark');

    // ── Reload — theme should survive ────────────────────────────────────
    await page.reload();
    await expect(page.locator('html[data-theme="dark"]')).toBeVisible({ timeout: 5_000 });

    // localStorage must still be set
    const storedAfterReload = await page.evaluate(
      () => localStorage.getItem('theme'),
    );
    expect(storedAfterReload).toBe('dark');

    // ── Reset to light for clean state ───────────────────────────────────
    await page.click('[aria-label="Toggle dark mode"]');
    await expect(page.locator('html[data-theme="light"]')).toBeVisible({ timeout: 3_000 });
  });

  test('clearing manual preference falls back to OS prefers-color-scheme (dark)', async ({
    browser,
  }) => {
    // Create a browser context that emulates a dark-mode OS preference
    const darkCtx: BrowserContext = await browser.newContext({
      colorScheme: 'dark',
    });
    const page = await darkCtx.newPage();

    await loginAs(page);

    // Force a manual "light" preference first so we know it is set
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();
    await expect(page.locator('html[data-theme="light"]')).toBeVisible({ timeout: 5_000 });

    // Click "Use system theme" — removes the manual key, lets OS take over
    await page.click('[aria-label="Use system theme"]');

    // With colorScheme: 'dark' the system theme is dark → data-theme should
    // become "dark" and localStorage key should be removed.
    await expect(page.locator('html[data-theme="dark"]')).toBeVisible({ timeout: 5_000 });

    const stored = await page.evaluate(() => localStorage.getItem('theme'));
    expect(stored).toBeNull();

    await darkCtx.close();
  });
});
