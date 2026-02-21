import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSkuCatalog,
  resolveCheckoutSku,
} from '../apps/api/config/sku-catalog.js';

test('sku catalog includes only active baseline monthly SKUs', () => {
  const catalog = getSkuCatalog();
  const codes = new Set(catalog.map((sku) => sku.code));

  assert.equal(codes.has('lite_monthly'), true);
  assert.equal(codes.has('pro_monthly'), true);
  assert.equal(codes.has('pro_annual'), true);
  assert.equal(codes.has('server_license_monthly'), true);
  assert.equal(codes.has('mega_build_pass'), true);
  assert.equal(codes.size >= 5, true);
});

test('resolveCheckoutSku supports explicit sku code and legacy tier', () => {
  const explicit = resolveCheckoutSku({ skuCode: 'pro_monthly' });
  const tierMapped = resolveCheckoutSku({ tier: 'starter' });
  const legacyMapped = resolveCheckoutSku({ skuCode: 'starter_monthly' });

  assert.equal(explicit.code, 'pro_monthly');
  assert.equal(tierMapped.code, 'lite_monthly');
  assert.equal(legacyMapped.code, 'lite_monthly');
});
