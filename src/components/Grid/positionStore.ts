/**
 * Layout history for the desk.
 *
 * The arrangement itself lives under `panel-bookmarks`; that is the single
 * source of truth and nothing here replaces it. What this module adds is the
 * safety net underneath it, because the primary key had none: a parse failure
 * used to delete it outright, and the only "backup" was a 24-hour interval that
 * could never fire and that nothing ever read back.
 *
 * Three rules shape everything below:
 *
 *  1. History is BEST EFFORT. It is written after the primary save has already
 *     succeeded and every failure in here is swallowed. Losing a snapshot is an
 *     inconvenience; letting snapshotting break the actual save would be the
 *     bug it is meant to prevent.
 *  2. History is BOUNDED. Both by entry count and by serialised size, so it
 *     cannot creep up on the origin's storage quota the way the old dated keys
 *     did.
 *  3. Damaged data is QUARANTINED, never deleted. The raw string is moved
 *     aside so it can still be inspected, and the newest snapshot takes over.
 */

/** The slice of the Storage API this module needs — keeps it testable. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface Snapshot {
  /** Epoch ms the snapshot was taken. */
  at: number;
  /** Why it was taken — shown in diagnostics, never parsed. */
  reason: string;
  /** Number of entries, so history can be scanned without deserialising data. */
  count: number;
  data: unknown[];
}

export const HISTORY_KEY = "panel-bookmarks-history";
export const QUARANTINE_KEY = "panel-bookmarks-corrupt";
export const LEGACY_BACKUP_PREFIX = "panel-bookmarks_backup_";

/** How many snapshots to keep. Ten covers a session's worth of mistakes. */
export const MAX_SNAPSHOTS = 10;
/** Hard ceiling on the serialised history, well under any origin quota. */
export const MAX_HISTORY_BYTES = 512 * 1024;
/** Snapshots are throttled to this interval unless explicitly forced. */
export const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000;

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Snapshot>;
  return typeof candidate.at === "number" && Array.isArray(candidate.data);
}

/**
 * Reads the history, newest first. A damaged history is treated as an empty
 * one rather than an error: it is a backup of a backup, and refusing to start
 * because of it would be worse than losing it.
 */
export function readHistory(store: StorageLike): Snapshot[] {
  try {
    const raw = store.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSnapshot).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export function latestSnapshot(store: StorageLike): Snapshot | null {
  return readHistory(store)[0] ?? null;
}

/**
 * Trims to the count limit first, then keeps dropping the oldest entry until
 * the serialised form fits the byte ceiling. At least one snapshot always
 * survives — an oversized single snapshot is still better than none.
 */
function fitToLimits(snapshots: Snapshot[]): { kept: Snapshot[]; serialised: string } {
  let kept = snapshots.slice(0, MAX_SNAPSHOTS);
  let serialised = JSON.stringify(kept);
  while (kept.length > 1 && serialised.length > MAX_HISTORY_BYTES) {
    kept = kept.slice(0, kept.length - 1);
    serialised = JSON.stringify(kept);
  }
  return { kept, serialised };
}

/**
 * Writes the history, shedding the oldest entries if the origin is out of
 * room. Returns false when even a single snapshot will not fit, which is the
 * point at which history quietly gives up.
 */
function writeHistory(store: StorageLike, snapshots: Snapshot[]): boolean {
  let candidates = snapshots;
  while (candidates.length > 0) {
    const { kept, serialised } = fitToLimits(candidates);
    try {
      store.setItem(HISTORY_KEY, serialised);
      return true;
    } catch {
      // Almost certainly a quota error. Halve the retained history and retry
      // rather than aborting: a shorter history still protects the user.
      if (kept.length <= 1) return false;
      candidates = kept.slice(0, kept.length - 1);
    }
  }
  return false;
}

export interface RecordOptions {
  reason?: string;
  /** Bypasses the interval throttle — used when the page is going away. */
  force?: boolean;
  now?: number;
  minIntervalMs?: number;
}

export type RecordOutcome =
  | "recorded"
  | "skipped-empty"
  | "skipped-unchanged"
  | "skipped-throttled"
  | "failed";

/**
 * Takes a snapshot if it is worth taking.
 *
 * An empty arrangement is never snapshotted: the most likely way to produce
 * one is the very corruption this module exists to survive, and recording it
 * would push the last good state out of the ring buffer.
 */
export function recordSnapshot(
  store: StorageLike,
  data: unknown[],
  options: RecordOptions = {},
): RecordOutcome {
  const {
    reason = "change",
    force = false,
    now = Date.now(),
    minIntervalMs = SNAPSHOT_MIN_INTERVAL_MS,
  } = options;

  if (!Array.isArray(data) || data.length === 0) return "skipped-empty";

  try {
    const history = readHistory(store);
    const newest = history[0];

    if (newest && JSON.stringify(newest.data) === JSON.stringify(data)) {
      return "skipped-unchanged";
    }
    if (!force && newest && now - newest.at < minIntervalMs) {
      return "skipped-throttled";
    }

    const snapshot: Snapshot = { at: now, reason, count: data.length, data };
    return writeHistory(store, [snapshot, ...history]) ? "recorded" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Moves an unparseable payload aside instead of deleting it.
 *
 * Only the most recent casualty is kept — the interesting one is whatever the
 * page just choked on, and keeping a pile of them would reintroduce the
 * unbounded growth of the old dated keys.
 */
export function quarantine(store: StorageLike, raw: string, now = Date.now()): boolean {
  try {
    store.setItem(QUARANTINE_KEY, JSON.stringify({ at: now, raw }));
    return true;
  } catch {
    return false;
  }
}

export interface PruneResult {
  removed: string[];
  adopted: number;
}

/**
 * Retires the old `panel-bookmarks_backup_<date>` keys.
 *
 * They were write-only — nothing ever read them — so they are pure ballast in
 * the user's storage. The newest one is folded into the history first so that
 * anybody who has been running the old build keeps whatever it did manage to
 * capture, and only then are they all removed.
 */
export function pruneLegacyBackups(store: StorageLike, now = Date.now()): PruneResult {
  const result: PruneResult = { removed: [], adopted: 0 };
  const legacyKeys: string[] = [];

  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(LEGACY_BACKUP_PREFIX)) legacyKeys.push(key);
    }
  } catch {
    return result;
  }

  if (legacyKeys.length === 0) return result;
  legacyKeys.sort();

  // The dated suffix sorts chronologically, so the last key is the newest.
  const newestKey = legacyKeys[legacyKeys.length - 1];
  try {
    const raw = store.getItem(newestKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const data = Array.isArray(parsed) ? parsed : parsed?.data;
      if (Array.isArray(data) && data.length > 0) {
        const at = typeof parsed?.timestamp === "number" ? parsed.timestamp : now;
        const outcome = recordSnapshot(store, data, {
          reason: "adopted-legacy-backup",
          force: true,
          now: at,
        });
        if (outcome === "recorded") result.adopted = data.length;
      }
    }
  } catch {
    // An unreadable legacy backup is still worth removing.
  }

  for (const key of legacyKeys) {
    try {
      store.removeItem(key);
      result.removed.push(key);
    } catch {
      // Leave it; it will be retried on the next load.
    }
  }

  return result;
}
