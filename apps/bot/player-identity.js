function normalizeUuid(uuid) {
  return typeof uuid === 'string' ? uuid.trim().toLowerCase() : '';
}

function getPlayerByUsername(bot, username) {
  if (!bot?.players || typeof username !== 'string' || username.trim().length === 0) {
    return null;
  }

  return bot.players[username] || null;
}

export function resolveCommanderPlayer(bot, commander) {
  const expectedUuid = normalizeUuid(commander?.uuid);
  if (!expectedUuid) {
    return null;
  }

  for (const player of Object.values(bot?.players || {})) {
    if (normalizeUuid(player?.uuid) === expectedUuid) {
      return player;
    }
  }

  return null;
}

export function resolveCommanderUsername({ bot, commander, preferredUsername }) {
  const expectedUuid = normalizeUuid(commander?.uuid);
  if (typeof preferredUsername === 'string' && preferredUsername.trim().length > 0) {
    const preferredPlayer = getPlayerByUsername(bot, preferredUsername);
    if (preferredPlayer && (!expectedUuid || normalizeUuid(preferredPlayer.uuid) === expectedUuid)) {
      return preferredUsername;
    }
  }

  const commanderPlayer = resolveCommanderPlayer(bot, commander);
  return commanderPlayer?.username || null;
}

export function isCommanderChatSender({ bot, commander, username }) {
  const player = getPlayerByUsername(bot, username);
  if (!player) {
    return false;
  }

  const expectedUuid = normalizeUuid(commander?.uuid);
  if (!expectedUuid) {
    return false;
  }

  return normalizeUuid(player.uuid) === expectedUuid;
}
