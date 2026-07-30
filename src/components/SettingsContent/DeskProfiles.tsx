import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CELL_SIZE_MAX,
  CELL_SIZE_MIN,
  type ProfileStore,
  activeProfile,
  addProfile,
  clampCellSize,
  createProfileObject,
  deleteProfile,
  duplicateProfile,
  isEmptyProfile,
  readStore,
  renameProfile,
  setActiveProfile,
  setCellSize,
  writeStore,
} from "#components/Grid/deskProfiles";
import {
  VIEWPORT_PADDING,
  contentExtent,
  logicalCellSize,
  resolveCanvas,
} from "#components/Grid/layout";
import { settings } from "#stores/useSettings";

/**
 * Desk profiles, and the size control that belongs to each one.
 *
 * The control this replaces was a live zoom slider, and it had a problem that
 * no amount of labelling could fix: moving it changed how many cells the desk
 * had, so the grid someone was arranging on resized underneath them — by a
 * factor of 21 across the slider's travel. Size and arrangement were fighting
 * over the same finite screen.
 *
 * Profiles separate them in time. A profile is created empty, its size is
 * chosen while there is nothing to disturb, and only then are icons placed.
 * Everything in this component serves that order: the size control is the most
 * prominent thing about a new profile, and it comes with a reference dial drawn
 * at TRUE size so the decision can be made by looking rather than by guessing
 * what "1.4x" means from where you are sitting.
 */

interface ManagerProfileApi {
  read(): ProfileStore;
  switch(id: string): void;
  create(name: string, cellSize: number): string;
  rename(id: string, name: string): void;
  duplicate(id: string, name?: string): void;
  remove(id: string): boolean;
  setCellSize(id: string, px: number): void;
  tidy(): void;
}

function managerApi(): ManagerProfileApi | null {
  const mgr = (window as unknown as { panelBookmarkManager?: { deskProfiles?: ManagerProfileApi } })
    .panelBookmarkManager;
  return mgr?.deskProfiles ?? null;
}

/**
 * The desk area a profile has to fit into.
 *
 * Measured from the live desk when settings are open over it, which is the
 * normal case. On the standalone options page there is no desk, so the window
 * stands in — the numbers are then a good estimate rather than a measurement,
 * and the caption says so.
 */
function measureDeskArea() {
  const viewport = document.querySelector(".FullScreenViewport") as HTMLElement | null;
  if (viewport) {
    return {
      width: viewport.clientWidth - VIEWPORT_PADDING * 2,
      height: viewport.clientHeight - VIEWPORT_PADDING * 2,
      live: true,
    };
  }
  return {
    width: window.innerWidth - VIEWPORT_PADDING * 2,
    height: window.innerHeight - VIEWPORT_PADDING * 2,
    live: false,
  };
}

export const DeskProfiles = observer(function DeskProfiles() {
  const [store, setStore] = useState<ProfileStore | null>(() =>
    managerApi()?.read() ?? readStore(localStorage),
  );
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [area, setArea] = useState(measureDeskArea);

  const refresh = useCallback(() => {
    setStore(managerApi()?.read() ?? readStore(localStorage));
    setArea(measureDeskArea());
  }, []);

  useEffect(() => {
    const onResize = () => setArea(measureDeskArea());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /**
   * Falls back to writing storage directly when there is no desk on the page.
   * The standalone options page has no bookmark manager, and refusing to let
   * profiles be edited there would be a worse answer than applying the change
   * on the next new tab.
   */
  const commit = useCallback(
    (next: ProfileStore) => {
      writeStore(localStorage, next);
      setStore(next);
    },
    [],
  );

  const active = store ? activeProfile(store) : null;

  /**
   * What the desk becomes at this size — computed with the SAME function the
   * desk itself uses.
   *
   * An earlier version of this readout divided the screen by the cell size,
   * which is only the answer for an empty profile. With icons already placed,
   * the desk shrinks the cell to fit their reach, so the readout confidently
   * announced "8 x 4 cells" while the desk stayed at 17 x 9. A readout that
   * disagrees with the thing it is describing is worse than no readout.
   */
  const projection = useMemo(() => {
    if (!active) return null;
    const reach = contentExtent(
      Object.entries(active.positions).map(([, pos]) => ({
        panel: "full-screen-panel",
        row: pos.row,
        col: pos.col,
      })),
    );
    const canvas = resolveCanvas({
      active: { cols: reach.maxCol + 1, rows: reach.maxRow + 1 },
      availableWidth: area.width,
      availableHeight: area.height,
      logicalCell: logicalCellSize(settings.squareDials as boolean),
      capCell: active.cellSize,
      base: {
        width: settings.basePageWidth as number,
        height: settings.basePageHeight as number,
      },
      fixed:
        (settings.gridCols as number) > 0 && (settings.gridRows as number) > 0
          ? { cols: settings.gridCols as number, rows: settings.gridRows as number }
          : null,
      squareDials: settings.squareDials as boolean,
    });
    return {
      cols: canvas.cols,
      rows: canvas.rows,
      // Below the asked-for size means the arrangement, not the setting, is
      // deciding — worth saying out loud rather than leaving as a silent gap
      // between the slider and the screen.
      actualCell: Math.round(canvas.cell),
      heldDown: canvas.cell < active.cellSize - 0.5,
    };
  }, [active, area]);

  if (!store || !active) return null;

  const api = managerApi();
  const iconPx = Math.round(active.cellSize * 0.62);
  const empty = isEmptyProfile(active);
  const placed = Object.keys(active.positions).length;

  const onSwitch = (id: string) => {
    if (id === active.id) return;
    if (api) {
      api.switch(id);
      refresh();
    } else {
      commit(setActiveProfile(store, id));
    }
  };

  const onCellSize = (px: number) => {
    const value = clampCellSize(px);
    if (api) {
      api.setCellSize(active.id, value);
      refresh();
    } else {
      commit(setCellSize(store, active.id, value));
    }
  };

  const onCreate = () => {
    const name = `Profile ${store.profiles.length + 1}`;
    if (api) {
      api.create(name, active.cellSize);
      refresh();
    } else {
      commit(
        addProfile(
          store,
          createProfileObject({
            name,
            cellSize: active.cellSize,
            screenHint: { width: window.innerWidth, height: window.innerHeight },
          }),
        ),
      );
    }
    setRenaming(true);
    setDraftName(name);
  };

  const onTidy = () => {
    if (!api) return;
    api.tidy();
    refresh();
  };

  const onDuplicate = () => {
    if (api) {
      api.duplicate(active.id);
      refresh();
    } else {
      commit(duplicateProfile(store, active.id));
    }
  };

  const onDelete = () => {
    if (store.profiles.length <= 1) return;
    if (!window.confirm(`Delete the "${active.name}" profile and its arrangement?`)) return;
    if (api) {
      api.remove(active.id);
      refresh();
    } else {
      commit(deleteProfile(store, active.id));
    }
  };

  const commitRename = () => {
    const name = draftName.trim();
    if (name) {
      if (api) {
        api.rename(active.id, name);
        refresh();
      } else {
        commit(renameProfile(store, active.id, name));
      }
    }
    setRenaming(false);
  };

  return (
    <div className="setting-wrapper setting-group desk-profile-group">
      <div className="setting-label">
        <div className="setting-title" id="desk-profile-title">
          Desk Profile
        </div>
        <div className="setting-description" id="desk-profile-description">
          One arrangement and one icon size per screen you use. A television
          three metres away and a laptop on your knees want different sized
          icons at the same resolution, and nothing but you knows how far away
          you are sitting.
          <br />
          <br />
          Bookmarks are shared between profiles; where you put them is not. A new
          profile starts with every icon gathered into a block at the top left,
          so the size you pick applies in full &mdash; then you arrange from
          there. Changing the size later never moves an icon; use Tidy when you
          want them gathered up again.
        </div>
      </div>

      <div className="setting-option desk-profile-control">
        <div className="desk-profile-row">
          {renaming ? (
            <input
              className="input desk-profile-name"
              value={draftName}
              autoFocus
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                // Both keys are handled here and stop there. Escape otherwise
                // reaches the modal and closes the whole settings panel, so
                // abandoning a rename would throw the user out of settings.
                if (e.key === "Enter") {
                  e.stopPropagation();
                  commitRename();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setRenaming(false);
                }
              }}
              aria-label="Profile name"
            />
          ) : (
            <select
              className="input desk-profile-select"
              value={active.id}
              onChange={(e) => onSwitch(e.target.value)}
              aria-labelledby="desk-profile-title"
            >
              {store.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.cellSize}px
                  {Object.keys(p.positions).length === 0 ? " (empty)" : ""}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn desk-profile-add" onClick={onCreate}>
            New
          </button>
        </div>

        <div className="desk-profile-size">
          <label className="desk-profile-size-label" htmlFor="desk-cell-size">
            Icon size
          </label>
          <div className="desk-profile-size-row">
            <input
              id="desk-cell-size"
              type="range"
              min={CELL_SIZE_MIN}
              max={CELL_SIZE_MAX}
              step={1}
              value={active.cellSize}
              onChange={(e) => onCellSize(parseInt(e.target.value, 10))}
              className="scale-slider desk-profile-slider"
            />
            <span className="scale-value">{active.cellSize}px</span>
          </div>
        </div>

        {/*
          Drawn at the size it will actually be, not scaled to fit a swatch.
          A slider position and a pixel count both need translating before they
          mean anything from where the user is sitting; an icon does not.
        */}
        <div className="desk-profile-preview">
          <div
            className="desk-profile-preview-cell"
            style={{ width: `${active.cellSize}px`, height: `${active.cellSize}px` }}
            aria-hidden="true"
          >
            <div
              className="desk-profile-preview-icon"
              style={{ width: `${iconPx}px`, height: `${iconPx}px` }}
            />
            {settings.showTitle && (
              <div className="desk-profile-preview-title">Example</div>
            )}
          </div>
          <div className="desk-profile-readout">
            {projection && (
              <span>
                Desk: <strong>{projection.cols} &times; {projection.rows}</strong> cells
                {projection.heldDown && (
                  <>
                    {" "}
                    at <strong>{projection.actualCell}px</strong>
                  </>
                )}
              </span>
            )}
            <span className="desk-profile-note">
              {empty
                ? "Nothing placed yet — set the size, then arrange."
                : projection?.heldDown
                  ? `Your ${placed} icons already reach across the screen, so the ` +
                    "desk is holding cells smaller than this to keep the furthest " +
                    "one visible. Tidy them into a block to use the full size."
                  : `${placed} icon${placed === 1 ? "" : "s"} placed. Changing the ` +
                    "size keeps every one of them in its cell; only how much empty " +
                    "desk you have changes."}
            </span>
            {!area.live && (
              <span className="desk-profile-note">
                Estimated from this window — open settings from a new tab to
                measure the real desk.
              </span>
            )}
          </div>
        </div>

        <div className="desk-profile-actions">
          {/*
            Explicit, never automatic. Re-flowing icons whenever the size
            changes would be the very reflow this architecture exists to
            abolish — but after choosing a new size there has to be SOME way to
            gather the icons back into it, so it is offered as a button.
          */}
          <button
            type="button"
            className="btn desk-profile-tidy"
            onClick={onTidy}
            disabled={!api}
            title={
              api
                ? "Lay every icon out from the top left at this size"
                : "Available from a new tab, where the desk is on screen"
            }
          >
            Tidy into a block
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraftName(active.name);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button type="button" className="btn" onClick={onDuplicate}>
            Duplicate
          </button>
          <button
            type="button"
            className="btn"
            onClick={onDelete}
            disabled={store.profiles.length <= 1}
            title={
              store.profiles.length <= 1
                ? "The last profile cannot be deleted"
                : undefined
            }
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
});
