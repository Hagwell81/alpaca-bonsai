/**
 * Eviction Candidate Ranker
 *
 * Pure function that sorts loaded runners by eviction priority.
 *
 * Sorting criteria (ascending priority = evicted first):
 * 1. Exclude runners with refCount > 0
 * 2. Non-primary purpose before primary purpose
 * 3. Ascending lastUsedAt (least recently used first)
 * 4. Tie-break: ascending keepAliveDurationMs (shorter duration evicted first)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

/**
 * Rank runners for eviction.
 *
 * @param {Array<Object>} runners - Array of runner-like objects
 * @returns {Array<Object>} New sorted array (first element = best eviction candidate)
 */
function rankEvictionCandidates(runners) {
  return runners
    .filter((r) => (r.refCount || 0) === 0)
    .map((r) => ({ ...r })) // shallow copy to avoid mutating originals
    .sort((a, b) => {
      // 1. Purpose: non-primary (0) before primary (1)
      const aPrimary = a.purpose === 'primary' ? 1 : 0;
      const bPrimary = b.purpose === 'primary' ? 1 : 0;
      if (aPrimary !== bPrimary) {
        return aPrimary - bPrimary;
      }

      // 2. LRU: ascending lastUsedAt
      const aLastUsed = a.lastUsedAt ?? 0;
      const bLastUsed = b.lastUsedAt ?? 0;
      if (aLastUsed !== bLastUsed) {
        return aLastUsed - bLastUsed;
      }

      // 3. Tie-break: ascending keepAliveDurationMs
      const aDuration = a.keepAliveDurationMs ?? 0;
      const bDuration = b.keepAliveDurationMs ?? 0;
      return aDuration - bDuration;
    });
}

module.exports = { rankEvictionCandidates };
