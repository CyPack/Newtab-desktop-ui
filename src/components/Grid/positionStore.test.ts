import { describe, expect, it } from "vitest";

import {
  HISTORY_KEY,
  LEGACY_BACKUP_PREFIX,
  MAX_HISTORY_BYTES,
  MAX_SNAPSHOTS,
  QUARANTINE_KEY,
  type StorageLike,
  latestSnapshot,
  pruneLegacyBackups,
  quarantine,
  readHistory,
  recordSnapshot,
} from "./positionStore";

/**
 * The arrangement had exactly one copy and a code path that deleted it. These
 * tests pin the safety net that replaced that: a bounded snapshot ring, a
 * quarantine instead of a delete, and the retirement of the write-only dated
 * keys the old build left behind.
 */

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  /** Set to a byte budget to simulate a full origin. */
  quota = Infinity;

  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const others = [...this.map.entries()]
      .filter(([k]) => k !== key)
      .reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    if (others + key.length + value.length > this.quota) {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    }
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

const dial = (id: number, row: number, col: number) => ({
  id: `b${id}`,
  panel: "full-screen-panel",
  row,
  col,
});

const arrangement = (n: number) =>
  Array.from({ length: n }, (_, i) => dial(i, Math.floor(i / 5), i % 5));

describe("snapshots capture the arrangement", () => {
  it("records the first arrangement it is given", () => {
    const store = new FakeStorage();
    expect(recordSnapshot(store, arrangement(3))).toBe("recorded");
    expect(latestSnapshot(store)?.count).toBe(3);
  });

  it("keeps the newest first regardless of write order", () => {
    const store = new FakeStorage();
    recordSnapshot(store, arrangement(2), { now: 1_000, force: true });
    recordSnapshot(store, arrangement(4), { now: 5_000, force: true });
    const history = readHistory(store);
    expect(history.map((s) => s.count)).toEqual([4, 2]);
  });

  it("carries the reason through so history can be read by a human", () => {
    const store = new FakeStorage();
    recordSnapshot(store, arrangement(2), { reason: "before-restore", force: true });
    expect(latestSnapshot(store)?.reason).toBe("before-restore");
  });
});

describe("snapshots that are not worth taking are skipped", () => {
  it("never snapshots an empty arrangement", () => {
    // An empty list is the signature of the corruption this guards against.
    // Recording it would push the last good state out of the ring.
    const store = new FakeStorage();
    expect(recordSnapshot(store, [])).toBe("skipped-empty");
    expect(readHistory(store)).toHaveLength(0);
  });

  it("skips an arrangement identical to the newest snapshot", () => {
    const store = new FakeStorage();
    const same = arrangement(3);
    recordSnapshot(store, same, { force: true });
    expect(recordSnapshot(store, [...same], { force: true })).toBe("skipped-unchanged");
    expect(readHistory(store)).toHaveLength(1);
  });

  it("throttles rapid changes but lets a forced snapshot through", () => {
    const store = new FakeStorage();
    recordSnapshot(store, arrangement(2), { now: 0, force: true });
    expect(recordSnapshot(store, arrangement(3), { now: 1_000 })).toBe("skipped-throttled");
    expect(recordSnapshot(store, arrangement(3), { now: 1_000, force: true })).toBe("recorded");
  });

  it("lets a change through once the interval has passed", () => {
    const store = new FakeStorage();
    recordSnapshot(store, arrangement(2), { now: 0, force: true });
    const outcome = recordSnapshot(store, arrangement(3), {
      now: 6 * 60 * 1000,
    });
    expect(outcome).toBe("recorded");
  });
});

describe("history stays bounded", () => {
  it("keeps no more than the snapshot limit", () => {
    const store = new FakeStorage();
    for (let i = 0; i < MAX_SNAPSHOTS + 8; i += 1) {
      recordSnapshot(store, arrangement(i + 1), { now: i * 10_000, force: true });
    }
    const history = readHistory(store);
    expect(history).toHaveLength(MAX_SNAPSHOTS);
    // The survivors are the newest ones.
    expect(history[0].count).toBe(MAX_SNAPSHOTS + 8);
  });

  it("stays under the byte ceiling even with large arrangements", () => {
    const store = new FakeStorage();
    for (let i = 0; i < MAX_SNAPSHOTS; i += 1) {
      const bulky = arrangement(400).map((b) => ({ ...b, note: "x".repeat(200), i }));
      recordSnapshot(store, bulky, { now: i * 10_000, force: true });
    }
    expect((store.getItem(HISTORY_KEY) ?? "").length).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
    expect(readHistory(store).length).toBeGreaterThan(0);
  });

  it("sheds old snapshots rather than failing when the origin is full", () => {
    const store = new FakeStorage();
    for (let i = 0; i < 5; i += 1) {
      recordSnapshot(store, arrangement(i + 1), { now: i * 10_000, force: true });
    }
    store.quota = (store.getItem(HISTORY_KEY) ?? "").length;
    const outcome = recordSnapshot(store, arrangement(9), { now: 99_000, force: true });
    expect(outcome).toBe("recorded");
    expect(latestSnapshot(store)?.count).toBe(9);
    expect(readHistory(store).length).toBeLessThan(6);
  });
});

describe("a damaged history does not take the page down with it", () => {
  it("reads a corrupt history as empty", () => {
    const store = new FakeStorage();
    store.setItem(HISTORY_KEY, "{not json");
    expect(readHistory(store)).toEqual([]);
  });

  it("drops entries that are not snapshots and keeps the rest", () => {
    const store = new FakeStorage();
    store.setItem(
      HISTORY_KEY,
      JSON.stringify([{ at: 1, reason: "ok", count: 1, data: [dial(0, 0, 0)] }, null, 7, {}]),
    );
    expect(readHistory(store)).toHaveLength(1);
  });

  it("still records over a corrupt history", () => {
    const store = new FakeStorage();
    store.setItem(HISTORY_KEY, "{not json");
    expect(recordSnapshot(store, arrangement(2))).toBe("recorded");
  });
});

describe("damaged data is quarantined, not deleted", () => {
  it("keeps the raw payload aside for inspection", () => {
    const store = new FakeStorage();
    quarantine(store, '[{"id":"b0",', 4_242);
    const held = JSON.parse(store.getItem(QUARANTINE_KEY) ?? "{}");
    expect(held.raw).toBe('[{"id":"b0",');
    expect(held.at).toBe(4_242);
  });

  it("reports failure instead of throwing when there is no room", () => {
    const store = new FakeStorage();
    store.quota = 4;
    expect(quarantine(store, "a".repeat(50))).toBe(false);
  });
});

describe("the old write-only dated backups are retired", () => {
  it("removes every legacy key", () => {
    const store = new FakeStorage();
    store.setItem(`${LEGACY_BACKUP_PREFIX}2026-07-01`, JSON.stringify({ timestamp: 1, data: arrangement(2) }));
    store.setItem(`${LEGACY_BACKUP_PREFIX}2026-07-02`, JSON.stringify({ timestamp: 2, data: arrangement(3) }));
    const result = pruneLegacyBackups(store);
    expect(result.removed).toHaveLength(2);
    expect(store.getItem(`${LEGACY_BACKUP_PREFIX}2026-07-01`)).toBeNull();
  });

  it("adopts the newest legacy payload into the history before removing it", () => {
    const store = new FakeStorage();
    store.setItem(`${LEGACY_BACKUP_PREFIX}2026-07-01`, JSON.stringify({ timestamp: 1, data: arrangement(2) }));
    store.setItem(`${LEGACY_BACKUP_PREFIX}2026-07-02`, JSON.stringify({ timestamp: 2, data: arrangement(6) }));
    const result = pruneLegacyBackups(store);
    expect(result.adopted).toBe(6);
    expect(latestSnapshot(store)?.count).toBe(6);
    expect(latestSnapshot(store)?.reason).toBe("adopted-legacy-backup");
  });

  it("removes an unreadable legacy key without adopting anything", () => {
    const store = new FakeStorage();
    store.setItem(`${LEGACY_BACKUP_PREFIX}2026-07-01`, "{broken");
    const result = pruneLegacyBackups(store);
    expect(result.adopted).toBe(0);
    expect(result.removed).toEqual([`${LEGACY_BACKUP_PREFIX}2026-07-01`]);
  });

  it("does nothing when there are no legacy keys", () => {
    const store = new FakeStorage();
    store.setItem("panel-bookmarks", JSON.stringify(arrangement(3)));
    expect(pruneLegacyBackups(store)).toEqual({ removed: [], adopted: 0 });
    expect(store.getItem("panel-bookmarks")).not.toBeNull();
  });

  it("leaves the live arrangement key alone", () => {
    const store = new FakeStorage();
    store.setItem("panel-bookmarks", JSON.stringify(arrangement(3)));
    store.setItem(`${LEGACY_BACKUP_PREFIX}2026-07-01`, JSON.stringify({ data: arrangement(2) }));
    pruneLegacyBackups(store);
    expect(JSON.parse(store.getItem("panel-bookmarks") ?? "[]")).toHaveLength(3);
  });
});

describe("a milestone snapshot is kept even when nothing changed", () => {
  // The page-hide snapshot taken on the way out of the old build holds the same
  // arrangement as the upgrade marker taken moments later. Deduplicating would
  // throw away the one entry whose whole value is its name.
  it("records an identical arrangement when explicitly allowed", () => {
    const store = new FakeStorage();
    const same = arrangement(4);
    recordSnapshot(store, same, { reason: "page-hidden", force: true });
    expect(
      recordSnapshot(store, [...same], {
        reason: "pre-profiles-upgrade",
        force: true,
        allowDuplicate: true,
      }),
    ).toBe("recorded");
    const history = readHistory(store);
    expect(history[0].reason).toBe("pre-profiles-upgrade");
    expect(history.map((s) => s.reason)).toContain("page-hidden");
  });

  it("still deduplicates by default, so routine saves stay cheap", () => {
    const store = new FakeStorage();
    const same = arrangement(4);
    recordSnapshot(store, same, { force: true });
    expect(recordSnapshot(store, [...same], { force: true })).toBe("skipped-unchanged");
  });
});
