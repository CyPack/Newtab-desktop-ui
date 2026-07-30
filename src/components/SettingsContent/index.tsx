import { clsx } from "clsx/lite";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";

import "./styles.css";

import { About } from "#components/About";
import { ColorPicker } from "#components/ColorPicker";
import { CaretDown } from "#components/icons/CaretDown.tsx";
import {
  DESK_ZOOM_MAX,
  DESK_ZOOM_MIN,
  logicalCellSize,
  maxCellSize,
} from "#components/Grid/layout";
import { wallpapers } from "#lib/wallpapers";
import { bookmarks } from "#stores/useBookmarks";
import { colorPicker } from "#stores/useColorPicker";
import { settings } from "#stores/useSettings";
import { Switch } from "./Switch.tsx";

export const SettingsContent = observer(function SettingsContent() {
  const {
    handleAttachTitle,
    handleCustomColor,
    handleCustomImage,
    handleDefaultFolder,
    handleBasePage,
    handleDeskAnchor,
    handleDeskZoom,
    handleDialSize,
    handleGridCanvas,
    handleGridLayout,
    handleLimitDialScale,
    handleMaxColumns,
    handleMaxDialScale,
    handleNewTab,
    handleShowTitle,
    handleSquareDials,
    handleSwitchTitle,
    handleThemeOption,
    handleTransparentDials,
    handleWallpaper,
    resetSettings,
    restoreFromJSON,
    saveToJSON,
  } = settings;

  const [defaultFolderValue, setDefaultFolderValue] = useState("");

  // 0/0 means automatic: the desk takes the screen's shape and is scaled to
  // the icons' reach. Show a sensible starting point in the manual controls so
  // they never display a zero.
  const fixedDesk =
    (settings.gridCols as number) > 0 && (settings.gridRows as number) > 0;
  const canvasCols = fixedDesk ? (settings.gridCols as number) : 14;
  const canvasRows = fixedDesk ? (settings.gridRows as number) : 7;

  // The ceiling the zoom asks for, and what the desk actually settled on.
  //
  // These are not always the same number, and the difference is the whole
  // reason the readout exists: zoom raises a CEILING, so once the active area
  // is what limits the cell size, dragging the slider further does nothing
  // visible. Without saying so, that reads as a broken control.
  const zoomedCap = maxCellSize(
    settings.dialSize as string,
    settings.squareDials as boolean,
    settings.limitDialScale as boolean,
    settings.maxDialScale as number,
    settings.deskZoom as number,
  );
  const [actualCell, setActualCell] = useState<number | null>(null);

  useEffect(() => {
    // Settings open as a modal over the live desk, so it can be measured. On
    // the standalone options page there is no desk, and the readout falls back
    // to the ceiling on its own.
    const read = () => {
      const grid = document.querySelector('[data-panel="full-screen-panel"]');
      if (!grid) return setActualCell(null);
      const scale = parseFloat(
        getComputedStyle(grid).getPropertyValue("--desk-scale") || "",
      );
      const logical = logicalCellSize(settings.squareDials as boolean);
      setActualCell(Number.isFinite(scale) ? scale * logical : null);
    };
    // One frame later: the desk re-renders in response to the same change.
    const id = requestAnimationFrame(read);
    return () => cancelAnimationFrame(id);
  }, [
    settings.deskZoom,
    settings.dialSize,
    settings.gridCols,
    settings.gridRows,
    settings.limitDialScale,
    settings.maxDialScale,
    settings.squareDials,
  ]);

  const cappedByDesk =
    actualCell !== null && Number.isFinite(zoomedCap) && actualCell < zoomedCap - 1;

  const wallpaperColors = [
    "Dark",
    "Light", 
    "Brown",
    "Blue",
    "Yellow",
    "Green",
    "Pink",
  ];

  useEffect(() => {
    const setDefaultFolder = async () => {
      const isValid =
        settings.defaultFolder && typeof settings.defaultFolder === "string"
          ? await bookmarks.validateFolderExists(settings.defaultFolder)
          : false;
      const value = isValid
        ? settings.defaultFolder
        : await bookmarks.getBookmarksBarId();
      setDefaultFolderValue(value as string);
    };
    setDefaultFolder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.defaultFolder]);

  function getImageUrl(thumbnail: string) {
    return new URL(`/src/assets/wallpaper-thumbs/${thumbnail}`, import.meta.url)
      .href;
  }

  return (
    <>
      <div className="setting-wrapper">
        <div className="setting-title" id="background-title">
          Background
        </div>
        <div className="setting-description" id="background-description">
          Choose a background color or image.
        </div>
        <div className="setting-option wallpapers">
          {}
          {wallpaperColors.map((wallpaper) => (
            <button
              type="button"
              id={`${wallpaper.toLowerCase()}-wallpaper`}
              className={clsx(
                "wallpaper-button",
                settings.wallpaper === `${wallpaper.toLowerCase()}-wallpaper`
                  ? "selected"
                  : false,
              )}
              title={wallpaper}
              onClick={() => {
                handleWallpaper(`${wallpaper.toLowerCase()}-wallpaper`);
              }}
              key={wallpaper}
            />
          ))}
          {/* Image wallpapers from all categories */}
          {wallpapers.map(({ id, title, thumbnail }) => (
            <button
              type="button"
              className={clsx(
                "wallpaper-button",
                settings.wallpaper === id ? "selected" : false,
              )}
              style={{
                backgroundImage: `url(${getImageUrl(thumbnail)})`,
              }}
              title={title}
              onClick={() => {
                handleWallpaper(id);
              }}
              key={id}
            />
          ))}
          {/* Custom Color - only show if color is set */}
          {settings.customColor && (
            <button
              type="button"
              className={clsx(
                "wallpaper-button",
                settings.wallpaper === "custom-color" ? " selected" : false,
              )}
              style={{
                backgroundColor: settings.customColor as string,
              }}
              title="Custom Color"
              onClick={() => {
                handleWallpaper("custom-color");
              }}
            />
          )}
          {/* Custom Image - only show if image is set */}
          {settings.customImage && (
            <button
              type="button"
              id="custom-image"
              className={clsx(
                "wallpaper-button",
                settings.wallpaper === "custom-image" ? " selected" : false,
              )}
              style={{
                backgroundImage: `url(${settings.customImage})`,
              }}
              title="Custom Image"
              onClick={() => {
                handleWallpaper("custom-image");
              }}
            />
          )}
        </div>
        {/* Custom selection buttons */}
        <div className="custom-buttons">
          <button
            type="button"
            className="btn defaultBtn custom customColor"
            onClick={colorPicker.openColorPicker}
          >
            Select Color
          </button>
          <button
            type="button"
            className="btn defaultBtn custom"
            onClick={handleCustomImage}
          >
            Select Image
          </button>
        </div>
        {colorPicker.isOpen && (
          <ColorPicker
            {...{
              color: settings.customColor as string,
              handler: handleCustomColor,
              label: "Background Color",
            }}
          />
        )}
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="default-folder-title">
            Default Folder
          </div>
          <div className="setting-description" id="default-folder-description">
            Select the bookmark folder used to display your speed dials.
          </div>
        </div>
        <div className="setting-option select">
          <select
            onChange={(e) => handleDefaultFolder(e.target.value)}
            value={defaultFolderValue}
            className="input"
            aria-labelledby="default-folder-title"
            aria-describedby="default-folder-description"
          >
            {bookmarks.folders.map(({ id, title }) => (
              <option value={id} key={id}>
                {title}
              </option>
            ))}
          </select>
          <CaretDown />
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="grid-layout-title">
            Grid Layout
          </div>
          <div className="setting-description" id="grid-layout-description">
            Choose the grid layout for organizing your bookmarks into panels.
          </div>
        </div>
        <div className="setting-option select">
          <select
            onChange={(e) => handleGridLayout(e.target.value)}
            value={settings.gridLayout as string}
            className="input"
            aria-labelledby="grid-layout-title"
            aria-describedby="grid-layout-description"
          >
            <option value="2-panel">2 Panels</option>
            <option value="3-panel">3 Panels</option>
            <option value="4-panel">4 Panels</option>
            <option value="full-screen">Full Screen</option>
          </select>
          <CaretDown />
        </div>
      </div>
      {settings.gridLayout === "full-screen" && (
        <>
          <div className="setting-wrapper setting-group canvas-size-group">
            <div className="setting-label">
              <div className="setting-title" id="base-page-title">
                Starting Desk Size
              </div>
              <div className="setting-description" id="base-page-description">
                How much desk an <em>empty</em> desktop begins with, given as the
                screen it should fill &mdash; a 24&Prime; monitor by default.
                Once you have placed icons, this no longer applies: from then on
                the desk is sized by how far your furthest icon reaches, and it
                grows as you move icons outwards.
              </div>
            </div>
            <div className="setting-option canvas-size-control">
              <div className="canvas-size-row">
                <label className="canvas-size-field">
                  <span>Width</span>
                  <input
                    type="number"
                    min={320}
                    max={7680}
                    step={80}
                    value={settings.basePageWidth as number}
                    onChange={(e) =>
                      handleBasePage(
                        parseInt(e.target.value, 10),
                        settings.basePageHeight as number,
                      )
                    }
                    className="input canvas-size-input"
                    aria-label="Base screen width in pixels"
                  />
                </label>
                <span className="canvas-size-times" aria-hidden="true">
                  &times;
                </span>
                <label className="canvas-size-field">
                  <span>Height</span>
                  <input
                    type="number"
                    min={240}
                    max={4320}
                    step={60}
                    value={settings.basePageHeight as number}
                    onChange={(e) =>
                      handleBasePage(
                        settings.basePageWidth as number,
                        parseInt(e.target.value, 10),
                      )
                    }
                    className="input canvas-size-input"
                    aria-label="Base screen height in pixels"
                  />
                </label>
              </div>
              <span className="canvas-preview-caption">
                empty desktop only
              </span>
            </div>
          </div>

          <div className="setting-wrapper setting-group">
            <div className="setting-label">
              <div className="setting-title" id="desk-anchor-title">
                Desk Anchor
              </div>
              <div className="setting-description" id="desk-anchor-description">
                Where your icons are held as the screen changes size. Either way
                the relationship is fixed, so nothing appears to drift.
              </div>
            </div>
            <div className="setting-option select">
              <select
                onChange={(e) => handleDeskAnchor(e.target.value)}
                value={settings.deskAnchor as string}
                className="input"
                aria-labelledby="desk-anchor-title"
                aria-describedby="desk-anchor-description"
              >
                <option value="center">Centred</option>
                <option value="top-left">Top left corner</option>
              </select>
              <CaretDown />
            </div>
          </div>

          <div className="setting-wrapper setting-group canvas-size-group">
            <div className="setting-label">
              <div className="setting-title" id="grid-canvas-title">
                Fixed Desk Size
              </div>
              <div className="setting-description" id="grid-canvas-description">
                Optional. Pin the desk to an exact number of columns and rows and
                it will never take the screen&rsquo;s shape or crop &mdash; just
                scale. Leave it off to let the desk fill the window and follow
                your icons.
              </div>
            </div>
            <div className="setting-option canvas-size-control">
              <Switch
                aria-labelledby="grid-canvas-title"
                aria-describedby="grid-canvas-description"
                onClick={() =>
                  fixedDesk
                    ? handleGridCanvas(0, 0)
                    : handleGridCanvas(canvasCols, canvasRows)
                }
                className="switch-root"
                checked={fixedDesk}
              >
                <span className="switch-thumb" />
              </Switch>
              {fixedDesk && (
                <>
                  <div className="canvas-size-row">
                    <label className="canvas-size-field">
                      <span>Columns</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={canvasCols}
                        onChange={(e) =>
                          handleGridCanvas(
                            parseInt(e.target.value, 10),
                            canvasRows,
                          )
                        }
                        className="input canvas-size-input"
                        aria-label="Desk columns"
                      />
                    </label>
                    <span className="canvas-size-times" aria-hidden="true">
                      &times;
                    </span>
                    <label className="canvas-size-field">
                      <span>Rows</span>
                      <input
                        type="number"
                        min={1}
                        max={40}
                        value={canvasRows}
                        onChange={(e) =>
                          handleGridCanvas(
                            canvasCols,
                            parseInt(e.target.value, 10),
                          )
                        }
                        className="input canvas-size-input"
                        aria-label="Desk rows"
                      />
                    </label>
                  </div>
                  <div className="canvas-preview" aria-hidden="true">
                    <div
                      className="canvas-preview-frame"
                      style={{
                        gridTemplateColumns: `repeat(${canvasCols}, 1fr)`,
                        gridTemplateRows: `repeat(${canvasRows}, 1fr)`,
                        aspectRatio: `${canvasCols} / ${canvasRows}`,
                      }}
                    >
                      {Array.from(
                        { length: canvasCols * canvasRows },
                        (_, i) => (
                          <span className="canvas-preview-cell" key={i} />
                        ),
                      )}
                    </div>
                    <span className="canvas-preview-caption">
                      {canvasCols * canvasRows} slots
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="color-scheme-title">
            Color Scheme
          </div>
          <div className="setting-description" id="color-scheme-description">
            Choose the color scheme for New Tab Desktop UI. If set to
            &quot;Automatic,&quot; it will follow your system&apos;s light or
            dark mode preference.
          </div>
        </div>
        <div className="setting-option select">
          <select
            onChange={(e) => handleThemeOption(e.target.value)}
            value={settings.themeOption}
            className="input"
            aria-labelledby="color-scheme-title"
            aria-describedby="color-scheme-description"
          >
            {["Automatic", "Light", "Dark"].map((t) => (
              <option value={t === "Automatic" ? "System Theme" : t} key={t}>
                {t}
              </option>
            ))}
          </select>
          <CaretDown />
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="open-new-tabs-title">
            Open in New Tab
          </div>
          <div className="setting-description" id="open-new-tabs-description">
            Open all bookmarks in a new browser tab instead of the current one.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="open-new-tabs-title"
            aria-describedby="open-new-tabs-description"
            onClick={() => handleNewTab(!settings.newTab)}
            className="switch-root"
            checked={settings.newTab as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="max-cols-title">
            Maximum Columns
          </div>
          <div className="setting-description" id="max-cols-description">
            Choose the maximum number of columns to display based on your screen
            size.
          </div>
        </div>
        <div className="setting-option select">
          <select
            onChange={(e) => handleMaxColumns(e.target.value)}
            value={settings.maxColumns as string}
            className="input"
            aria-labelledby="max-cols-title"
            aria-describedby="max-cols-description"
          >
            {[
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "10",
              "11",
              "12",
              "Unlimited",
            ].map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </select>
          <CaretDown />
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="dial-size-title">
            Dial Size
          </div>
          <div className="setting-description" id="dial-size-description">
            Choose the size of the speed dial icons.
          </div>
        </div>
        <div className="setting-option select">
          <select
            onChange={(e) => handleDialSize(e.target.value)}
            value={settings.dialSize as string}
            className="input"
            aria-labelledby="dial-size-title"
            aria-describedby="dial-size-description"
          >
            {[
              { label: "Extra Tiny", value: "extra-tiny" },
              { label: "Tiny", value: "tiny" },
              { label: "Small", value: "small" },
              { label: "Medium", value: "medium" },
              { label: "Large", value: "large" },
              { label: "Huge", value: "huge" },
              { label: "Scale to Fit", value: "scale" },
            ].map(({ label, value }) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <CaretDown />
        </div>
      </div>
      {settings.gridLayout === "full-screen" && (
        <div className="setting-wrapper setting-group desk-zoom-group">
          <div className="setting-label">
            <div className="setting-title" id="desk-zoom-title">
              Desk Zoom
            </div>
            <div className="setting-description" id="desk-zoom-description">
              Scale everything on the desk at once &mdash; icons, labels and the
              spacing between them. Nothing changes position: an icon in the
              third column stays in the third column, it just gets bigger or
              smaller along with the grid. Zoom out and more empty grid comes
              into view to place icons in.
            </div>
          </div>
          <div className="setting-option desk-zoom-control">
            <div className="desk-zoom-row">
              <input
                type="range"
                min={DESK_ZOOM_MIN}
                max={DESK_ZOOM_MAX}
                step={0.05}
                value={settings.deskZoom as number}
                onChange={(e) => handleDeskZoom(parseFloat(e.target.value))}
                className="scale-slider desk-zoom-slider"
                aria-labelledby="desk-zoom-title"
                aria-describedby="desk-zoom-description"
              />
              <span className="scale-value">
                {(settings.deskZoom as number).toFixed(2)}&times;
              </span>
            </div>
            <div className="desk-zoom-readout">
              {actualCell !== null ? (
                <>
                  <span>
                    Cell now <strong>{Math.round(actualCell)}px</strong>
                  </span>
                  {cappedByDesk && (
                    // Said plainly, because otherwise the top of the slider
                    // looks broken: it is still moving the ceiling, but the
                    // desk is already fitting to the icons instead.
                    <span className="desk-zoom-note">
                      held down to fit your furthest icon &mdash; zooming in
                      further won&rsquo;t enlarge it
                    </span>
                  )}
                </>
              ) : (
                <span>
                  Ceiling{" "}
                  <strong>
                    {Number.isFinite(zoomedCap)
                      ? `${Math.round(zoomedCap)}px`
                      : "unlimited"}
                  </strong>{" "}
                  per cell
                </span>
              )}
            </div>
            {(settings.deskZoom as number) !== 1 && (
              <button
                type="button"
                className="btn desk-zoom-reset"
                onClick={() => handleDeskZoom(1)}
              >
                Reset to 1.00&times;
              </button>
            )}
          </div>
        </div>
      )}
      {settings.dialSize === "scale" && (
        <div className="setting-wrapper setting-group scale-limit-group">
          <div className="setting-label">
            <div className="setting-title" id="scale-limit-title">
              Maximum Scale Limit
            </div>
            <div
              className="setting-description"
              id="scale-limit-description"
            >
              Limit how large dials grow on big screens. Turn off for unlimited
              growth, or set the maximum size.
            </div>
          </div>
          <div className="setting-option scale-limit-control">
            <Switch
              aria-labelledby="scale-limit-title"
              aria-describedby="scale-limit-description"
              onClick={() => handleLimitDialScale(!settings.limitDialScale)}
              className="switch-root"
              checked={settings.limitDialScale as boolean}
            >
              <span className="switch-thumb" />
            </Switch>
            {settings.limitDialScale && (
              <>
                <div
                  className="scale-slider-row"
                  style={{ display: "flex", alignItems: "center" }}
                >
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={0.1}
                    value={settings.maxDialScale}
                    onChange={(e) =>
                      handleMaxDialScale(parseFloat(e.target.value))
                    }
                    className="scale-slider"
                    aria-label="Maximum dial scale"
                  />
                  <span className="scale-value">
                    {settings.maxDialScale.toFixed(1)}×
                  </span>
                </div>
                <div className="scale-preview" aria-hidden="true">
                  <div
                    className="scale-preview-box"
                    style={{
                      width: `${Math.round(settings.maxDialScale * 30)}px`,
                      height: `${Math.round(settings.maxDialScale * 30)}px`,
                    }}
                  >
                    <span className="scale-preview-glyph">A</span>
                  </div>
                  <span className="scale-preview-caption">Preview</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="square-dials-title">
            Square Dials
          </div>
          <div className="setting-description" id="square-dials-description">
            Make all dials square-shaped instead of rectangular.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="square-dials-title"
            aria-describedby="square-dials-description"
            onClick={() => handleSquareDials(!settings.squareDials)}
            className="switch-root"
            checked={settings.squareDials as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="transparent-dials-title">
            Transparent Dials
          </div>
          <div
            className="setting-description"
            id="transparent-dials-description"
          >
            Make all dial backgrounds transparent to show the background image
            behind them.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="transparent-dials-title"
            aria-describedby="transparent-dials-description"
            onClick={() => handleTransparentDials(!settings.transparentDials)}
            className="switch-root"
            checked={settings.transparentDials as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="show-title-title">
            Show Title
          </div>
          <div className="setting-description" id="show-title-description">
            Display the bookmark&apos;s title below the dial.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="show-title-title"
            aria-describedby="show-title-description"
            onClick={() => handleShowTitle(!settings.showTitle)}
            className="switch-root"
            checked={settings.showTitle as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="switch-title-title">
            Switch Title and URL
          </div>
          <div className="setting-description" id="switch-title-description">
            Show the bookmark&apos;s title in the dial instead of the URL.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="switch-title-title"
            aria-describedby="switch-title-description"
            onClick={() => handleSwitchTitle(!settings.switchTitle)}
            className="switch-root"
            checked={settings.switchTitle as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="attach-title-title">
            Attach Title to Dial
          </div>
          <div className="setting-description" id="attach-title-description">
            Remove spacing between the title and dial, connecting them directly.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="attach-title-title"
            aria-describedby="attach-title-description"
            onClick={() => handleAttachTitle(!settings.attachTitle)}
            className="switch-root"
            checked={settings.attachTitle as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="reset-backup-restore-title">
            Backup and Restore
          </div>
          <div
            className="setting-description"
            id="reset-backup-restore-description"
          >
            Save a file with all your settings, including custom background
            image/color and dial images/colors. Restoring a backup will replace
            your current settings.
          </div>
        </div>
        <div className="setting-option backup-restore">
          <button type="button" className="btn defaultBtn" onClick={saveToJSON}>
            Backup
          </button>
          <button
            type="button"
            className="btn defaultBtn"
            onClick={restoreFromJSON}
          >
            Restore
          </button>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="reset-backup-restore-title">
            Reset Settings
          </div>
          <div
            className="setting-description"
            id="reset-backup-restore-description"
          >
            Reset all settings to their defaults. Custom background image/color
            and dial images/colors will be cleared. This cannot be undone.
          </div>
        </div>
        <div className="setting-option reset">
          <button
            type="button"
            className="btn defaultBtn"
            onClick={resetSettings}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="setting-wrapper about">
        <About />
      </div>
    </>
  );
});