/**
 * E2E spec: Coupon code redemption at checkout (#1045)
 *
 * Covers:
 *   - A buyer applies a valid coupon on a product detail page and the
 *     discounted total is shown correctly.
 *   - A buyer enters an invalid (nonexistent) coupon code and sees a clear
 *     inline error with no discount applied.
 *
 * Seeding strategy:
 *   We create a farmer + product + coupon entirely through the API so the
 *   tests are self-contained and do not depend on any pre-existing DB state.
 *   CSRF token is fetched once and reused for all mutating API calls.
 */

import { test, expect, APIRequestContext } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL = `farmer_coupon_${ts}@test.invalid`;
const BUYER_EMAIL  = `buyer_coupon_${ts}@test.invalid`;
const PASS         = 'TestPass1!';
const PRODUCT_NAME = `Coupon Apples ${ts}`;
const PRODUCT_PRICE = 10; // XLM
const COUPON_CODE   = `SAVE20_${ts}`;
const DISCOUNT_PCT  = 20;

// ─── helpers ───────────────────────────────────────────────────────────────

async function getCsrf(req: APIRequestContext): Promise<string> {
  const res  = await req.get('/api/v1/csrf-token');
  const body = await res.json();
  return body.csrfToken as string;
}

async function apiLogin(
  req: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res  = await req.post('/api/v1/auth/login', { data: { email, password } });
  const body = await res.json();
  return body.token as string;
}

// ─── seed ──────────────────────────────────────────────────────────────────

let productId: number;

test.beforeAll(async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  // 1. Register farmer
  await page.goto('/register');
  await page.fill('#reg-name',     `Coupon Farmer ${ts}`);
  await page.fill('#reg-email',    FARMER_EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'farmer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  // 2. List a product via dashboard form
  await page.fill('#prod-name',  PRODUCT_NAME);
  await page.fill('#prod-price', String(PRODUCT_PRICE));
  await page.fill('#prod-qty',   '50');
  await page.fill('#prod-unit',  'kg');
  await page.click('form button[type="submit"]:has-text("List Product")');
  await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

  // 3. Fetch the product id via API
  const farmerToken = await apiLogin(page.request, FARMER_EMAIL, PASS);
  const prodRes = await page.request.get('/api/v1/products/mine/list', {
    headers: { Authorization: `Bearer ${farmerToken}` },
  });
  const { data: products } = await prodRes.json();
  const product = products.find((p: any) => p.name === PRODUCT_NAME);
  expect(product, 'seeded product must exist').toBeTruthy();
  productId = product.id;

  // 4. Create coupon for that farmer's product
  const csrf = await getCsrf(page.request);
  const couponRes = await page.request.post('/api/v1/coupons', {
    headers: { Authorization: `Bearer ${farmerToken}`, 'x-csrf-token': csrf },
    data: {
      code:           COUPON_CODE,
      discount_type:  'percent',
      discount_value: DISCOUNT_PCT,
    },
  });
  expect(couponRes.ok(), `coupon creation should succeed (got ${couponRes.status()})`).toBeTruthy();

  // 5. Register buyer
  await page.goto('/register');
  await page.fill('#reg-name',     `Coupon Buyer ${ts}`);
  await page.fill('#reg-email',    BUYER_EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'buyer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/marketplace/, { timeout: 15_000 });

  await ctx.close();
});

// ─── tests ─────────────────────────────────────────────────────────────────

test.describe('Coupon redemption (#1045)', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as buyer before each test
    await page.goto('/login');
    await page.fill('#login-email',    BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });
  });

  test('valid coupon shows discounted total and success message', async ({ page }) => {
    await page.goto(`/product/${productId}`);

    // Wait for the product detail page to be fully rendered
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    // Coupon input is only rendered for buyers when stock > 0
    const couponInput = page.locator('input[placeholder="Coupon code"]');
    await expect(couponInput).toBeVisible({ timeout: 10_000 });

    // Apply the valid coupon
    await couponInput.fill(COUPON_CODE);
    await page.click('button:has-text("Apply")');

    // Success: inline confirmation
    await expect(page.locator('text=✅ Coupon applied')).toBeVisible({ timeout: 10_000 });

    // Discounted total must be less than the original price
    // The total section renders "Total: X XLM" — with a coupon it shows the
    // struck-through original and the new total side by side.
    // We verify by checking the page contains the expected discounted amount.
    const expectedFinal = (PRODUCT_PRICE * (1 - DISCOUNT_PCT / 100)).toFixed(2);
    await expect(page.locator(`text=${expectedFinal} XLM`).first()).toBeVisible({ timeout: 5_000 });

    // The original price must appear with a strikethrough (coupon applied state)
    const strikethrough = page.locator('s, del, [style*="line-through"]').first();
    await expect(strikethrough).toBeVisible();
  });

  test('invalid coupon code shows inline error with no discount', async ({ page }) => {
    await page.goto(`/product/${productId}`);
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    const couponInput = page.locator('input[placeholder="Coupon code"]');
    await expect(couponInput).toBeVisible({ timeout: 10_000 });

    // Enter a clearly bogus coupon code
    await couponInput.fill('NOTVALID99999');
    await page.click('button:has-text("Apply")');

    // An error message must appear
    await expect(page.locator('text=Invalid coupon code').or(
      page.locator('[style*="color: rgb(192, 57, 43)"]')  // s.err colour
    ).first()).toBeVisible({ timeout: 10_000 });

    // ✅ banner must NOT appear
    await expect(page.locator('text=✅ Coupon applied')).toHaveCount(0);

    // No strikethrough (discount not applied)
    const strikethrough = page.locator('s, del, [style*="line-through"]');
    await expect(strikethrough).toHaveCount(0);
  });
});
