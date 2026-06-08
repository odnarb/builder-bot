import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getBillingGateMode,
    getDistributionMode,
    getEntitlementMode,
    getLocalDefaultTier,
    getPersistenceMode,
    getRuntimeModeConfig,
    isBillingEnabled,
    isHostedMode,
    isLocalMode,
} from '../apps/core/platform/runtime-mode.js';

test('runtime mode defaults to local open-source settings', () => {
    const env = {};

    assert.equal(getDistributionMode(env), 'local');
    assert.equal(isLocalMode(env), true);
    assert.equal(isHostedMode(env), false);
    assert.equal(getBillingGateMode(env), 'disabled');
    assert.equal(isBillingEnabled(env), false);
    assert.equal(getPersistenceMode(env), 'sqlite');
    assert.equal(getEntitlementMode(env), 'free_open_source');
    assert.equal(getLocalDefaultTier(env), 'admin');
});

test('runtime mode resolves hosted defaults', () => {
    const env = {
        BUILDERBOT_DISTRIBUTION_MODE: 'hosted',
    };

    assert.equal(getDistributionMode(env), 'hosted');
    assert.equal(isHostedMode(env), true);
    assert.equal(isLocalMode(env), false);
    assert.equal(getBillingGateMode(env), 'stripe');
    assert.equal(isBillingEnabled(env), true);
    assert.equal(getPersistenceMode(env), 'firestore');
    assert.equal(getEntitlementMode(env), 'hosted_billing');
});

test('runtime mode accepts explicit supported overrides', () => {
    const env = {
        BUILDERBOT_DISTRIBUTION_MODE: ' LOCAL ',
        BILLING_GATE_MODE: 'disabled',
        PERSISTENCE_MODE: 'memory',
        LOCAL_ENTITLEMENT_MODE: 'free_open_source',
        LOCAL_DEFAULT_TIER: 'free',
    };

    assert.deepEqual(getRuntimeModeConfig(env), {
        distributionMode: 'local',
        billingGateMode: 'disabled',
        billingEnabled: false,
        persistenceMode: 'memory',
        entitlementMode: 'free_open_source',
        localDefaultTier: 'free',
    });
});

test('runtime mode rejects invalid distribution mode', () => {
    assert.throws(
        () => getDistributionMode({ BUILDERBOT_DISTRIBUTION_MODE: 'desktop' }),
        /Invalid BUILDERBOT_DISTRIBUTION_MODE/,
    );
});

test('runtime mode rejects invalid billing gate mode', () => {
    assert.throws(
        () => getBillingGateMode({ BILLING_GATE_MODE: 'paypal' }),
        /Invalid BILLING_GATE_MODE/,
    );
});

test('runtime mode rejects invalid persistence mode', () => {
    assert.throws(
        () => getPersistenceMode({ PERSISTENCE_MODE: 'json' }),
        /Invalid PERSISTENCE_MODE/,
    );
});

test('runtime mode rejects invalid local entitlement mode', () => {
    assert.throws(
        () => getEntitlementMode({ LOCAL_ENTITLEMENT_MODE: 'trial' }),
        /Invalid LOCAL_ENTITLEMENT_MODE/,
    );
});

test('runtime mode rejects invalid local default tier', () => {
    assert.throws(
        () => getLocalDefaultTier({ LOCAL_DEFAULT_TIER: 'owner' }),
        /Invalid LOCAL_DEFAULT_TIER/,
    );
});
