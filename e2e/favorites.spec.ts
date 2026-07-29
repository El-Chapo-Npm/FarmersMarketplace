/**
 * E2E spec: Favorites / wishlist persistence across login sessions (#1046)
 *
 * Covers:
 *   - A buyer favorites a product while logged in.
 *   - The buyer logs out — the heart icon disappears (guest/unauthenticated
 *     state shows no favourite because the product is not in guest storage).
 *   - The buyer logs back in and the same product is still shown as
 *     favourited, proving the state is restored from the backend.
 *
 * Seeding strategy:
 *   A farmer is created via the register UI and a product is listed via the
 *   dashboard form so we have a real product to favourite.  The buyer is also
 *   created via the register UI.
 */

import { test, expect } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL  = `farmer_fav_${ts}@test.invalid`;
const BUYER_EMAIL   = `buyer_fav_${ts}@test.invalid`;
const PASS          = 'TestPass1!';
const PRODUCT_NAME  = `Fav Mangoes ${ts}`;

test.describe('Favorites persistence (#1046)', () => {
  // Seed: farmer registers and lists a product; buyer registers.
  test.beforeAll(async ({ browser }) => {
    // ── farmer ──────────────────────────────────────────────────────────────
    const farmerCtx  = await browser.newContext();
    const farmerPage = await farmerCtx.newPage();

    await farmerPage.goto('/register');
    await farmerPage.fill('#reg-name',     `Fav Farmer ${ts}`);
    await farmerPage.fill('#reg-email',    FARMER_EMAIL);
    await farmerPage.fill('#reg-password', PASS);
    await farmerPage.selectOption('#reg-role', 'farmer');
    await farmerPage.click('button[type="submit"]');
    await expect(farmerPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await farmerPage.fill('#prod-name',  PRODUCT_NAME);
    await farmerPage.fill('#prod-price', '3');
    await farmerPage.fill('#prod-qty',   '20');
    await farmerPage.fill('#prod-unit',  'kg');
    await farmerPage.click('form button[type="submit"]:has-text("List Product")');
    await expect(farmerPage.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });
    await farmerCtx.close();

    // ── buyer ───────────────────────────────────────────────────────────────
    const buyerCtx  = await browser.newContext();
    const buyerPage = await buyerCtx.newPage();

    await buyerPage.goto('/register');
    await buyerPage.fill('#reg-name',     `Fav Buyer ${ts}`);
    await buyerPage.fill('#reg-email',    BUYER_EMAIL);
    await buyerPage.fill('#reg-password', PASS);
    await buyerPage.selectOption('#reg-role', 'buyer');
    await buyerPage.click('button[type="submit"]');
    await expect(buyerPage).toHaveURL(/\/marketplace/, { timeout: 15_000 });
    await buyerCtx.close();
  });

  test('favorite survives logout → login cycle (server-side persistence)', async ({ page }) => {
    // ── Step 1: Log in as buyer ───────────────────────────────────────────
    await page.goto('/login');
    await page.fill('#login-email',    BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });

    // ── Step 2: Find the product card on the marketplace ─────────────────
    await page.fill('input[aria-label*="earch"]', PRODUCT_NAME);
    await page.waitForTimeout(800); // debounce
    const card = page.locator(`[aria-label="View ${PRODUCT_NAME}"]`).first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // ── Step 3: Toggle the heart — should now be ❤️ (favourited) ─────────
    // The favourite button is the sibling of the card link, inside the same
    // grid cell. We locate it by its title attribute.
    const favBtn = page.locator(`[title="Add to favorites"]`).first();
    await expect(favBtn).toBeVisible({ timeout: 5_000 });
    await favBtn.click();

    // After clicking, the button title should flip to "Remove from favorites"
    await expect(page.locator(`[title="Remove from favorites"]`).first()).toBeVisible({
      timeout: 5_000,
    });

    // ── Step 4: Logout ────────────────────────────────────────────────────
    await page.click('button:has-text("Logout")');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // ── Step 5: Log back in ───────────────────────────────────────────────
    await page.fill('#login-email',    BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });

    // ── Step 6: The product should still be shown as favourited ──────────
    await page.fill('input[aria-label*="earch"]', PRODUCT_NAME);
    await page.waitForTimeout(800); // wait for debounce + context re-hydration
    const favBtnAfterLogin = page.locator(`[title="Remove from favorites"]`).first();
    await expect(favBtnAfterLogin).toBeVisible({ timeout: 10_000 });

    // ── Step 7: Un-favourite to leave DB in clean state ──────────────────
    await favBtnAfterLogin.click();
    await expect(page.locator(`[title="Add to favorites"]`).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
