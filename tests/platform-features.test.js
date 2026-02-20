import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptPolicyDocuments,
  createMarketplaceListing,
  createSubscriptionTicket,
  getLinkedCommunityAccounts,
  getMarketplaceListings,
  getPolicyAcceptance,
  getPhrasePacks,
  linkCommunityAccount,
  recordAttributionEvent,
  recordBuildReaction,
  resetPlatformFeaturesState,
  savePhrasePack,
  setParentalControls,
} from '../apps/api/utils/platform-features.js';

test('platform features support account linking, reactions, and phrase packs', () => {
  resetPlatformFeaturesState();

  const link = linkCommunityAccount({
    userId: 'auth:user-a',
    platform: 'modrinth',
    handle: 'builder123',
  });
  const reaction = recordBuildReaction({
    userId: 'auth:user-a',
    buildId: 'build-1',
    reaction: 'like',
    buildOwnerUserId: 'auth:creator',
  });
  const phrasePack = savePhrasePack({
    userId: 'auth:user-a',
    name: 'Tower Phrases',
    phrases: ['build a tower', 'build a wall'],
  });

  assert.equal(link.platform, 'modrinth');
  assert.equal(getLinkedCommunityAccounts('auth:user-a').modrinth.handle, 'builder123');
  assert.equal(reaction.reactionCount, 1);
  assert.equal(reaction.rewardAwarded, 5);
  assert.equal(getPhrasePacks('auth:user-a')[0].id, phrasePack.id);
});

test('platform features support policy, subscription tickets, marketplace, and attribution', () => {
  resetPlatformFeaturesState();

  const acceptance = acceptPolicyDocuments({
    userId: 'auth:user-b',
    termsVersion: '2026-02',
    privacyVersion: '2026-02',
  });
  const ticket = createSubscriptionTicket({
    userId: 'auth:user-b',
    type: 'cancel',
    reason: 'No longer needed',
  });
  const listing = createMarketplaceListing({
    userId: 'auth:user-b',
    title: 'Castle Blueprint',
    priceUsd: 9.99,
    buildId: 'build-7',
  });
  const controls = setParentalControls({
    userId: 'auth:user-b',
    strictMode: true,
    blockedTopics: ['violence'],
  });
  const attribution = recordAttributionEvent({
    userId: 'auth:user-b',
    source: 'youtube',
    campaign: 'launch',
  });

  assert.equal(getPolicyAcceptance('auth:user-b').termsVersion, acceptance.termsVersion);
  assert.equal(ticket.status, 'open');
  assert.equal(getMarketplaceListings({ limit: 1 })[0].id, listing.id);
  assert.equal(controls.strictMode, true);
  assert.equal(attribution.source, 'youtube');
});
