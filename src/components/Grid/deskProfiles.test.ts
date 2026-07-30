import { describe, expect, it } from "vitest";

import {
  CELL_SIZE_MAX,
  CELL_SIZE_MIN,
  PROFILES_KEY,
  type ProfileStore,
  activeProfile,
  addProfile,
  clampCellSize,
  createProfileObject,
  deleteProfile,
  duplicateProfile,
  ensureStore,
  isEmptyProfile,
  project,
  readStore,
  renameProfile,
  setActiveProfile,
  setCellSize,
  syncActive,
  writeStore,
} from "./deskProfiles";

/**
 * Each test name states the expectation; the comment above it states WHY that
 * is the expectation. The reason matters more than the assertion: without it,
 * a failing test invites someone to change the number until it passes.
 */

class FakeStorage {
  private map = new Map<string, string>();
  quota = Infinity;
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const others = [...this.map.entries()]
      .filter(([k]) => k !== key)
      .reduce((n, [k, v]) => n + k.length + v.length, 0);
    if (others + key.length + value.length > this.quota) {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    }
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

const storeWith = (...profiles: ReturnType<typeof createProfileObject>[]): ProfileStore => ({
  version: 1,
  activeId: profiles[0].id,
  profiles,
});

const makeProfile = (name: string, cellSize = 78, positions = {}) =>
  createProfileObject({ name, cellSize, positions, now: 1_000 });

const dial = (id: string, row: number, col: number, panel = "full-screen-panel") => ({
  id,
  panel,
  row,
  col,
  type: "bookmark",
});

// ---------------------------------------------------------------------------

describe("TP-C: profile lifecycle", () => {
  // A profile is a device context, so two of them may reasonably share a name
  // ("Laptop" at home and at work). Names are labels; ids are the keys.
  it("TP-C3 · accepts a duplicate name and still gives a distinct id", () => {
    const a = makeProfile("Laptop");
    const b = makeProfile("Laptop");
    expect(a.name).toBe(b.name);
    expect(a.id).not.toBe(b.id);
  });

  // New profiles start empty on purpose: that is the state in which the size
  // can be chosen freely, because there is no arrangement for it to disturb.
  it("TP-C2 · creates a profile with no placed icons", () => {
    const p = makeProfile("TV", 160);
    expect(p.positions).toEqual({});
    expect(isEmptyProfile(p)).toBe(true);
  });

  // The app has no meaningful "no profile" state — every write path expects to
  // find an active one. Refusing here is cheaper than a null check in 28 places.
  it("TP-C4 · refuses to delete the last profile", () => {
    const only = makeProfile("Default");
    const store = storeWith(only);
    expect(deleteProfile(store, only.id).profiles).toHaveLength(1);
  });

  // Deleting the active profile has to hand activity to a survivor. A dangling
  // activeId would surface as an empty desk on the next load.
  it("TP-C5 · hands activity to a survivor when the active profile is deleted", () => {
    const a = makeProfile("A");
    const b = makeProfile("B");
    const store = setActiveProfile(storeWith(a, b), a.id);
    const after = deleteProfile(store, a.id);
    expect(after.profiles.map((p) => p.id)).toEqual([b.id]);
    expect(after.activeId).toBe(b.id);
    expect(activeProfile(after).name).toBe("B");
  });

  it("TP-C5b · leaves activity alone when a different profile is deleted", () => {
    const a = makeProfile("A");
    const b = makeProfile("B");
    const store = setActiveProfile(storeWith(a, b), a.id);
    expect(deleteProfile(store, b.id).activeId).toBe(a.id);
  });

  // Sharing the position map would leak every drag made in the copy back into
  // the profile it was copied from.
  it("TP-C6 · duplicates positions by value, not by reference", () => {
    const source = makeProfile("Desk", 78, { x: { row: 1, col: 2 } });
    let store = storeWith(source);
    store = duplicateProfile(store, source.id, "Desk copy", 2_000);
    const copy = store.profiles[1];

    expect(copy.positions).toEqual(source.positions);
    expect(copy.id).not.toBe(source.id);

    store = syncActive(store, [dial("x", 9, 9)]);
    expect(activeProfile(store).positions.x).toEqual({ row: 9, col: 9 });
    // The original is untouched.
    expect(store.profiles[0].positions.x).toEqual({ row: 1, col: 2 });
  });

  // A broken value must not be able to collapse or explode the desk. The same
  // guard existed on the zoom setting this replaces.
  it("TP-C7 · clamps a nonsensical cell size instead of taking it", () => {
    expect(clampCellSize(0)).toBe(CELL_SIZE_MIN);
    expect(clampCellSize(-40)).toBe(CELL_SIZE_MIN);
    expect(clampCellSize(NaN)).toBe(CELL_SIZE_MIN);
    expect(clampCellSize(Infinity)).toBe(CELL_SIZE_MIN);
    expect(clampCellSize(99_999)).toBe(CELL_SIZE_MAX);
    expect(clampCellSize(77.6)).toBe(78);
  });

  it("TP-C7b · clamps through setCellSize as well as the constructor", () => {
    const p = makeProfile("A");
    const store = setCellSize(storeWith(p), p.id, 10_000);
    expect(activeProfile(store).cellSize).toBe(CELL_SIZE_MAX);
  });

  it("TP-C3b · ignores an empty rename rather than blanking the label", () => {
    const p = makeProfile("Laptop");
    const store = renameProfile(storeWith(p), p.id, "   ");
    expect(activeProfile(store).name).toBe("Laptop");
  });

  it("mutations never modify the store they were given", () => {
    // A failed write must not leave the in-memory copy ahead of the disk.
    const p = makeProfile("A");
    const store = storeWith(p);
    const snapshot = JSON.stringify(store);
    renameProfile(store, p.id, "B");
    setCellSize(store, p.id, 200);
    addProfile(store, makeProfile("C"));
    deleteProfile(store, p.id);
    expect(JSON.stringify(store)).toBe(snapshot);
  });
});

describe("TP-P: projection across the storage seam", () => {
  it("TP-P1 · records the arrangement into the active profile", () => {
    const store = syncActive(storeWith(makeProfile("A")), [
      dial("a", 0, 0),
      dial("b", 3, 7),
    ]);
    expect(activeProfile(store).positions).toEqual({
      a: { row: 0, col: 0 },
      b: { row: 3, col: 7 },
    });
  });

  it("TP-P2 · applies the active profile's positions on the way out", () => {
    const store = storeWith(
      makeProfile("A", 78, { a: { row: 5, col: 9 } }),
    );
    const [a] = project(store, [dial("a", 0, 0)]);
    expect(a).toMatchObject({ id: "a", row: 5, col: 9 });
  });

  // Dropping it would make a newly added bookmark vanish from every profile but
  // the one it was created in, which reads as data loss. Passing it through
  // lets the existing first-run placement give it a cell.
  it("TP-P3 · passes through a bookmark the profile has never seen", () => {
    const store = storeWith(makeProfile("A", 78, { a: { row: 5, col: 9 } }));
    const out = project(store, [dial("a", 0, 0), dial("newcomer", 2, 2)]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: "newcomer", row: 2, col: 2 });
  });

  // A position left behind by a deleted bookmark must not be able to break the
  // desk. It is dropped on the next sync, so no separate pruning pass is needed.
  it("TP-P4 · ignores a position whose bookmark is gone, and forgets it on sync", () => {
    let store = storeWith(
      makeProfile("A", 78, { ghost: { row: 4, col: 4 }, a: { row: 1, col: 1 } }),
    );
    const out = project(store, [dial("a", 0, 0)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ row: 1, col: 1 });

    store = syncActive(store, out);
    expect(activeProfile(store).positions).toEqual({ a: { row: 1, col: 1 } });
    expect(activeProfile(store).positions.ghost).toBeUndefined();
  });

  // The 2/3/4-panel layouts have no profile dimension. Recording their flat
  // indices here would let a profile switch disturb layouts that are not part
  // of this feature at all.
  it("TP-P5 · leaves panel-layout entries completely alone", () => {
    const panelEntry = { id: "p1", panel: "top-left", index: 3, type: "bookmark" };
    let store = storeWith(makeProfile("A"));
    store = syncActive(store, [dial("a", 1, 1), panelEntry]);
    expect(Object.keys(activeProfile(store).positions)).toEqual(["a"]);

    const out = project(store, [panelEntry]);
    expect(out[0]).toBe(panelEntry);
  });

  it("TP-P5b · ignores entries with no usable coordinates", () => {
    let store = storeWith(makeProfile("A"));
    store = syncActive(store, [
      { id: "nocoords", panel: "full-screen-panel", type: "bookmark" },
      dial("ok", 2, 2),
    ]);
    expect(Object.keys(activeProfile(store).positions)).toEqual(["ok"]);
  });

  it("survives being handed something that is not a list", () => {
    const store = storeWith(makeProfile("A", 78, { a: { row: 1, col: 1 } }));
    expect(syncActive(store, null as never)).toBe(store);
    expect(project(store, null as never)).toEqual([]);
  });

  it("a full round trip through the seam changes nothing", () => {
    // save -> load has to be the identity, or positions drift every reload.
    const arrangement = [dial("a", 0, 0), dial("b", 4, 11), dial("c", 9, 2)];
    let store = storeWith(makeProfile("A"));
    store = syncActive(store, arrangement);
    expect(project(store, arrangement.map((b) => ({ ...b, row: 0, col: 0 })))).toEqual(
      arrangement,
    );
  });
});

describe("TP-S: the store survives a hostile disk", () => {
  // Profiles are a convenience layer. Taking the arrangement's own save down
  // with them would be a worse bug than losing the profile.
  it("TP-S1 · reports a failed write instead of throwing", () => {
    const storage = new FakeStorage();
    storage.quota = 10;
    expect(writeStore(storage, storeWith(makeProfile("A")))).toBe(false);
  });

  it("TP-S2 · reads corrupt JSON as no store at all", () => {
    const storage = new FakeStorage();
    storage.setItem(PROFILES_KEY, "{not json");
    expect(readStore(storage)).toBeNull();
  });

  it("TP-S2b · discards entries that are not profiles and keeps the rest", () => {
    const storage = new FakeStorage();
    const good = makeProfile("Good");
    storage.setItem(
      PROFILES_KEY,
      JSON.stringify({ version: 1, activeId: good.id, profiles: [good, null, 7, {}] }),
    );
    const read = readStore(storage);
    expect(read?.profiles).toHaveLength(1);
    expect(read?.profiles[0].name).toBe("Good");
  });

  // A dangling activeId would otherwise show an empty desk on load.
  it("TP-S2c · repairs an activeId that points at nothing", () => {
    const storage = new FakeStorage();
    const p = makeProfile("Only");
    storage.setItem(
      PROFILES_KEY,
      JSON.stringify({ version: 1, activeId: "vanished", profiles: [p] }),
    );
    expect(readStore(storage)?.activeId).toBe(p.id);
  });

  it("TP-S2d · repairs a profile carrying junk positions and sizes", () => {
    const storage = new FakeStorage();
    storage.setItem(
      PROFILES_KEY,
      JSON.stringify({
        version: 1,
        activeId: "x",
        profiles: [
          {
            id: "x",
            name: "",
            cellSize: "huge",
            positions: { a: { row: -4, col: 2.7 }, b: "nope", c: null },
          },
        ],
      }),
    );
    const read = readStore(storage);
    const p = read!.profiles[0];
    expect(p.name).toBe("Default");
    expect(p.cellSize).toBe(CELL_SIZE_MIN);
    expect(p.positions).toEqual({ a: { row: 0, col: 2 } });
  });

  it("writes and reads back an identical store", () => {
    const storage = new FakeStorage();
    const store = syncActive(storeWith(makeProfile("A", 120)), [dial("a", 2, 3)]);
    expect(writeStore(storage, store)).toBe(true);
    const back = readStore(storage);
    expect(back?.activeId).toBe(store.activeId);
    expect(back?.profiles[0].cellSize).toBe(120);
    expect(back?.profiles[0].positions).toEqual({ a: { row: 2, col: 3 } });
  });

  it("treats an empty profile list as no store, so a default can be made", () => {
    const storage = new FakeStorage();
    storage.setItem(PROFILES_KEY, JSON.stringify({ version: 1, activeId: "", profiles: [] }));
    expect(readStore(storage)).toBeNull();
  });
});

describe("TP-M: migrating a single desk into the first profile", () => {
  const arrangement = [dial("a", 0, 0), dial("b", 4, 11), dial("c", 9, 2)];

  // The upgrade must not move anybody's icons. Whatever was on the desk becomes
  // the first profile, coordinate for coordinate.
  it("TP-M1 · adopts the existing arrangement exactly", () => {
    const storage = new FakeStorage();
    const { store, migrated } = ensureStore(storage, {
      defaultCellSize: 78,
      arrangement,
      now: 1_000,
    });
    expect(migrated).toBe(true);
    expect(store.profiles).toHaveLength(1);
    expect(activeProfile(store).positions).toEqual({
      a: { row: 0, col: 0 },
      b: { row: 4, col: 11 },
      c: { row: 9, col: 2 },
    });
  });

  // The caller hands in the ceiling the desk is already using — dial size with
  // the retired zoom multiplier folded in. Carrying it verbatim is what makes
  // the upgrade invisible; recomputing it from defaults would resize the desk
  // out from under someone who had zoomed.
  it("TP-M2 · carries the zoomed ceiling through, so the view is unchanged", () => {
    const storage = new FakeStorage();
    const zoomedCeiling = 77.6 * 1.5; // dial "tiny" at the old 1.5x zoom
    const { store } = ensureStore(storage, { defaultCellSize: zoomedCeiling });
    expect(activeProfile(store).cellSize).toBe(Math.round(zoomedCeiling));
  });

  // Without this, every page load appends another profile.
  it("TP-M3 · is a no-op once a store exists", () => {
    const storage = new FakeStorage();
    const first = ensureStore(storage, { defaultCellSize: 78, arrangement, now: 1_000 });
    const second = ensureStore(storage, { defaultCellSize: 200, arrangement: [], now: 2_000 });

    expect(second.migrated).toBe(false);
    expect(second.store.profiles).toHaveLength(1);
    expect(second.store.profiles[0].id).toBe(first.store.profiles[0].id);
    // Neither the size nor the positions are re-derived on the second run.
    expect(activeProfile(second.store).cellSize).toBe(78);
    expect(Object.keys(activeProfile(second.store).positions)).toHaveLength(3);
  });

  // The desk's own recovery path owns a corrupt arrangement. Refusing to make a
  // profile would leave the app with no active profile, which is the one state
  // the rest of the code is not written to survive.
  it("TP-M4 · still creates a profile when there is no arrangement to adopt", () => {
    for (const bad of [undefined, [], null as never, "not a list" as never]) {
      const storage = new FakeStorage();
      const { store, migrated } = ensureStore(storage, {
        defaultCellSize: 78,
        arrangement: bad,
      });
      expect(migrated).toBe(true);
      expect(store.profiles).toHaveLength(1);
      expect(activeProfile(store).positions).toEqual({});
    }
  });

  it("TP-M4b · ignores entries that carry no usable position", () => {
    const storage = new FakeStorage();
    const { store } = ensureStore(storage, {
      defaultCellSize: 78,
      arrangement: [
        dial("ok", 1, 1),
        { id: "nocoords", panel: "full-screen-panel" },
        { id: "panel", panel: "top-left", index: 2 },
      ],
    });
    expect(Object.keys(activeProfile(store).positions)).toEqual(["ok"]);
  });

  // A full origin must not leave the session without a profile: the store is
  // returned for use even when it could not be written down.
  it("TP-M4c · returns a usable store even when it cannot be persisted", () => {
    const storage = new FakeStorage();
    storage.quota = 20;
    const { store, migrated, persisted } = ensureStore(storage, {
      defaultCellSize: 78,
      arrangement,
    });
    expect(migrated).toBe(true);
    expect(persisted).toBe(false);
    expect(activeProfile(store).positions.b).toEqual({ row: 4, col: 11 });
  });

  it("persists what it created, so the next load short-circuits", () => {
    const storage = new FakeStorage();
    ensureStore(storage, { defaultCellSize: 120, arrangement, now: 1_000 });
    const read = readStore(storage);
    expect(read?.profiles[0].cellSize).toBe(120);
    expect(read?.profiles[0].positions.c).toEqual({ row: 9, col: 2 });
  });
});
