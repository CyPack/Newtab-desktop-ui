import { clsx } from "clsx/lite";
import { autorun, makeAutoObservable, remove, runInAction, set } from "mobx";
import semverCoerce from "semver/functions/coerce";
import semverGt from "semver/functions/gt";
import browser from "webextension-polyfill";

import { mockBookmarks } from "#stores/useBookmarks/mockBookmarks";
import { recordSnapshot } from "#components/Grid/positionStore";
import {
  PROFILES_KEY,
  isLegacyBackup,
  readStore as readProfileStore,
  storeFromArrangement,
  writeStore as writeProfileStore,
} from "#components/Grid/deskProfiles";
import { maxCellSize, referenceCellSize } from "#components/Grid/layout";

// ==================================================================
// SETUP
// ==================================================================

const appVersion = __APP_VERSION__;
const apiVersion = "2.0";

async function getCustomImage() {
  /*
   * IndexedDB storage allows images to be stored as blob.
   * Chrome storage requires blobs to be converted to base64.
   * Firefox storage allows images to be stored as blob.
   * This store always converts to base64 to avoid multiple implementations.
   */
  try {
    const { [`${apiVersion}-custom-image`]: image } =
      await browser.storage.local.get(`${apiVersion}-custom-image`);
    if (image) {
      const blobImage = base64ToBlob(image as string);
      const imageURI = URL.createObjectURL(blobImage);
      return imageURI;
    } else {
      return "";
    }
  } catch (error) {
    console.error("Error loading custom image:", error);
  }
}

function prefersDarkMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getColorScheme(value: string) {
  return (value === "System Theme" && prefersDarkMode()) || value === "Dark"
    ? "color-scheme-dark"
    : "color-scheme-light";
}

const storage: Record<string, unknown> = await browser.storage.local.get();
const lastVersion =
  semverCoerce(storage["last-version"] as string)?.version || false;
const isUpgrade = lastVersion && semverGt(appVersion, lastVersion);
browser.storage.local.set({ "last-version": appVersion });
const themeOption =
  (storage[`${apiVersion}-theme-option`] as string) || "System Theme";
const colorScheme = getColorScheme(themeOption);
let wallpaper = storage[`${apiVersion}-wallpaper`];

const customImage = await getCustomImage();
wallpaper =
  typeof wallpaper === "string" && wallpaper.includes("custom-image")
    ? "custom-image"
    : (wallpaper as string) ||
      "dark-wallpaper";

/* Handle changes page between open tabs. */
const bc = new BroadcastChannel("easy-settings");
bc.onmessage = (e) => {
  // When settings are updated in another tab, update this tab's settings as well.
  runInAction(() => set(settings, e.data));
};

// ==================================================================
// PANEL BOOKMARKS HELPER FUNCTIONS
// ==================================================================

/**
 * Normalises one entry for the backup file.
 *
 * `index` used to be stamped onto every entry, defaulting to 0. On the
 * full-screen desk that is a lie — position there is (row, col) — and it left
 * the file claiming that every icon sat in slot 0. It is now written only where
 * it means something: entries that carry no coordinates.
 */
function validateForBackup(item: any) {
  const hasCoords = typeof item?.row === 'number' && typeof item?.col === 'number';
  const validated: any = {
    ...item,
    panel: item?.panel || 'top-left',
    isPanelBookmark: true,
  };
  if (!hasCoords) {
    validated.index = typeof item?.index === 'number' ? item.index : 0;
  }
  return validated;
}

function getPanelBookmarksData() {
  try {
    const panelBookmarkManager = (window as any).panelBookmarkManager;
    if (panelBookmarkManager && typeof panelBookmarkManager.exportPanelBookmarks === 'function') {
      const data = panelBookmarkManager.exportPanelBookmarks();
      if (Array.isArray(data)) {
        const validatedData = data.map(validateForBackup);
        console.log('Validated panel bookmarks for backup:', validatedData.length, 'items');
        return validatedData;
      }
    }
  } catch (error) {
    console.warn('Failed to get panel bookmarks data:', error);
  }

  // Fallback: the live arrangement, read straight from storage. Reached when
  // the backup is triggered from a surface that never mounted the grid.
  try {
    const raw = localStorage.getItem('panel-bookmarks');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        console.log('Fallback: got panel bookmarks from localStorage:', parsed.length, 'items');
        return parsed.map(validateForBackup);
      }
    }
  } catch (error) {
    console.warn('Failed to get panel bookmarks from localStorage:', error);
  }

  return [];
}

function setPanelBookmarksData(data: any[]) {
  try {
    if (!Array.isArray(data)) {
      console.warn('Invalid panel bookmarks data format');
      return false;
    }
    
    // Validate and clean data before importing.
    //
    // The full-screen desk is positioned by (row, col); `index` is the older
    // flat ordering that only the panel layouts still use. Insisting on a
    // numeric `index` here dropped every coordinate-only entry on the floor —
    // silently, since the filter reports nothing. Either form of position is
    // accepted, and whichever one the entry carries is preserved.
    const cleanedData = data.filter(item => {
      if (!item || typeof item !== 'object' || !item.id || !item.panel) return false;
      const hasIndex = typeof item.index === 'number' && Number.isFinite(item.index);
      const hasCoords = typeof item.row === 'number' && typeof item.col === 'number';
      return hasIndex || hasCoords;
    }).map(item => {
      const cleaned: any = {
        ...item,
        isPanelBookmark: true,
        panel: String(item.panel),
      };
      if (typeof item.index === 'number' && Number.isFinite(item.index)) {
        cleaned.index = Math.trunc(item.index);
      }
      if (typeof item.row === 'number' && typeof item.col === 'number') {
        cleaned.row = Math.max(0, Math.trunc(item.row));
        cleaned.col = Math.max(0, Math.trunc(item.col));
      }
      return cleaned;
    });

    const dropped = data.length - cleanedData.length;
    if (dropped > 0) {
      console.warn(`Skipped ${dropped} bookmark(s) with no usable position`);
    }
    
    console.log('Cleaned panel bookmarks data:', cleanedData.length, 'items from', data.length, 'original items');
    
    const panelBookmarkManager = (window as any).panelBookmarkManager;
    if (panelBookmarkManager && typeof panelBookmarkManager.importPanelBookmarks === 'function') {
      panelBookmarkManager.importPanelBookmarks(cleanedData);
      console.log('Imported panel bookmarks data via manager:', cleanedData.length, 'items');
      return true;
    }
  } catch (error) {
    console.warn('Failed to set panel bookmarks data:', error);
  }
  
  // Fallback: try to save to localStorage directly
  try {
    const cleanedData = Array.isArray(data) ? data.filter(item => item && item.id) : [];
    localStorage.setItem('panel-bookmarks', JSON.stringify(cleanedData));
    console.log('Fallback: saved panel bookmarks to localStorage:', cleanedData.length, 'items');
    return true;
  } catch (error) {
    console.warn('Failed to save panel bookmarks to localStorage:', error);
  }
  
  return false;
}

// Helper function to get bookmarks bar ID
async function getBookmarksBarId() {
  try {
    const bookmarkTree = await browser.bookmarks.getTree();
    const bookmarksBar = bookmarkTree[0].children?.find(
      (node) => node.id === "1" || node.title === "Bookmarks Bar" || node.title === "Yer Ä°mleri Ã‡ubuÄŸu"
    );
    return bookmarksBar?.id || "1";
  } catch (error) {
    console.warn("Could not get bookmarks bar ID:", error);
    return "1"; // Default fallback
  }
}

// ==================================================================
// SETTINGS STORE
// ==================================================================

type DialColors = Record<string, string>;
type DialImages = Record<string, string>;

const defaultSettings = {
  attachTitle: false,
  colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "color-scheme-dark"
    : "color-scheme-light",
  customColor: "",
  customImage: "",
  defaultFolder: "",
  dialColors: {} as DialColors,
  dialImages: {} as DialImages,
  dialSize: "tiny",
  firstRun: !lastVersion,
  // Full-screen desk sizing. 0/0 means automatic: the desk fills the window
  // and is scaled to the icons' reach. Setting explicit columns and rows pins
  // the desk to exactly that size instead.
  gridCols: 0,
  gridRows: 0,
  // Where an empty desk starts — a 24" monitor in CSS pixels. Once icons are
  // placed, their reach takes over and this no longer applies.
  basePageWidth: 1920,
  basePageHeight: 1080,
  // Which corner (or centre) the content block is held against.
  deskAnchor: "center",
  gridLayout: "full-screen",
  limitDialScale: true,
  maxColumns: "Unlimited",
  maxDialScale: 1.6,
  newTab: false,
  showAlertBanner: !lastVersion || isUpgrade,
  showTitle: true,
  squareDials: false,
  switchTitle: false,
  themeOption: "System Theme",
  transparentDials: false,
  wallpaper: "dark-wallpaper", // Default dark wallpaper
};

export const settings = makeAutoObservable({
  attachTitle:
    storage[`${apiVersion}-attach-title`] ?? defaultSettings.attachTitle,
  colorScheme,
  customColor:
    storage[`${apiVersion}-custom-color`] || defaultSettings.customColor,
  customImage,
  defaultFolder:
    storage[`${apiVersion}-default-folder`] || defaultSettings.defaultFolder,
  dialColors:
    (storage[`${apiVersion}-dial-colors`] as DialColors) ||
    defaultSettings.dialColors,
  dialImages:
    (storage[`${apiVersion}-dial-images`] as DialImages) ||
    defaultSettings.dialImages,
  dialSize: storage[`${apiVersion}-dial-size`] || defaultSettings.dialSize,
  firstRun: defaultSettings.firstRun,
  gridCols:
    (storage[`${apiVersion}-grid-cols`] as number) ?? defaultSettings.gridCols,
  gridRows:
    (storage[`${apiVersion}-grid-rows`] as number) ?? defaultSettings.gridRows,
  basePageWidth:
    (storage[`${apiVersion}-base-page-width`] as number) ??
    defaultSettings.basePageWidth,
  basePageHeight:
    (storage[`${apiVersion}-base-page-height`] as number) ??
    defaultSettings.basePageHeight,
  deskAnchor:
    (storage[`${apiVersion}-desk-anchor`] as string) ??
    defaultSettings.deskAnchor,
  gridLayout: storage[`${apiVersion}-grid-layout`] || defaultSettings.gridLayout,
  limitDialScale:
    (storage[`${apiVersion}-limit-dial-scale`] as boolean) ??
    defaultSettings.limitDialScale,
  maxColumns:
    storage[`${apiVersion}-max-columns`] || defaultSettings.maxColumns,
  maxDialScale:
    (storage[`${apiVersion}-max-dial-scale`] as number) ??
    defaultSettings.maxDialScale,
  newTab: storage[`${apiVersion}-new-tab`] ?? defaultSettings.newTab,
  showAlertBanner: defaultSettings.showAlertBanner,
  showTitle: storage[`${apiVersion}-show-title`] ?? defaultSettings.showTitle,
  squareDials:
    storage[`${apiVersion}-square-dials`] ?? defaultSettings.squareDials,
  switchTitle:
    storage[`${apiVersion}-switch-title`] ?? defaultSettings.switchTitle,
  themeOption,
  transparentDials:
    storage[`${apiVersion}-transparent-dials`] ??
    defaultSettings.transparentDials,
  wallpaper,
  handleAttachTitle(value: boolean) {
    browser.storage.local.set({ [`${apiVersion}-attach-title`]: value });
    settings.attachTitle = value;
    bc.postMessage({ attachTitle: value });
  },
  handleClearColor(id: string) {
    if (settings.dialColors[id]) {
      remove(settings.dialColors, id);
      browser.storage.local.set({
        [`${apiVersion}-dial-colors`]: { ...settings.dialColors },
      });
      bc.postMessage({ dialColors: { ...settings.dialColors } });
    }
  },
  handleClearThumbnail(id: string) {
    if (settings.dialImages[id]) {
      remove(settings.dialImages, id);
      browser.storage.local.set({
        [`${apiVersion}-dial-images`]: { ...settings.dialImages },
      });
      bc.postMessage({ dialImages: { ...settings.dialImages } });
    }
  },
  handleCustomColor(value: string) {
    browser.storage.local.set({ [`${apiVersion}-custom-color`]: value });
    settings.customColor = value;
    settings.handleWallpaper("custom-color");
    bc.postMessage({ customColor: value });
  },
  handleCustomImage() {
    const i = document.createElement("input");
    i.type = "File";
    i.accept = "image/*";
    i.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const image = target.files?.[0];
      if (!image) return;

      if (!image.type.startsWith("image/")) {
        alert("Please select an image file.");
        return;
      }

      const imageURI = URL.createObjectURL(image);
      const base64 = await blobToBase64(image);
      await browser.storage.local.set({
        [`${apiVersion}-custom-image`]: base64,
      });
      settings.customImage = imageURI;
      settings.handleWallpaper("custom-image");
      bc.postMessage({ customImage: imageURI });
    };
    i.click();
  },
  handleDefaultFolder(value: string) {
    browser.storage.local.set({ [`${apiVersion}-default-folder`]: value });
    settings.defaultFolder = value;
    bc.postMessage({ defaultFolder: value });
  },
  handleDialColors(id: string, value: string) {
    set(settings.dialColors, id, value);
    browser.storage.local.set({
      [`${apiVersion}-dial-colors`]: { ...settings.dialColors },
    });
    bc.postMessage({
      dialColors: { ...settings.dialColors },
    });
  },
  handleDialSize(value: string) {
    browser.storage.local.set({ [`${apiVersion}-dial-size`]: value });
    settings.dialSize = value;
    bc.postMessage({ dialSize: value });
  },
  handleGridLayout(value: string) {
    browser.storage.local.set({ [`${apiVersion}-grid-layout`]: value });
    settings.gridLayout = value;
    bc.postMessage({ gridLayout: value });
  },
  // Sets the fixed logical canvas (columns x rows) for the full-screen layout.
  // Changing this is the ONLY thing that re-flows icon positions — resizing the
  // window never does.
  // Passing 0 for both resets it to "auto" (re-captured from the next viewport).
  handleGridCanvas(cols: number, rows: number) {
    const auto = cols <= 0 || rows <= 0;
    const safeCols = auto ? 0 : Math.max(1, Math.min(60, Math.round(cols)));
    const safeRows = auto ? 0 : Math.max(1, Math.min(40, Math.round(rows)));
    browser.storage.local.set({
      [`${apiVersion}-grid-cols`]: safeCols,
      [`${apiVersion}-grid-rows`]: safeRows,
    });
    settings.gridCols = safeCols;
    settings.gridRows = safeRows;
    bc.postMessage({ gridCols: safeCols, gridRows: safeRows });
  },
  // Where an empty desk starts. Physical inches aren't available to a web
  // page, so a 24" monitor is expressed as its CSS pixels.
  handleBasePage(width: number, height: number) {
    const safeWidth = Math.max(320, Math.min(7680, Math.round(width) || 1920));
    const safeHeight = Math.max(240, Math.min(4320, Math.round(height) || 1080));
    browser.storage.local.set({
      [`${apiVersion}-base-page-width`]: safeWidth,
      [`${apiVersion}-base-page-height`]: safeHeight,
    });
    settings.basePageWidth = safeWidth;
    settings.basePageHeight = safeHeight;
    bc.postMessage({ basePageWidth: safeWidth, basePageHeight: safeHeight });
  },
  handleDeskAnchor(value: string) {
    browser.storage.local.set({ [`${apiVersion}-desk-anchor`]: value });
    settings.deskAnchor = value;
    bc.postMessage({ deskAnchor: value });
  },
  handleMaxColumns(value: string) {
    browser.storage.local.set({ [`${apiVersion}-max-columns`]: value });
    settings.maxColumns = value;
    bc.postMessage({ maxColumns: value });
  },
  handleLimitDialScale(value: boolean) {
    browser.storage.local.set({ [`${apiVersion}-limit-dial-scale`]: value });
    settings.limitDialScale = value;
    bc.postMessage({ limitDialScale: value });
  },
  handleMaxDialScale(value: number) {
    browser.storage.local.set({ [`${apiVersion}-max-dial-scale`]: value });
    settings.maxDialScale = value;
    bc.postMessage({ maxDialScale: value });
  },
  handleNewTab(value: boolean) {
    browser.storage.local.set({ [`${apiVersion}-new-tab`]: value });
    settings.newTab = value;
    bc.postMessage({ newTab: value });
  },
  handleSelectThumbnail(id: string) {
    const i = document.createElement("input");
    i.type = "File";
    i.accept = "image/*";
    i.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const image = target.files?.[0];
      if (!image) return;

      if (!image.type.startsWith("image/")) {
        alert("Please select an image file.");
        return;
      }

      const base64 = await blobToBase64(image);
      settings.dialImages = { ...settings.dialImages, [id]: base64 };
      browser.storage.local.set({
        [`${apiVersion}-dial-images`]: { ...settings.dialImages },
      });
      bc.postMessage({ dialImages: { ...settings.dialImages } });
    };
    i.click();
  },
  handleShowTitle(value: boolean) {
    browser.storage.local.set({ [`${apiVersion}-show-title`]: value });
    settings.showTitle = value;
    bc.postMessage({ showTitle: value });
  },
  handleSwitchTitle(value: boolean) {
    browser.storage.local.set({ [`${apiVersion}-switch-title`]: value });
    settings.switchTitle = value;
    bc.postMessage({ switchTitle: value });
  },
  handleSquareDials(value: boolean) {
    browser.storage.local.set({ [`${apiVersion}-square-dials`]: value });
    settings.squareDials = value;
    bc.postMessage({ squareDials: value });
  },
  handleThemeOption(value: string) {
    browser.storage.local.set({ [`${apiVersion}-theme-option`]: value });
    settings.themeOption = value;
    settings.colorScheme = getColorScheme(value);
    settings.toggleThemeBackground(settings.colorScheme);
    bc.postMessage({ colorScheme: settings.colorScheme, themeOption: value });
  },
  handleTransparentDials(value: boolean) {
    browser.storage.local.set({ [`${apiVersion}-transparent-dials`]: value });
    settings.transparentDials = value;
    bc.postMessage({ transparentDials: value });
  },
  handleWallpaper(value: string) {
    // Automatically clear custom image when switching to a different wallpaper
    if (value !== "custom-image" && settings.wallpaper === "custom-image") {
      settings._clearCustomImage();
    }
    // Automatically clear custom color when switching to a different wallpaper
    if (value !== "custom-color" && settings.wallpaper === "custom-color") {
      settings._clearCustomColor();
    }
    browser.storage.local.set({ [`${apiVersion}-wallpaper`]: value });
    settings.wallpaper = value;
    bc.postMessage({ wallpaper: value });
  },
  _restoreWallpaper(value: string) {
    // Internal method for restoring wallpaper without clearing custom image/color
    browser.storage.local.set({ [`${apiVersion}-wallpaper`]: value });
    settings.wallpaper = value;
    bc.postMessage({ wallpaper: value });
  },
  _restoreCustomColor(value: string) {
    // Internal method for restoring custom color without triggering wallpaper change
    browser.storage.local.set({ [`${apiVersion}-custom-color`]: value });
    settings.customColor = value;
    bc.postMessage({ customColor: value });
  },
  hideAlertBanner() {
    settings.showAlertBanner = false;
  },
  _clearCustomImage() {
    browser.storage.local.remove([`${apiVersion}-custom-image`]);
    settings.customImage = "";
    bc.postMessage({ customImage: "" });
  },
  _clearCustomColor() {
    browser.storage.local.set({ [`${apiVersion}-custom-color`]: "" });
    settings.customColor = "";
    bc.postMessage({ customColor: "" });
  },
  resetDialColors() {
    browser.storage.local.set({ [`${apiVersion}-dial-colors`]: {} });
    settings.dialColors = {};
    bc.postMessage({ dialColors: {} });
  },
  resetDialImages() {
    browser.storage.local.remove(`${apiVersion}-dial-images`);
    settings.dialImages = {};
    bc.postMessage({ dialImages: {} });
  },
  resetSettings() {
    settings.handleAttachTitle(defaultSettings.attachTitle);
    settings._clearCustomColor();
    settings._clearCustomImage();
    settings.resetDialColors();
    settings.resetDialImages();
    settings.handleDefaultFolder(defaultSettings.defaultFolder);
    settings.handleDialSize(defaultSettings.dialSize);
    settings.handleGridLayout(defaultSettings.gridLayout);
    settings.handleGridCanvas(defaultSettings.gridCols, defaultSettings.gridRows);
    settings.handleBasePage(
      defaultSettings.basePageWidth,
      defaultSettings.basePageHeight,
    );
    settings.handleDeskAnchor(defaultSettings.deskAnchor);
    // Cleared rather than rebuilt: the migration recreates a single profile
    // from whatever is on the desk the next time it is read.
    try {
      localStorage.removeItem(PROFILES_KEY);
    } catch {}
    settings.handleMaxColumns(defaultSettings.maxColumns);
    settings.handleLimitDialScale(defaultSettings.limitDialScale);
    settings.handleMaxDialScale(defaultSettings.maxDialScale);
    settings.handleNewTab(defaultSettings.newTab);
    settings.handleShowTitle(defaultSettings.showTitle);
    settings.handleSquareDials(defaultSettings.squareDials);
    settings.handleSwitchTitle(defaultSettings.switchTitle);
    settings.handleThemeOption(defaultSettings.themeOption);
    settings.handleTransparentDials(defaultSettings.transparentDials);
    settings.resetWallpaper();
  },
  resetWallpaper() {
    settings.handleWallpaper("dark-wallpaper");
  },
  restoreFromJSON() {
    const i = document.createElement("input");
    i.type = "File";
    i.accept = ".json";
    i.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const reader = new FileReader();
      reader.readAsText(target.files![0]);
      reader.onload = async (e: ProgressEvent<FileReader>) => {
        try {
          const result = e.target?.result;
          if (typeof result !== "string") return;
          const backup = JSON.parse(result);
          
          console.log('Restoring backup version:', backup.backupVersion || '1.0');
          console.log('Backup layout stats:', backup.layoutStats);
          
          if (!browser.bookmarks) {
            alert('Bookmark permissions required for browser integration. Proceeding with local restore only.');
          }
          
          // Reset settings first
          settings.resetSettings();
          
          // Restore basic settings
          if (Object.prototype.hasOwnProperty.call(backup, "attachTitle")) {
            settings.handleAttachTitle(backup.attachTitle);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "defaultFolder")) {
            settings.handleDefaultFolder(backup.defaultFolder);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "dialColors")) {
            browser.storage.local.set({
              [`${apiVersion}-dial-colors`]: backup.dialColors,
            });
            settings.dialColors = backup.dialColors;
            bc.postMessage({ dialColors: backup.dialColors });
          }
          if (Object.prototype.hasOwnProperty.call(backup, "dialImages")) {
            browser.storage.local.set({
              [`${apiVersion}-dial-images`]: backup.dialImages,
            });
            settings.dialImages = backup.dialImages;
            bc.postMessage({ dialImages: backup.dialImages });
          }
          if (Object.prototype.hasOwnProperty.call(backup, "dialSize")) {
            settings.handleDialSize(backup.dialSize);
          }
          
          if (Object.prototype.hasOwnProperty.call(backup, "gridLayout")) {
            settings.handleGridLayout(backup.gridLayout);
            console.log('Restored grid layout:', backup.gridLayout);
          }
          
          if (
            Object.prototype.hasOwnProperty.call(backup, "gridCols") &&
            Object.prototype.hasOwnProperty.call(backup, "gridRows")
          ) {
            settings.handleGridCanvas(backup.gridCols, backup.gridRows);
            console.log(
              "Restored fixed grid canvas:",
              backup.gridCols,
              "x",
              backup.gridRows,
            );
          }
          if (
            Object.prototype.hasOwnProperty.call(backup, "basePageWidth") &&
            Object.prototype.hasOwnProperty.call(backup, "basePageHeight")
          ) {
            settings.handleBasePage(backup.basePageWidth, backup.basePageHeight);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "deskAnchor")) {
            settings.handleDeskAnchor(backup.deskAnchor);
          }

          // Restored before the arrangement below, so that whichever profile
          // the backup had active is the one the incoming positions land in.
          if (!isLegacyBackup(backup)) {
            writeProfileStore(localStorage, backup.deskProfiles);
            console.log(
              "Restored", backup.deskProfiles.profiles.length, "desk profile(s)",
            );
          } else if (Array.isArray(backup.panelBookmarks)) {
            /*
             * Upgrade bridge: a backup written before profiles existed.
             *
             * The profile is built from the FILE — its arrangement and its dial
             * size — not from whatever the browser happens to hold right now.
             * That distinction is the whole point of doing this explicitly:
             * without it the conversion depends on resetSettings having already
             * cleared the profile key, which is true today and is exactly the
             * kind of incidental ordering that breaks silently later.
             */
            const cap = maxCellSize(
              (backup.dialSize as string) ?? (settings.dialSize as string),
              (backup.squareDials as boolean) ?? (settings.squareDials as boolean),
              (backup.limitDialScale as boolean) ?? (settings.limitDialScale as boolean),
              (backup.maxDialScale as number) ?? (settings.maxDialScale as number),
            );
            const converted = storeFromArrangement({
              arrangement: backup.panelBookmarks,
              // An unlimited "scale to fit" cap is not a size anyone can be
              // given; fall back to the reference cell the page maths uses.
              cellSize: Number.isFinite(cap)
                ? cap
                : referenceCellSize(cap, (backup.squareDials as boolean) ?? false),
              screenHint: backup.gridDimensions ? undefined : undefined,
            });
            writeProfileStore(localStorage, converted);
            console.log(
              "Upgraded a pre-profiles backup:",
              Object.keys(converted.profiles[0].positions).length,
              "icons into one profile at",
              converted.profiles[0].cellSize + "px",
            );
          }
          if (Object.prototype.hasOwnProperty.call(backup, "maxColumns")) {
            settings.handleMaxColumns(backup.maxColumns);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "limitDialScale")) {
            settings.handleLimitDialScale(backup.limitDialScale);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "maxDialScale")) {
            settings.handleMaxDialScale(backup.maxDialScale);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "newTab")) {
            settings.handleNewTab(backup.newTab);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "showTitle")) {
            settings.handleShowTitle(backup.showTitle);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "squareDials")) {
            settings.handleSquareDials(backup.squareDials);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "switchTitle")) {
            settings.handleSwitchTitle(backup.switchTitle);
          }
          if (Object.prototype.hasOwnProperty.call(backup, "transparentDials")) {
            settings.handleTransparentDials(backup.transparentDials);
          }
          
          // Custom image restore
          if (backup.customImage && backup.customImage !== "") {
            await browser.storage.local.set({
              [`${apiVersion}-custom-image`]: backup.customImage,
            });
            const blobImage = base64ToBlob(backup.customImage);
            const imageURI = URL.createObjectURL(blobImage);
            settings.customImage = imageURI;
            bc.postMessage({ customImage: imageURI });
          }
          
          if (Object.prototype.hasOwnProperty.call(backup, "customColor")) {
            settings._restoreCustomColor(backup.customColor);
          }
          
          if (Object.prototype.hasOwnProperty.call(backup, "themeOption")) {
            settings.handleThemeOption(backup.themeOption);
          }
          
          if (Object.prototype.hasOwnProperty.call(backup, "wallpaper")) {
            settings._restoreWallpaper(backup.wallpaper);
          }
          
          // Save original grid dimensions for migration (index → row/col needs original column count)
          if (backup.gridDimensions && typeof backup.gridDimensions.cols === 'number' && backup.gridDimensions.cols > 0) {
            localStorage.setItem('migration-grid-cols', String(backup.gridDimensions.cols));
            console.log('Saved migration grid cols from backup:', backup.gridDimensions.cols);
          }

          if (Object.prototype.hasOwnProperty.call(backup, "panelBookmarks") && Array.isArray(backup.panelBookmarks)) {
            console.log('Restoring panel bookmarks directly to Bookmarks Bar:', backup.panelBookmarks.length, 'items');

            // Snapshot what the user has now, before any of the three restore
            // paths below overwrite it. It sits here rather than inside the
            // bookmarks-API branch because the local-only and error paths
            // overwrite the arrangement just as thoroughly, and only one of the
            // three was covered.
            try {
              const current = JSON.parse(localStorage.getItem('panel-bookmarks') || '[]');
              if (Array.isArray(current) && current.length > 0) {
                recordSnapshot(localStorage, current, { reason: 'before-restore', force: true });
              }
            } catch {}

            try {
              if (browser.bookmarks) {
                const bookmarksBarId = await getBookmarksBarId();
                
                const createdBookmarks = [];
                let successCount = 0;
                
                for (const bookmark of backup.panelBookmarks) {
                  try {
                    // `type` was not always written. Falling back to the shape
                    // of the entry keeps older files restorable: anything with
                    // a url is a bookmark, and anything else still reaches the
                    // layout pass below rather than vanishing.
                    const kind = bookmark.type
                      ?? (bookmark.url ? 'bookmark' : bookmark.children ? 'folder' : 'unknown');

                    if (kind === 'bookmark' && bookmark.url) {
                      const existingBookmarks = await browser.bookmarks.search({ url: bookmark.url });
                      const isDuplicate = existingBookmarks.some(bm => 
                        bm.title === (bookmark.title || bookmark.name) && 
                        bm.parentId === bookmarksBarId
                      );
                      
                      if (!isDuplicate) {
                        const created = await browser.bookmarks.create({
                          parentId: bookmarksBarId,
                          title: bookmark.title || bookmark.name || 'Untitled',
                          url: bookmark.url
                        });
                        
                        createdBookmarks.push({
                          ...bookmark,
                          id: created.id
                        });
                        successCount++;
                      } else {
                        console.log('Skipped duplicate bookmark:', bookmark.title);
                        const existingBookmark = existingBookmarks.find(bm => 
                          bm.title === (bookmark.title || bookmark.name) &&
                          bm.parentId === bookmarksBarId
                        );
                        if (existingBookmark) {
                          createdBookmarks.push({
                            ...bookmark,
                            id: existingBookmark.id
                          });
                        }
                      }
                    } else if (kind === 'folder') {
                      const created = await browser.bookmarks.create({
                        parentId: bookmarksBarId,
                        title: bookmark.title || bookmark.name || 'Untitled Folder'
                      });

                      createdBookmarks.push({
                        ...bookmark,
                        id: created.id
                      });
                      successCount++;
                    } else {
                      // No browser bookmark to recreate, but the entry still
                      // holds a position. Dropping it here is how backups used
                      // to come back with holes in them.
                      createdBookmarks.push(bookmark);
                    }
                  } catch (error) {
                    console.warn('Failed to create bookmark:', bookmark.title || bookmark.name, error);
                    createdBookmarks.push(bookmark);
                  }
                }
                
                console.log(`Successfully created ${successCount} bookmarks directly in Bookmarks Bar`);
                
                localStorage.removeItem('panel-bookmarks');


                const attemptRestore = (attempt: number) => {
                  setTimeout(() => {
                    const success = setPanelBookmarksData(createdBookmarks);
                    if (success) {
                      console.log('Panel bookmarks layout restored successfully on attempt', attempt);
                      
                      setTimeout(() => {
                        try {
                          const restored = localStorage.getItem('panel-bookmarks');
                          if (restored) {
                            const parsedRestored = JSON.parse(restored);
                            console.log('Verification: restored', parsedRestored.length, 'bookmarks');
                            
                            const message = successCount > 0 
                              ? `Settings and ${successCount} bookmarks restored directly to Bookmarks Bar! Page will reload to apply all changes.`
                              : 'Settings restored successfully! Page will reload to apply changes.';
                            
                            alert(message);
                            window.location.reload();
                          }
                        } catch (e) {
                          console.warn('Could not verify restoration:', e);
                          alert("Settings restored but verification failed. Please refresh the page.");
                          window.location.reload();
                        }
                      }, 500);
                      
                    } else if (attempt < 3) {
                      console.warn('Failed to restore panel bookmarks layout, retrying...');
                      attemptRestore(attempt + 1);
                    } else {
                      console.error('Failed to restore panel bookmarks layout after 3 attempts');
                      const message = successCount > 0
                        ? `${successCount} bookmarks created directly in Bookmarks Bar, but panel layout may not be fully restored. Please refresh the page.`
                        : 'Settings restored but panel layout may not be fully restored. Please refresh the page.';
                      alert(message);
                      window.location.reload();
                    }
                  }, attempt * 1000);
                };
                
                attemptRestore(1);
              } else {
                console.warn('Browser bookmarks API not available, proceeding with local restore only');
                
                const attemptRestore = (attempt: number) => {
                  setTimeout(() => {
                    const success = setPanelBookmarksData(backup.panelBookmarks);
                    if (success) {
                      alert("Settings and bookmark layout restored successfully (local only). Page will reload to apply changes.");
                      window.location.reload();
                    } else if (attempt < 3) {
                      attemptRestore(attempt + 1);
                    } else {
                      alert("Settings restored but bookmark layout restoration failed. Please refresh the page.");
                      window.location.reload();
                    }
                  }, attempt * 1000);
                };
                
                attemptRestore(1);
              }
              
            } catch (error) {
              console.error('Error during bookmark restoration:', error);
              
              setTimeout(() => {
                try {
                  const success = setPanelBookmarksData(backup.panelBookmarks);
                  const message = success
                    ? "Settings restored with fallback bookmark data. Some bookmarks may not be available in browser bookmarks."
                    : "Settings restored but bookmark restoration failed. Error: " + error.message;
                  alert(message);
                } catch (fallbackError) {
                  alert("Settings restored but bookmark restoration failed completely. Please manually import your bookmarks.");
                }
                window.location.reload();
              }, 1000);
            }
            
          } else {
            setTimeout(() => {
              alert("Settings restored successfully. Page will reload to apply changes.");
              window.location.reload();
            }, 1000);
          }
          
        } catch (err) {
          console.error("Error parsing JSON file", err);
          alert("Could not read backup file. Please select a valid backup file.");
        }
      };
    };
    i.click();
  },

  async saveToJSON() {
    const { [`${apiVersion}-custom-image`]: customImageBase64 } =
      await browser.storage.local.get(`${apiVersion}-custom-image`);
    
    // Get panel bookmarks data with additional metadata
    const panelBookmarks = getPanelBookmarksData();
    
    // The canvas is defined by settings, not by the shape the window happens to
    // have while the backup is being written. This used to measure the live
    // grid, which made the file depend on the monitor it was taken on: restore
    // the same backup on a laptop and the recorded dimensions were different.
    // Positions themselves are (row, col) and carry no such dependency; this
    // field only survives as a migration hint for pre-(row, col) backups, so it
    // is written when the user has pinned a fixed canvas and omitted otherwise.
    const gridDimensions =
      settings.gridCols > 0 && settings.gridRows > 0
        ? { cols: settings.gridCols, rows: settings.gridRows }
        : null;


    const backup = {
      // Basic settings
      attachTitle: settings.attachTitle,
      customColor: settings.customColor,
      customImage: customImageBase64 || "",
      defaultFolder: settings.defaultFolder,
      dialColors: settings.dialColors,
      dialImages: settings.dialImages,
      dialSize: settings.dialSize,
      gridCols: settings.gridCols,
      gridRows: settings.gridRows,
      basePageWidth: settings.basePageWidth,
      basePageHeight: settings.basePageHeight,
      deskAnchor: settings.deskAnchor,

      // Desk profiles: every profile's arrangement and icon size, and which one
      // is active. Without this a backup restores the settings but drops every
      // desk but one, which is exactly the loss backups exist to prevent.
      deskProfiles: readProfileStore(localStorage),
      gridLayout: settings.gridLayout,
      limitDialScale: settings.limitDialScale,
      maxColumns: settings.maxColumns,
      maxDialScale: settings.maxDialScale,
      newTab: settings.newTab,
      showTitle: settings.showTitle,
      squareDials: settings.squareDials,
      switchTitle: settings.switchTitle,
      themeOption: settings.themeOption,
      transparentDials: settings.transparentDials,
      wallpaper: settings.wallpaper,
      
      // Panel layout data
      panelBookmarks: panelBookmarks,
      gridDimensions: gridDimensions,
      
      // Metadata
      backupVersion: "2.2", // Version artÄ±rÄ±ldÄ± - direct bookmarks bar support
      timestamp: new Date().toISOString(),
      gridLayoutAtBackup: settings.gridLayout,
      totalBookmarks: panelBookmarks.length,
      
      // Layout statistics for verification
      layoutStats: {
        'top-left': panelBookmarks.filter(b => b.panel === 'top-left').length,
        'top-right': panelBookmarks.filter(b => b.panel === 'top-right').length,
        'bottom-left': panelBookmarks.filter(b => b.panel === 'bottom-left').length,
        'bottom-right': panelBookmarks.filter(b => b.panel === 'bottom-right').length,
        'bottom-full': panelBookmarks.filter(b => b.panel === 'bottom-full').length,
        'full-screen-panel': panelBookmarks.filter(b => b.panel === 'full-screen-panel').length,
      }
    };
    
    console.log('Creating backup with direct Bookmarks Bar support');
    console.log('Total bookmarks in backup:', backup.totalBookmarks);
    downloadBackup(backup);
  },
  toggleThemeBackground(scheme: string) {
    const wallpaperMap = {
      "color-scheme-light": {
        "dark-wallpaper": "light-wallpaper",
        "light-wallpaper": "light-wallpaper",
        HorizonDark: "HorizonLight",
        HorizonLight: "HorizonLight",
        DesertDay: "DesertDay",
        DesertNight: "DesertDay",
      },
      "color-scheme-dark": {
        "dark-wallpaper": "dark-wallpaper",
        "light-wallpaper": "dark-wallpaper",
        HorizonDark: "HorizonDark",
        HorizonLight: "HorizonDark",
        DesertDay: "DesertNight",
        DesertNight: "DesertNight",
      },
    };
    const schemeMap = wallpaperMap[scheme as keyof typeof wallpaperMap];
    const wallpaper = schemeMap?.[settings.wallpaper as keyof typeof schemeMap];
    if (wallpaper) {
      settings.handleWallpaper(wallpaper);
    }
  },
  systemThemeChanged(e: MediaQueryListEvent) {
    if (settings.themeOption === "System Theme") {
      settings.colorScheme = e.matches
        ? "color-scheme-dark"
        : "color-scheme-light";
      settings.toggleThemeBackground(settings.colorScheme);
    }
  },
});

// ==================================================================
// TOGGLE THEME/BACKGROUND
// ==================================================================
// Listen for system theme changes and update settings accordingly.
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", settings.systemThemeChanged);

// ==================================================================
// DIALS FROM DEMO BOOKMARKS
// ==================================================================
// If running in demo mode, populate dial colors and images from mock bookmarks.
if (__DEMO__) {
  mockBookmarks.forEach((b) => {
    settings.dialColors[b[2]] = b[3];
    settings.dialImages[b[2]] = b[4];
  });
}

// ==================================================================
// CLASSNAMES FROM SETTINGS
// ==================================================================
// Dynamically update document class names and background based on settings.
const userAgent = navigator.userAgent.toLowerCase();
const isMacOS = userAgent.includes("macintosh");
const isChrome = userAgent.includes("chrome");

autorun(() => {
  document.documentElement.className = clsx(
    settings.colorScheme as string,
    settings.wallpaper as string,
    "Wallpapers",
    isChrome ? "chrome" : "firefox",
    isMacOS ? "mac" : "windows",
    settings.showTitle ? "show-title" : "hide-title",
    settings.attachTitle ? "attach-title" : "normal-title",
    settings.dialSize,
    settings.maxColumns === "Unlimited" ? "unlimited-columns" : undefined,
    settings.squareDials ? "square" : undefined,
    settings.transparentDials ? "transparent-dials" : undefined,
    settings.gridLayout,
  );
  document.documentElement.style.backgroundImage =
    settings.wallpaper === "custom-image" && settings.customImage
      ? `url(${settings.customImage})`
      : "";
  document.documentElement.style.setProperty(
    "--background-color",
    settings.wallpaper === "custom-color"
      ? (settings.customColor as string | null)
      : null,
  );
  document.documentElement.style.setProperty(
    "--dial-scale-max",
    settings.limitDialScale ? `${settings.maxDialScale}em` : "100em",
  );
  document.documentElement.style.setProperty("--dial-scale-min", "0.4em");
});

// ==================================================================
// BACKUP/RESTORE HELPERS
// ==================================================================
// Utility to convert a base64 string to a Blob object.
function base64ToBlob(base64: string) {
  const contentType = base64.match(/data:([^;]+);base64,/)?.[1];
  if (!contentType) throw new Error("Invalid base64 format");
  const base64Data = base64.replace(/data:([^;]+);base64,/, "");
  const binaryData = atob(base64Data);
  const length = binaryData.length;
  const uint8Array = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    uint8Array[i] = binaryData.charCodeAt(i);
  }

  return new Blob([uint8Array], { type: contentType });
}

// Utility to convert a Blob object to a base64 string.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file as string"));
      }
    };
    reader.onerror = (error) => reject(error);
  });
}

// Utility to trigger a download of a JSON backup file.
function downloadBackup(obj: Record<string, unknown>) {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  const dataStr = `data:text/plain;charset=utf-8,${encodeURIComponent(
    JSON.stringify(obj, null, 2), // Pretty print with 2 space indentation
  )}`;
  const a = document.createElement("a");
  a.href = dataStr;
  a.download = `easy-backup-${timestamp}.json`;
  a.click();
}