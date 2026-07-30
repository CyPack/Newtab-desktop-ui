/**
 * Desk profiles — one arrangement and one icon size per device context.
 *
 * WHY THIS EXISTS
 *
 * Screen area is finite: `columns x cellSize <= availableWidth`. The two are
 * inversely coupled, so no design can give the user "more columns" and "bigger
 * icons" at the same time. It has to pick which one the user controls.
 *
 * The zoom slider this replaces did not pick. It moved the cell-size ceiling
 * while territory expansion moved the fitted cell size, and the fit always won.
 * The visible symptom was that the addressable grid swung by a factor of 21
 * (1056 placeable cells at 0.4x, 50 at 2.5x): territory the user could drop an
 * icon into simply vanished as they zoomed in, and half the slider's travel did
 * nothing at all once the arrangement was wide enough.
 *
 * A profile resolves it by moving the decision earlier. Size belongs to a
 * device context — a TV three metres away, a laptop on your knees — and is
 * chosen while the desk for that context is still empty. After that it is
 * fixed, so the grid the user arranges on stops moving underneath them.
 *
 * WHAT IS SHARED AND WHAT IS NOT
 *
 * Bookmarks are shared; positions are not. Deleting a bookmark removes it
 * everywhere, moving it in one profile leaves the others alone.
 *
 * WHERE IT SITS
 *
 * `panel-bookmarks` remains the single arrangement the rest of the app reads
 * and writes; there are 28 code paths that touch it and none of them are
 * changed. This module is a projection either side of that one storage seam:
 * the active profile's positions are written into `panel-bookmarks` on load,
 * and read back out of it on save. Switching profiles rewrites that key and
 * lets the existing load path do the rest.
 */

import type { StorageLike } from "./positionStore";

export interface ProfilePosition {
  row: number;
  col: number;
}

export interface DeskProfile {
  id: string;
  name: string;
  /**
   * Cell size in px — this profile's ceiling, not a guarantee. The desk still
   * shrinks below it whenever the arrangement would not otherwise fit, which is
   * what keeps "nothing scrolls, nothing is cropped" true for every profile.
   */
  cellSize: number;
  /** bookmark id -> cell. Only full-screen entries are ever recorded here. */
  positions: Record<string, ProfilePosition>;
  /** Window size when the profile was created. Informational; nothing switches
   *  profiles automatically, because guessing wrong would rearrange the desk. */
  screenHint?: { width: number; height: number };
  createdAt: number;
}

export interface ProfileStore {
  version: number;
  activeId: string;
  profiles: DeskProfile[];
}

export const PROFILES_KEY = "desk-profiles";
export const PROFILES_VERSION = 1;
export const DEFAULT_PROFILE_NAME = "Default";

/**
 * Cell size bounds.
 *
 * The floor is a click-target limit rather than a rendering one: below roughly
 * this size a dial stops being reliably hittable. It does NOT contradict the
 * "no minimum size" invariant — that governs what the desk may shrink to in
 * order to fit, which is still unbounded. This only bounds what the user may
 * ASK for.
 *
 * The ceiling is where upscaling starts to show. The canvas is drawn at a
 * logical cell of 194px and scaled, so beyond about 1.65x the favicons visibly
 * soften.
 */
export const CELL_SIZE_MIN = 24;
export const CELL_SIZE_MAX = 320;

export function clampCellSize(value: number): number {
  if (!Number.isFinite(value)) return CELL_SIZE_MIN;
  return Math.round(Math.max(CELL_SIZE_MIN, Math.min(CELL_SIZE_MAX, value)));
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through: a non-crypto id is fine, it only has to be unique locally.
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPosition(value: unknown): value is ProfilePosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ProfilePosition>;
  return Number.isFinite(p.row) && Number.isFinite(p.col);
}

function sanitizePositions(value: unknown): Record<string, ProfilePosition> {
  const out: Record<string, ProfilePosition> = {};
  if (!value || typeof value !== "object") return out;
  for (const [id, pos] of Object.entries(value as Record<string, unknown>)) {
    if (!id || !isPosition(pos)) continue;
    out[id] = {
      row: Math.max(0, Math.trunc(pos.row)),
      col: Math.max(0, Math.trunc(pos.col)),
    };
  }
  return out;
}

function sanitizeProfile(value: unknown): DeskProfile | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<DeskProfile>;
  if (typeof p.id !== "string" || !p.id) return null;
  return {
    id: p.id,
    name: typeof p.name === "string" && p.name.trim() ? p.name : DEFAULT_PROFILE_NAME,
    cellSize: clampCellSize(p.cellSize as number),
    positions: sanitizePositions(p.positions),
    screenHint:
      p.screenHint &&
      Number.isFinite(p.screenHint.width) &&
      Number.isFinite(p.screenHint.height)
        ? { width: p.screenHint.width, height: p.screenHint.height }
        : undefined,
    createdAt: Number.isFinite(p.createdAt as number) ? (p.createdAt as number) : Date.now(),
  };
}

export function createProfileObject(options: {
  name?: string;
  cellSize: number;
  positions?: Record<string, ProfilePosition>;
  screenHint?: { width: number; height: number };
  now?: number;
}): DeskProfile {
  return {
    id: newId(),
    name: options.name?.trim() || DEFAULT_PROFILE_NAME,
    cellSize: clampCellSize(options.cellSize),
    positions: sanitizePositions(options.positions),
    screenHint: options.screenHint,
    createdAt: options.now ?? Date.now(),
  };
}

/**
 * Reads the store, repairing whatever it can.
 *
 * A damaged profile store must never stop the desk from loading — the
 * arrangement itself lives in `panel-bookmarks` and is not at risk here, so the
 * worst case is falling back to a single profile.
 */
export function readStore(store: StorageLike): ProfileStore | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(PROFILES_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.map(sanitizeProfile).filter((p: DeskProfile | null): p is DeskProfile => !!p)
      : [];
    if (profiles.length === 0) return null;
    const activeId = profiles.some((p: DeskProfile) => p.id === parsed.activeId)
      ? parsed.activeId
      : profiles[0].id;
    return { version: PROFILES_VERSION, activeId, profiles };
  } catch {
    return null;
  }
}

/**
 * Persists the store. Returns false rather than throwing when there is no room:
 * profiles are a convenience layer and must never take the arrangement's own
 * save down with them.
 */
export function writeStore(storage: StorageLike, store: ProfileStore): boolean {
  try {
    storage.setItem(PROFILES_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function activeProfile(store: ProfileStore): DeskProfile {
  return store.profiles.find((p) => p.id === store.activeId) ?? store.profiles[0];
}

export function getProfile(store: ProfileStore, id: string): DeskProfile | undefined {
  return store.profiles.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Mutations. Each returns a new store; none mutate the one it was given, so a
// failed write cannot leave the in-memory copy ahead of what is on disk.
// ---------------------------------------------------------------------------

export function addProfile(
  store: ProfileStore,
  profile: DeskProfile,
  { activate = true }: { activate?: boolean } = {},
): ProfileStore {
  return {
    ...store,
    activeId: activate ? profile.id : store.activeId,
    profiles: [...store.profiles, profile],
  };
}

export function renameProfile(store: ProfileStore, id: string, name: string): ProfileStore {
  const trimmed = name.trim();
  // Names are user labels, not keys. Duplicates are allowed on purpose —
  // rejecting them would be friction with nothing behind it.
  if (!trimmed) return store;
  return {
    ...store,
    profiles: store.profiles.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  };
}

export function duplicateProfile(
  store: ProfileStore,
  id: string,
  name?: string,
  now?: number,
): ProfileStore {
  const source = getProfile(store, id);
  if (!source) return store;
  const copy = createProfileObject({
    name: name ?? `${source.name} copy`,
    cellSize: source.cellSize,
    // Deep copy: sharing the position map would leak every drag in the copy
    // back into the original.
    positions: { ...source.positions },
    screenHint: source.screenHint,
    now,
  });
  return addProfile(store, copy);
}

export function deleteProfile(store: ProfileStore, id: string): ProfileStore {
  // The app has no meaningful "no profile" state: every write path expects to
  // find an active one. Refusing here is cheaper than a null check in 28 places.
  if (store.profiles.length <= 1) return store;
  const remaining = store.profiles.filter((p) => p.id !== id);
  if (remaining.length === store.profiles.length) return store;
  return {
    ...store,
    // Deleting the active profile must hand activity to a survivor, or the next
    // load finds a dangling id and shows an empty desk.
    activeId: store.activeId === id ? remaining[0].id : store.activeId,
    profiles: remaining,
  };
}

export function setActiveProfile(store: ProfileStore, id: string): ProfileStore {
  if (!getProfile(store, id)) return store;
  return { ...store, activeId: id };
}

export function setCellSize(store: ProfileStore, id: string, cellSize: number): ProfileStore {
  return {
    ...store,
    profiles: store.profiles.map((p) =>
      p.id === id ? { ...p, cellSize: clampCellSize(cellSize) } : p,
    ),
  };
}

// ---------------------------------------------------------------------------
// Projection: the two directions across the storage seam.
// ---------------------------------------------------------------------------

const FULL_SCREEN = "full-screen-panel";

interface BookmarkLike {
  id?: string;
  panel?: string;
  row?: number;
  col?: number;
  [key: string]: unknown;
}

/**
 * Records the arrangement into the active profile.
 *
 * Only full-screen entries are captured. The 2/3/4-panel layouts have no
 * profile dimension, and writing their flat indices in here would mean a
 * profile switch could disturb layouts that are not part of the feature.
 */
export function syncActive(store: ProfileStore, list: BookmarkLike[]): ProfileStore {
  if (!Array.isArray(list)) return store;
  const active = activeProfile(store);
  if (!active) return store;

  const positions: Record<string, ProfilePosition> = {};
  for (const bm of list) {
    if (!bm || bm.panel !== FULL_SCREEN || typeof bm.id !== "string") continue;
    if (!Number.isFinite(bm.row) || !Number.isFinite(bm.col)) continue;
    positions[bm.id] = {
      row: Math.max(0, Math.trunc(bm.row as number)),
      col: Math.max(0, Math.trunc(bm.col as number)),
    };
  }

  return {
    ...store,
    profiles: store.profiles.map((p) => (p.id === active.id ? { ...p, positions } : p)),
  };
}

/**
 * Applies the active profile's positions to an arrangement.
 *
 * A bookmark the profile has never seen is passed through UNCHANGED rather than
 * dropped. Dropping it would make a newly added bookmark disappear from every
 * profile but the one it was created in, which reads as data loss; leaving it
 * alone lets the existing first-run placement give it a cell.
 *
 * A position for a bookmark that no longer exists is simply not used. It is
 * cleaned up on the next sync, so no separate pruning pass is needed.
 */
export function project(store: ProfileStore, list: BookmarkLike[]): BookmarkLike[] {
  if (!Array.isArray(list)) return [];
  const active = activeProfile(store);
  if (!active) return list;

  return list.map((bm) => {
    if (!bm || bm.panel !== FULL_SCREEN || typeof bm.id !== "string") return bm;
    const pos = active.positions[bm.id];
    if (!pos) return bm;
    return { ...bm, row: pos.row, col: pos.col };
  });
}

/** True when the profile has no placed icons — the state in which changing the
 *  size disturbs nothing, and the flow the UI steers new profiles into. */
export function isEmptyProfile(profile: DeskProfile): boolean {
  return Object.keys(profile.positions).length === 0;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export interface EnsureStoreOptions {
  /**
   * Cell size for a first-run profile.
   *
   * The caller passes the ceiling the desk is ALREADY using — dial size with
   * the old zoom multiplier applied. That is what makes the upgrade invisible:
   * the profile inherits exactly the size the user was looking at a moment ago,
   * so nothing about their desk changes when this ships.
   */
  defaultCellSize: number;
  /** Existing arrangement, adopted as the first profile's positions. */
  arrangement?: BookmarkLike[];
  screenHint?: { width: number; height: number };
  name?: string;
  now?: number;
}

export interface EnsureStoreResult {
  store: ProfileStore;
  /** True only on the run that created the store — lets the caller log or
   *  report the upgrade without having to compare before and after itself. */
  migrated: boolean;
  /** False when the new store could not be persisted (a full origin). The
   *  in-memory store is still usable for this session. */
  persisted: boolean;
}

/**
 * Returns the profile store, creating one from the existing desk if there is
 * none yet.
 *
 * Idempotent by construction: an existing store short-circuits before anything
 * is written. Without that, every load would append another profile.
 *
 * A missing or unreadable arrangement is not an error here. The desk's own
 * recovery path owns that problem, and refusing to create a profile would
 * leave the app with no active profile at all — which is the one state the
 * rest of the code is not written to survive.
 */
export function ensureStore(
  storage: StorageLike,
  options: EnsureStoreOptions,
): EnsureStoreResult {
  const existing = readStore(storage);
  if (existing) return { store: existing, migrated: false, persisted: true };

  const store = storeFromArrangement({
    arrangement: options.arrangement,
    cellSize: options.defaultCellSize,
    name: options.name,
    screenHint: options.screenHint,
    now: options.now,
  });

  return { store, migrated: true, persisted: writeStore(storage, store) };
}

/**
 * Builds a single-profile store around an arrangement.
 *
 * Shared by the in-place upgrade and by the restore of a backup written before
 * profiles existed. Both are the same conversion — an arrangement plus a size
 * becomes a profile — and having one function do it means the two paths cannot
 * drift apart and start producing different desks from the same input.
 */
export function storeFromArrangement(options: {
  arrangement?: BookmarkLike[];
  cellSize: number;
  name?: string;
  screenHint?: { width: number; height: number };
  now?: number;
}): ProfileStore {
  const positions: Record<string, ProfilePosition> = {};
  if (Array.isArray(options.arrangement)) {
    for (const bm of options.arrangement) {
      if (!bm || bm.panel !== FULL_SCREEN || typeof bm.id !== "string") continue;
      if (!Number.isFinite(bm.row) || !Number.isFinite(bm.col)) continue;
      positions[bm.id] = {
        row: Math.max(0, Math.trunc(bm.row as number)),
        col: Math.max(0, Math.trunc(bm.col as number)),
      };
    }
  }

  const profile = createProfileObject({
    name: options.name ?? DEFAULT_PROFILE_NAME,
    cellSize: options.cellSize,
    positions,
    screenHint: options.screenHint,
    now: options.now,
  });

  return { version: PROFILES_VERSION, activeId: profile.id, profiles: [profile] };
}

/**
 * True for a backup that cannot supply a usable profile store.
 *
 * That covers a file written before profiles existed — an arrangement and a
 * dial size, no profiles — and also one carrying an empty profile list, which
 * is no more usable. Both have to be converted, or the desk gets rebuilt from
 * whatever profile happened to be lying around, which is a different desk than
 * the one the user backed up.
 *
 * The test is deliberately for a usable RESULT rather than for a version
 * number: a file is legacy if it does not answer the question, not if it
 * carries a particular label.
 */
export function isLegacyBackup(backup: unknown): boolean {
  if (!backup || typeof backup !== "object") return false;
  const b = backup as { deskProfiles?: { profiles?: unknown } };
  const profiles = b.deskProfiles?.profiles;
  return !Array.isArray(profiles) || profiles.length === 0;
}
