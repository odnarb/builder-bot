import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCommanderChatSender,
  resolveCommanderPlayer,
  resolveCommanderUsername,
} from '../apps/bot/player-identity.js';

test('isCommanderChatSender only authorizes the configured commander UUID', () => {
  const bot = {
    players: {
      Alice: { username: 'Alice', uuid: 'uuid-commander' },
      Bob: { username: 'Bob', uuid: 'uuid-bob' },
    },
  };
  const commander = { uuid: 'uuid-commander' };

  assert.equal(isCommanderChatSender({ bot, commander, username: 'Alice' }), true);
  assert.equal(isCommanderChatSender({ bot, commander, username: 'Bob' }), false);
  assert.equal(isCommanderChatSender({ bot, commander, username: 'Unknown' }), false);
});

test('resolveCommanderPlayer finds commander entry by UUID', () => {
  const bot = {
    players: {
      Alice: { username: 'Alice', uuid: 'uuid-commander' },
      Bob: { username: 'Bob', uuid: 'uuid-bob' },
    },
  };

  const commanderPlayer = resolveCommanderPlayer(bot, { uuid: 'uuid-commander' });
  assert.equal(commanderPlayer?.username, 'Alice');
});

test('resolveCommanderUsername enforces commander UUID when preferred username is provided', () => {
  const bot = {
    players: {
      Alice: { username: 'Alice', uuid: 'uuid-commander' },
      Bob: { username: 'Bob', uuid: 'uuid-bob' },
    },
  };
  const commander = { uuid: 'uuid-commander' };

  assert.equal(
    resolveCommanderUsername({ bot, commander, preferredUsername: 'Bob' }),
    'Alice',
  );

  assert.equal(
    resolveCommanderUsername({ bot, commander, preferredUsername: 'Unknown' }),
    'Alice',
  );
});
