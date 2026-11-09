// These keys identify replaceable image slots. Uploaded film uses a fresh key
// and immutable bytes; its removal goes through the versioned film service.
export function isImageSlot(key: string) {
  return (
    ['team-logo', 'opponent-logo', 'coach-profile', 'player-profile'].includes(
      key,
    ) ||
    key.startsWith('athlete-') ||
    key.startsWith('member-')
  );
}
