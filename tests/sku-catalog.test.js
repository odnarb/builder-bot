import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSkuCatalog,
  resolveCheckoutSku,
} from '../apps/api/config/sku-catalog.js';

test('sku catalog includes only active baseline monthly SKUs', () => {
  const catalog = getSkuCatalog();
  const codes = new Set(catalog.map((sku) => sku.code));

  assert.equal(codes.has('starter_monthly'), true);
  assert.equal(codes.has('pro_monthly'), true);
  assert.equal(codes.has('admin_monthly'), true);
  assert.equal(codes.size, 3);
});

test('resolveCheckoutSku supports explicit sku code and legacy tier', () => {
  const explicit = resolveCheckoutSku({ skuCode: 'pro_monthly' });
  const tierMapped = resolveCheckoutSku({ tier: 'starter' });

  assert.equal(explicit.code, 'pro_monthly');
  assert.equal(tierMapped.code, 'starter_monthly');
});
