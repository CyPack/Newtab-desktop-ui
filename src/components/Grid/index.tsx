import { clsx } from "clsx/lite";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

import "./styles.css";
import { contrastRatio } from "random-color-library";
import { getImageAverageColor } from "#lib/imageLuminance";
import { settings } from "#stores/useSettings";
import { bookmarks } from "#stores/useBookmarks";
import { modals } from "#stores/useModals";
import { Dial } from "./Dial";
import { SettingsGear } from "./SettingsGear";
import { BookmarkModal } from "../BookmarkModal";

type PanelName = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "bottom-full" | "full-screen-panel";

const PANEL_BOOKMARKS_KEY = "panel-bookmarks";
const dropZonePercent = 0.6;
const ORGANIZED_LAYOUT_KEY = "organized-layout";
const HAS_ORGANIZED_KEY = "has-organized";

function savePanelBookmarks(panelBookmarks: any[]): boolean {
  try {
    const dataToSave = JSON.stringify(panelBookmarks);
    localStorage.setItem(PANEL_BOOKMARKS_KEY, dataToSave);
    
    console.log('Panel bookmarks saved:', panelBookmarks.length, 'items');
    
    // Verify save worked
    const saved = localStorage.getItem(PANEL_BOOKMARKS_KEY);
    if (!saved || saved !== dataToSave) {
      console.error('Save verification failed!');
      return false;
    }
    return true;
  } catch (e) {
    console.error('Failed to save panel bookmarks:', e);
    
    // Alternative storage attempt
    try {
      sessionStorage.setItem(PANEL_BOOKMARKS_KEY + '_backup', JSON.stringify(panelBookmarks));
      console.warn('Saved to sessionStorage as backup');
    } catch (sessionError) {
      console.error('Backup save also failed:', sessionError);
    }
    return false;
  }
}

function loadPanelBookmarks(): any[] {
  try {
    // Primary storage attempt
    const raw = localStorage.getItem(PANEL_BOOKMARKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      console.log('Loaded panel bookmarks:', parsed.length, 'items');
      return Array.isArray(parsed) ? parsed : [];
    }
    
    // Backup storage attempt
    const backup = sessionStorage.getItem(PANEL_BOOKMARKS_KEY + '_backup');
    if (backup) {
      console.warn('Using backup data from sessionStorage');
      const parsed = JSON.parse(backup);
      return Array.isArray(parsed) ? parsed : [];
    }
    
    return [];
  } catch (e) {
    console.error('Failed to load panel bookmarks:', e);
    
    // Try to recover corrupted data
    try {
      localStorage.removeItem(PANEL_BOOKMARKS_KEY);
      console.warn('Removed corrupted data from localStorage');
    } catch {}
    
    return [];
  }
}

// Coordinate helpers for (row, col) grid positioning
function coordToKey(row: number, col: number): string {
  return `${row},${col}`;
}

function migrateIndexToRowCol(bookmarksList: any[], cols: number): any[] {
  const safeCols = cols > 0 ? cols : 10;
  let nextFallbackIndex = 0;
  // Find the highest existing index to start fallback from
  bookmarksList.forEach(bm => {
    if (bm.panel === "full-screen-panel" && typeof bm.index === "number") {
      nextFallbackIndex = Math.max(nextFallbackIndex, bm.index + 1);
    }
  });

  return bookmarksList.map(bm => {
    if (bm.panel === "full-screen-panel" && bm.row === undefined && bm.col === undefined) {
      const idx = typeof bm.index === "number" ? bm.index : nextFallbackIndex++;
      return {
        ...bm,
        row: Math.max(0, Math.floor(idx / safeCols)),
        col: Math.max(0, idx % safeCols),
      };
    }
    return bm;
  });
}

let saveTimeout: NodeJS.Timeout | null = null;

function debouncedSavePanelBookmarks(panelBookmarks: any[]) {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  saveTimeout = setTimeout(() => {
    const success = savePanelBookmarks(panelBookmarks);
    if (!success) {
      console.error('Critical: Panel bookmarks could not be saved!');
    } else {
      try {
        localStorage.setItem(ORGANIZED_LAYOUT_KEY, settings.gridLayout);
        localStorage.setItem(HAS_ORGANIZED_KEY, "true");
      } catch (e) {
        console.error('Failed to save organization state:', e);
      }
    }
  }, 300);
}

function normalizeUrl(url: string): string {
  try {
    if (!url) return url as any;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
      return `https://${url}`;
    }
    return url;
  } catch {
    return url as any;
  }
}

function isInDragZone(x: number, width: number) {
  const zoneWidth = width * dropZonePercent;
  const start = (width - zoneWidth) / 2;
  const end = start + zoneWidth;
  return x >= start && x <= end;
}

interface ExtendedDragEvent extends React.DragEvent {
  originalEvent?: DragEvent;
}

export const Grid = observer(function Grid() {
  // Refs
  const topLeftGridRef = useRef<HTMLDivElement>(null);
  const topRightGridRef = useRef<HTMLDivElement>(null);
  const bottomLeftGridRef = useRef<HTMLDivElement>(null);
  const bottomRightGridRef = useRef<HTMLDivElement>(null);
  const bottomFullGridRef = useRef<HTMLDivElement>(null);
  const breadcrumbsRef = useRef<HTMLDivElement>(null);

  // State
  const [isMaxFontSize, setIsMaxFontSize] = useState(false);
  const [gearColor, setGearColor] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [panelBookmarks, setPanelBookmarks] = useState<any[]>([]);
  const [hasOrganizedForLayout, setHasOrganizedForLayout] = useState(() => {
  try {
    return localStorage.getItem(HAS_ORGANIZED_KEY) === "true";
  } catch {
    return false;
  }
});
  const [lastOrganizedLayout, setLastOrganizedLayout] = useState(() => {
  try {
    return localStorage.getItem(ORGANIZED_LAYOUT_KEY) || "";
  } catch {
    return "";
  }
});
  const [currentPanelCount, setCurrentPanelCount] = useState(() => {
    return settings.gridLayout === "2-panel" ? 2 
         : settings.gridLayout === "3-panel" ? 3 
         : 4;
  });
  const [gridDimensions, setGridDimensions] = useState({ cols: 10, rows: 6 });
  const [targetSlotIndex, setTargetSlotIndex] = useState<{ row: number; col: number } | null>(null);

  // Refs for drag state
  const targetPanelRef = useRef<string | null>(null);
  const draggedRef = useRef<{ id: string; panel: string; index: number; row?: number; col?: number } | null>(null);
  const dragImageRef = useRef<HTMLElement | null>(null);

  const isRootSafe = useMemo(() => {
    const hasValidFolder = bookmarks.currentFolder?.id;
    const hasDefaultFolder = settings.defaultFolder !== undefined;
    const isDefaultFolder = hasDefaultFolder && bookmarks.currentFolder.id === settings.defaultFolder;
    const hasNoParent = !bookmarks.parentId;
    
    const result = isDefaultFolder || hasNoParent;
    
    console.log('isRoot calculation:', {
      hasValidFolder,
      hasDefaultFolder, 
      isDefaultFolder,
      hasNoParent,
      result
    });
    
    return result;
  }, [bookmarks.currentFolder?.id, settings.defaultFolder, bookmarks.parentId]);

  const updatePanelBookmarksWithSave = useCallback((updater: (current: any[]) => any[]) => {
    setPanelBookmarks((current) => {
      const next = updater(current);
      
      // Save only if we're in root and data actually changed
      if (isRootSafe && JSON.stringify(current) !== JSON.stringify(next)) {
        debouncedSavePanelBookmarks(next);
      }
      
      return next;
    });
  }, [isRootSafe]);

  // Utility functions
  const clearAllDragStyles = useCallback(() => {
    document.querySelectorAll('.drag-over, .drag-over-panel, .drag-over-slot, .folder-drop-target, .breadcrumb-drop-target').forEach(el => {
      el.classList.remove('drag-over', 'drag-over-panel', 'drag-over-slot', 'folder-drop-target', 'breadcrumb-drop-target');
    });
  }, []);

  const getNextIndexForPanel = useCallback((panelName: string) => {
    const panelItems = panelBookmarks
      .filter((bm) => bm.panel === panelName)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    
    return panelItems.length === 0 ? 0 : Math.max(...panelItems.map(bm => bm.index ?? 0)) + 1;
  }, [panelBookmarks]);

  const findEmptySlot = useCallback((bms: any[], cols: number, rows: number): { row: number; col: number } => {
    const occupied = new Set<string>(
      bms
        .filter(b => b.panel === "full-screen-panel" && b.row !== undefined && b.col !== undefined)
        .map(b => coordToKey(b.row, b.col))
    );
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!occupied.has(coordToKey(r, c))) return { row: r, col: c };
      }
    }
    return { row: rows, col: 0 };
  }, []);

  const getNextAvailableCoords = useCallback((existingBookmarks: any[], cols: number, rows: number, count: number): { row: number; col: number }[] => {
    const occupied = new Set<string>(
      existingBookmarks
        .filter(b => b.panel === "full-screen-panel" && b.row !== undefined && b.col !== undefined)
        .map(b => coordToKey(b.row, b.col))
    );
    const available: { row: number; col: number }[] = [];
    for (let r = 0; r < rows && available.length < count; r++) {
      for (let c = 0; c < cols && available.length < count; c++) {
        if (!occupied.has(coordToKey(r, c))) available.push({ row: r, col: c });
      }
    }
    let extraRow = rows;
    while (available.length < count) {
      for (let c = 0; c < cols && available.length < count; c++) {
        available.push({ row: extraRow, col: c });
      }
      extraRow++;
    }
    return available;
  }, []);

  // Calculate grid dimensions using CSS-consistent em-based values
  const calculateGridDimensions = useCallback(() => {
    if (settings.gridLayout !== "full-screen") return;

    const dialWidthValue = settings.squareDials ? 10.25 : 12.125;
    const gridGapValue = 1.75;
    const padding = 20; // matches renderFullScreenPanel inline padding

    const gridEl = bottomFullGridRef.current;
    if (gridEl) {
      // DOM-based calculation (preferred - reads actual rendered sizes)
      const computedStyle = getComputedStyle(gridEl);
      const fontSize = parseFloat(computedStyle.fontSize) || 16;
      const dialWidth = dialWidthValue * fontSize;
      const gridGap = parseFloat(computedStyle.columnGap || computedStyle.gap) || (gridGapValue * fontSize);
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || padding;
      const paddingRight = parseFloat(computedStyle.paddingRight) || padding;
      const paddingTop = parseFloat(computedStyle.paddingTop) || padding;
      const paddingBottom = parseFloat(computedStyle.paddingBottom) || padding;

      const containerWidth = gridEl.clientWidth - paddingLeft - paddingRight;
      const containerHeight = gridEl.clientHeight - paddingTop - paddingBottom;

      const cols = Math.max(Math.floor((containerWidth + gridGap) / (dialWidth + gridGap)), 3);
      const rows = Math.max(Math.floor((containerHeight + gridGap) / (dialWidth + gridGap)), 3);

      setGridDimensions(prev =>
        prev.cols === cols && prev.rows === rows ? prev : { cols, rows }
      );
      return;
    }

    // Fallback: CSS-consistent em-based calculation (before first render)
    const baseFontSize = 16;
    const sizeMultipliers: Record<string, number> = {
      "extra-tiny": 0.3, "tiny": 0.4, "small": 0.5,
      "medium": 0.6, "large": 0.7, "huge": 0.8, "scale": 0.5,
    };
    const multiplier = sizeMultipliers[settings.dialSize as string] || 0.4;
    const effectiveFontSize = baseFontSize * multiplier;
    const dialWidth = dialWidthValue * effectiveFontSize;
    const gridGap = gridGapValue * effectiveFontSize;

    const availableWidth = window.innerWidth - (padding * 2);
    const availableHeight = window.innerHeight - (padding * 2);

    const cols = Math.max(Math.floor((availableWidth + gridGap) / (dialWidth + gridGap)), 3);
    const rows = Math.max(Math.floor((availableHeight + gridGap) / (dialWidth + gridGap)), 3);

    setGridDimensions(prev =>
      prev.cols === cols && prev.rows === rows ? prev : { cols, rows }
    );
  }, [settings.dialSize, settings.gridLayout, settings.squareDials]);

  // Organize bookmarks for layout
  const organizeBookmarksForLayout = useCallback(
    (bookmarkList: any[], targetLayout: string) => {
      if (lastOrganizedLayout === targetLayout && hasOrganizedForLayout) {
        return bookmarkList;
      }

      let migrated: any[] = [];
      
      if (targetLayout === "full-screen") {
        const { cols, rows } = gridDimensions;

        migrated = bookmarkList.map((bm, globalIndex) => {
          if (bm.panel === "full-screen-panel" && bm.row !== undefined && bm.col !== undefined) {
            return { ...bm, panel: "full-screen-panel" };
          }
          const idx = (bm.panel === "full-screen-panel" && bm.index !== undefined) ? bm.index : globalIndex;
          return {
            ...bm,
            panel: "full-screen-panel",
            row: Math.floor(idx / cols),
            col: idx % cols,
          };
        });

        // Deduplicate: resolve coordinate conflicts
        const coordMap = new Map<string, string>(); // "row,col" -> bookmark id
        migrated.forEach(bm => {
          if (bm.panel !== "full-screen-panel") return;
          const key = coordToKey(bm.row, bm.col);
          if (coordMap.has(key)) {
            // Build occupied set from coordMap (all previously assigned positions)
            const occupiedBookmarks = migrated
              .filter(m => m.panel === "full-screen-panel" && coordMap.has(coordToKey(m.row, m.col)));
            const empty = findEmptySlot(occupiedBookmarks, cols, rows);
            bm.row = empty.row;
            bm.col = empty.col;
          }
          coordMap.set(coordToKey(bm.row, bm.col), bm.id);
        });
      } else {
        const panelOrder: PanelName[] = 
          targetLayout === "2-panel" ? ["top-left", "top-right"] :
          targetLayout === "3-panel" ? ["top-left", "top-right", "bottom-full"] :
          ["top-left", "top-right", "bottom-left", "bottom-right"];

        migrated = bookmarkList.map((bm, globalIndex) => {
          let targetPanel = bm.panel;
          
          if (targetLayout === "4-panel") {
            if (bm.panel === "full-screen-panel") {
              targetPanel = panelOrder[globalIndex % panelOrder.length];
            }
          } else if (targetLayout === "3-panel") {
            if (bm.panel === "full-screen-panel") {
              targetPanel = panelOrder[globalIndex % panelOrder.length];
            }
            if (bm.panel === "bottom-left" || bm.panel === "bottom-right") {
              targetPanel = "bottom-full";
            }
          } else if (targetLayout === "2-panel") {
            if (bm.panel === "full-screen-panel") {
              targetPanel = panelOrder[globalIndex % panelOrder.length];
            }
            if (bm.panel === "bottom-left" || bm.panel === "bottom-right" || bm.panel === "bottom-full") {
              targetPanel = "top-left";
            }
            if (bm.panel !== "top-right") targetPanel = "top-left";
          }
          
          return { 
            ...bm, 
            panel: targetPanel,
            index: targetPanel !== bm.panel ? undefined : bm.index
          };
        });

        const panelCounts: { [key: string]: number } = {};
        migrated.forEach(bm => {
          if (bm.index !== undefined) {
            panelCounts[bm.panel] = Math.max(panelCounts[bm.panel] || 0, bm.index + 1);
          }
        });
        
        migrated = migrated.map(bm => {
          if (bm.index === undefined) {
            const newIndex = panelCounts[bm.panel] || 0;
            panelCounts[bm.panel] = newIndex + 1;
            return { ...bm, index: newIndex };
          }
          return bm;
        });
      }

      const knownIds = new Set(migrated.map((m) => m.id));
      const browserBookmarks = ((bookmarks as any).bookmarks || []).filter(
        (bm: any) => !knownIds.has(bm.id) && bm.parentId === bookmarks.currentFolder.id && bm.type === "bookmark"
      );

      let distributed: any[] = [];
      
      if (browserBookmarks.length > 0) {
        if (targetLayout === "full-screen") {
          const { cols, rows } = gridDimensions;
          const availableCoords = getNextAvailableCoords(migrated, cols, rows, browserBookmarks.length);

          distributed = browserBookmarks.slice(0, availableCoords.length).map((bm: any, i: number) => ({
            ...bm,
            panel: "full-screen-panel",
            isPanelBookmark: true,
            row: availableCoords[i].row,
            col: availableCoords[i].col,
            name: bm.title || bm.name,
            title: bm.title || bm.name,
          }));
        } else {
          const panelOrder: PanelName[] = 
            targetLayout === "2-panel" ? ["top-left", "top-right"] :
            targetLayout === "3-panel" ? ["top-left", "top-right", "bottom-full"] :
            ["top-left", "top-right", "bottom-left", "bottom-right"];

          const panelCounts: { [key: string]: number } = {};
          migrated.forEach(bm => {
            panelCounts[bm.panel] = Math.max(panelCounts[bm.panel] || 0, (bm.index ?? 0) + 1);
          });

          distributed = browserBookmarks.map((bm: any, i: number) => {
            const targetPanelName = panelOrder[i % panelOrder.length];
            const currentCount = panelCounts[targetPanelName] || 0;
            panelCounts[targetPanelName] = currentCount + 1;
            
            return {
              ...bm,
              panel: targetPanelName,
              isPanelBookmark: true,
              index: currentCount,
              name: bm.title || bm.name,
              title: bm.title || bm.name,
            };
          });
        }
      }

      return [...migrated, ...distributed];
    },
    [gridDimensions, bookmarks, lastOrganizedLayout, hasOrganizedForLayout, getNextAvailableCoords, findEmptySlot]
  );

  // Effects
  useEffect(() => {
    calculateGridDimensions();

    const gridEl = bottomFullGridRef.current;
    if (gridEl && typeof ResizeObserver !== 'undefined') {
      let rafId: number;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => calculateGridDimensions());
      });
      observer.observe(gridEl);
      return () => {
        cancelAnimationFrame(rafId);
        observer.disconnect();
      };
    }

    // Fallback for pre-render or no ResizeObserver
    window.addEventListener("resize", calculateGridDimensions);
    return () => window.removeEventListener("resize", calculateGridDimensions);
  }, [calculateGridDimensions]);

  useEffect(() => {
    if (panelBookmarks.length === 0) {
      const saved = loadPanelBookmarks();
      if (saved.length > 0) {
        setPanelBookmarks(saved);
      }
    }
  }, []);
  
  useEffect(() => {
    const handleRemoved = (id: string) => {
      updatePanelBookmarksWithSave((current) => current.filter((bm) => bm.id !== id));
    };
    const api: any = (typeof chrome !== "undefined" && chrome.bookmarks) ? chrome.bookmarks : (window as any)?.chrome?.bookmarks;
    if (api?.onRemoved?.addListener) {
      const listener = (id: any) => handleRemoved(String(id));
      api.onRemoved.addListener(listener);
      return () => {
        try { api.onRemoved.removeListener(listener); } catch {}
      };
    }
  }, [updatePanelBookmarksWithSave]);

  useEffect(() => {
    updatePanelBookmarksWithSave((current) => 
      current.map((bm) => bm.url ? { ...bm, url: normalizeUrl(bm.url) } : bm)
    );
  }, [updatePanelBookmarksWithSave]);

  // Storage event listener
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === PANEL_BOOKMARKS_KEY && e.newValue !== e.oldValue) {
        console.log('Panel bookmarks changed in another tab');
        if (e.newValue) {
          try {
            const newBookmarks = JSON.parse(e.newValue);
            setPanelBookmarks(newBookmarks);
          } catch (error) {
            console.error('Failed to parse bookmarks from storage event:', error);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Periodic backup
  useEffect(() => {
    const backupInterval = setInterval(() => {
      if (isRootSafe && panelBookmarks.length > 0) {
        try {
          const backup = {
            timestamp: Date.now(),
            data: panelBookmarks
          };
          localStorage.setItem(PANEL_BOOKMARKS_KEY + '_backup_' + new Date().toISOString().split('T')[0], 
                             JSON.stringify(backup));
          console.log('Daily backup created');
        } catch (e) {
          console.error('Backup creation failed:', e);
        }
      }
    }, 24 * 60 * 60 * 1000); // 24 saat

    return () => clearInterval(backupInterval);
  }, [isRootSafe, panelBookmarks]);

  // Global API for panel bookmark management
  useEffect(() => {
    (window as any).panelBookmarkManager = {
      deletePanelBookmark: async (id: string) => {
        try {
          await bookmarks.deleteBookmark(id);
        } catch (error) {}
        updatePanelBookmarksWithSave((current) => current.filter((bm) => bm.id !== id));
      },
      
      editPanelBookmark: (id: string) => {
        const b = panelBookmarks.find((x) => x.id === id);
        if (!b) return;
        
        setIsModalOpen(true);
        setActivePanel(b.panel);
        targetPanelRef.current = b.panel;
        
        if (b.panel === "full-screen-panel" && b.row !== undefined && b.col !== undefined) {
          setTargetSlotIndex({ row: b.row, col: b.col });
        }
        
        modals.editingBookmarkId = id;
      },
      
      updatePanelBookmark: async (id: string, data: { title: string; url: string; panel?: string }) => {
        try {
          const normalizedUrl = normalizeUrl(data.url);
          await bookmarks.updateBookmark(id, {
            title: data.title,
            url: normalizedUrl,
          });
          
          updatePanelBookmarksWithSave((current) => 
            current.map((bm) =>
              bm.id === id
                ? {
                    ...bm,
                    name: data.title,
                    title: data.title,
                    url: normalizedUrl,
                    panel: data.panel ?? bm.panel,
                  }
                : bm
            )
          );
        } catch (error) {
          throw error;
        }
      },
      
      addPanelBookmark: (bookmarkData: any) => {
        const normalized = bookmarkData && bookmarkData.url ? { ...bookmarkData, url: normalizeUrl(bookmarkData.url) } : bookmarkData;
        updatePanelBookmarksWithSave((current) => [...current, normalized]);
      },
      
      isPanelBookmark: (id: string) => panelBookmarks.some((bm) => bm.id === id),
      getPanelBookmark: (id: string) => panelBookmarks.find((bm) => bm.id === id),
      getPanelBookmarks: (panelName: string) => {
        return panelBookmarks
          .filter((bm) => bm.panel === panelName)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      },
      getNextIndexForPanel: getNextIndexForPanel,
      getCurrentTargetSlot: () => targetSlotIndex,
      setCurrentTargetSlot: (slot: { row: number; col: number }) => setTargetSlotIndex(slot),
      clearCurrentTargetSlot: () => setTargetSlotIndex(null),
      
      // Export panel bookmarks for backup
      exportPanelBookmarks: () => {
        return JSON.parse(JSON.stringify(panelBookmarks)); // Deep copy
      },
      
      // Import panel bookmarks from backup
      importPanelBookmarks: (bookmarksData: any[]) => {
        if (Array.isArray(bookmarksData)) {
          setPanelBookmarks(bookmarksData);
          if (isRootSafe) {
            savePanelBookmarks(bookmarksData);
          }
          console.log('Panel bookmarks imported:', bookmarksData.length, 'items');
        }
      },
      
      addBookmarkToPanel: async (data: { title: string; url: string; panel: string }) => {
        try {
          const normalizedUrl = normalizeUrl(data.url);
          const bookmarksBarId = await bookmarks.getBookmarksBarId();
          const newBookmark = await bookmarks.createBookmark({
            url: normalizedUrl,
            title: data.title,
            parentId: bookmarksBarId,
          });

          const panelBookmarkEntry: any = {
            name: data.title,
            title: data.title,
            type: "bookmark" as const,
            url: normalizedUrl,
            panel: data.panel,
            id: newBookmark.id,
            isPanelBookmark: true,
          };

          if (data.panel === "full-screen-panel") {
            let coord: { row: number; col: number };
            if (targetSlotIndex !== null) {
              coord = targetSlotIndex;
              setTargetSlotIndex(null);
            } else {
              coord = findEmptySlot(panelBookmarks, gridDimensions.cols, gridDimensions.rows);
            }
            panelBookmarkEntry.row = coord.row;
            panelBookmarkEntry.col = coord.col;
          } else {
            panelBookmarkEntry.index = getNextIndexForPanel(data.panel);
          }

          updatePanelBookmarksWithSave((current) => [...current, panelBookmarkEntry]);

          return newBookmark;
        } catch (error) {
          throw error;
        }
      },
      
      addFolderToPanel: async (data: { title: string; panel: string }) => {
        try {
          const bookmarksBarId = await bookmarks.getBookmarksBarId();
          const newFolder = await bookmarks.createBookmark({
            title: data.title,
            parentId: bookmarksBarId,
          });

          const panelFolderEntry: any = {
            name: data.title,
            title: data.title,
            type: "folder" as const,
            panel: data.panel,
            id: newFolder.id,
            isPanelBookmark: true,
          };

          if (data.panel === "full-screen-panel") {
            let coord: { row: number; col: number };
            if (targetSlotIndex !== null) {
              coord = targetSlotIndex;
              setTargetSlotIndex(null);
            } else {
              coord = findEmptySlot(panelBookmarks, gridDimensions.cols, gridDimensions.rows);
            }
            panelFolderEntry.row = coord.row;
            panelFolderEntry.col = coord.col;
          } else {
            panelFolderEntry.index = getNextIndexForPanel(data.panel);
          }

          updatePanelBookmarksWithSave((current) => [...current, panelFolderEntry]);

          return newFolder;
        } catch (error) {
          throw error;
        }
      }
    };
    return () => {
      delete (window as any).panelBookmarkManager;
    };
  }, [panelBookmarks, getNextIndexForPanel, findEmptySlot, gridDimensions, targetSlotIndex, updatePanelBookmarksWithSave, isRootSafe]);

  // Main bookmark sync
  useEffect(() => {
  const syncFolderBookmarks = async () => {
    try {
      if (!isRootSafe && bookmarks.currentFolder?.id) {
        const folderChildren = ((bookmarks as any).bookmarks || []).filter(
          (bm: any) => bm.parentId === bookmarks.currentFolder.id
        );
        
        const folderBookmarksWithPanels = folderChildren.map((bm: any, index: number) => ({
          ...bm,
          panel: "folder",
          index: index,
          isPanelBookmark: true,
          name: bm.title || bm.name,
          title: bm.title || bm.name,
        }));
        
        setPanelBookmarks(folderBookmarksWithPanels);
        return;
      } else if (isRootSafe) {
        let savedPanelBookmarks = loadPanelBookmarks();

        // Migrate legacy flat-index to (row, col) for full-screen bookmarks
        const hasFsLegacy = savedPanelBookmarks.some(
          bm => bm.panel === "full-screen-panel" && bm.row === undefined && bm.col === undefined
        );
        if (hasFsLegacy) {
          // Use original column count from backup restore if available,
          // otherwise fall back to current viewport calculation
          const storedCols = parseInt(localStorage.getItem('migration-grid-cols') || '0');
          const migrationCols = storedCols > 0 ? storedCols : gridDimensions.cols;
          savedPanelBookmarks = migrateIndexToRowCol(savedPanelBookmarks, migrationCols);
          savePanelBookmarks(savedPanelBookmarks);
          // Clean up migration hint after use
          if (storedCols > 0) {
            localStorage.removeItem('migration-grid-cols');
          }
          console.log(`Migrated full-screen bookmarks from index to (row, col) using cols=${migrationCols}${storedCols > 0 ? ' (from backup)' : ' (current viewport)'}`);
        }

        if (savedPanelBookmarks.length === 0) {
          const currentFolderBookmarks = ((bookmarks as any).bookmarks || []).filter(
            (bm: any) => bm.parentId === bookmarks.currentFolder.id
          );

          if (currentFolderBookmarks.length > 0) {
            const organized = organizeBookmarksForLayout(currentFolderBookmarks.map((bm: any) => ({
              ...bm,
              name: bm.title || bm.name,
              title: bm.title || bm.name,
              url: bm.url ? normalizeUrl(bm.url) : bm.url,
              isPanelBookmark: true,
            })), settings.gridLayout);
            
            setPanelBookmarks(organized);
            savePanelBookmarks(organized);
            setLastOrganizedLayout(settings.gridLayout);
            setHasOrganizedForLayout(true);
            
            try {
              localStorage.setItem(ORGANIZED_LAYOUT_KEY, settings.gridLayout);
              localStorage.setItem(HAS_ORGANIZED_KEY, "true");
            } catch (e) {
              console.error('Failed to save organization state:', e);
            }
          }
        }

        const currentFolderBookmarks = ((bookmarks as any).bookmarks || []).filter(
          (bm: any) => bm.parentId === bookmarks.currentFolder.id
        );

        const syncedBookmarks = savedPanelBookmarks.map(panelBm => {
          const browserBm = currentFolderBookmarks.find((bm: any) => bm.id === panelBm.id);
          
          if (browserBm) {
            return {
              ...panelBm,
              title: browserBm.title || panelBm.title,
              name: browserBm.title || panelBm.name,
              url: browserBm.url ? normalizeUrl(browserBm.url) : panelBm.url,
              type: browserBm.type || panelBm.type,
            };
          } else {
            return null;
          }
        }).filter(Boolean);

        const existingIds = new Set(syncedBookmarks.map(bm => bm.id));
        const newBrowserBookmarks = currentFolderBookmarks.filter(
          (bm: any) => !existingIds.has(bm.id) && bm.type === "bookmark"
        );

        let finalBookmarks = [...syncedBookmarks];
        
        if (newBrowserBookmarks.length > 0) {
          if (settings.gridLayout === "full-screen") {
            const availableCoords = getNextAvailableCoords(finalBookmarks, gridDimensions.cols, gridDimensions.rows, newBrowserBookmarks.length);

            const newPanelBookmarks = newBrowserBookmarks.slice(0, availableCoords.length).map((bm: any, i: number) => ({
              ...bm,
              panel: "full-screen-panel",
              isPanelBookmark: true,
              row: availableCoords[i].row,
              col: availableCoords[i].col,
              name: bm.title || bm.name,
              title: bm.title || bm.name,
              url: bm.url ? normalizeUrl(bm.url) : bm.url,
            }));

            finalBookmarks = [...finalBookmarks, ...newPanelBookmarks];
          } else {
            const panelOrder: PanelName[] = 
              settings.gridLayout === "2-panel" ? ["top-left", "top-right"] :
              settings.gridLayout === "3-panel" ? ["top-left", "top-right", "bottom-full"] :
              ["top-left", "top-right", "bottom-left", "bottom-right"];

            const panelCounts: { [key: string]: number } = {};
            finalBookmarks.forEach(bm => {
              panelCounts[bm.panel] = Math.max(panelCounts[bm.panel] || 0, (bm.index ?? 0) + 1);
            });

            const newPanelBookmarks = newBrowserBookmarks.map((bm: any, i: number) => {
              const targetPanelName = panelOrder[i % panelOrder.length];
              const currentCount = panelCounts[targetPanelName] || 0;
              panelCounts[targetPanelName] = currentCount + 1;
              
              return {
                ...bm,
                panel: targetPanelName,
                isPanelBookmark: true,
                index: currentCount,
                name: bm.title || bm.name,
                title: bm.title || bm.name,
                url: bm.url ? normalizeUrl(bm.url) : bm.url,
              };
            });
            
            finalBookmarks = [...finalBookmarks, ...newPanelBookmarks];
          }
        }

        const savedLastLayout = localStorage.getItem(ORGANIZED_LAYOUT_KEY);
        const needsReorganization = savedLastLayout !== settings.gridLayout && savedLastLayout !== null;
        
        if (needsReorganization) {
          console.log('Layout changed, reorganizing:', savedLastLayout, '->', settings.gridLayout);
          const organized = organizeBookmarksForLayout(finalBookmarks, settings.gridLayout);
          setPanelBookmarks(organized);
          savePanelBookmarks(organized);
          setLastOrganizedLayout(settings.gridLayout);
          setHasOrganizedForLayout(true);
          
          try {
            localStorage.setItem(ORGANIZED_LAYOUT_KEY, settings.gridLayout);
            localStorage.setItem(HAS_ORGANIZED_KEY, "true");
          } catch (e) {
            console.error('Failed to save organization state:', e);
          }
        } else {
          setPanelBookmarks(finalBookmarks);
          if (newBrowserBookmarks.length > 0) {
            savePanelBookmarks(finalBookmarks);
          }
        }
      }
    } catch (error) {
      console.log("Error syncing bookmarks:", error);
    }
  };

  syncFolderBookmarks();
}, [
  bookmarks.currentFolder?.id, 
  isRootSafe, 
  settings.gridLayout, 
  bookmarks.bookmarks,
  organizeBookmarksForLayout,
  gridDimensions,
  getNextAvailableCoords
]);

useEffect(() => {
  const api: any = (typeof chrome !== "undefined" && chrome.bookmarks) ? chrome.bookmarks : (window as any)?.chrome?.bookmarks;
  if (!api) return;

  const handleBookmarkChanged = async (id: string, changeInfo: any) => {
    updatePanelBookmarksWithSave((current) => 
      current.map((bm) => {
        if (bm.id === id) {
          return {
            ...bm,
            title: changeInfo.title || bm.title,
            name: changeInfo.title || bm.name,
            url: changeInfo.url ? normalizeUrl(changeInfo.url) : bm.url,
          };
        }
        return bm;
      })
    );
  };

  const handleBookmarkRemoved = (id: string) => {
    updatePanelBookmarksWithSave((current) => current.filter((bm) => bm.id !== id));
  };

  const handleBookmarkCreated = async (id: string, bookmark: any) => {
    if (bookmark.parentId === bookmarks.currentFolder?.id && bookmark.type === 'bookmark') {
      const newPanelBookmark: any = {
        ...bookmark,
        name: bookmark.title || bookmark.name,
        title: bookmark.title || bookmark.name,
        url: bookmark.url ? normalizeUrl(bookmark.url) : bookmark.url,
        isPanelBookmark: true,
        type: "bookmark",
      };

      if (settings.gridLayout === "full-screen") {
        const coord = findEmptySlot(panelBookmarks, gridDimensions.cols, gridDimensions.rows);
        newPanelBookmark.panel = "full-screen-panel";
        newPanelBookmark.row = coord.row;
        newPanelBookmark.col = coord.col;
      } else {
        newPanelBookmark.panel = "top-left";
        newPanelBookmark.index = getNextIndexForPanel("top-left");
      }

      updatePanelBookmarksWithSave((current) => {
        const exists = current.some(bm => bm.id === id);
        if (exists) return current;
        return [...current, newPanelBookmark];
      });
    }
  };

  const listeners: Array<() => void> = [];

  if (api.onChanged?.addListener) {
    const changedListener = (id: any, changeInfo: any) => handleBookmarkChanged(String(id), changeInfo);
    api.onChanged.addListener(changedListener);
    listeners.push(() => {
      try { api.onChanged.removeListener(changedListener); } catch {}
    });
  }

  if (api.onRemoved?.addListener) {
    const removedListener = (id: any) => handleBookmarkRemoved(String(id));
    api.onRemoved.addListener(removedListener);
    listeners.push(() => {
      try { api.onRemoved.removeListener(removedListener); } catch {}
    });
  }

  if (api.onCreated?.addListener) {
    const createdListener = (id: any, bookmark: any) => handleBookmarkCreated(String(id), bookmark);
    api.onCreated.addListener(createdListener);
    listeners.push(() => {
      try { api.onCreated.removeListener(createdListener); } catch {}
    });
  }

  return () => {
    listeners.forEach(cleanup => cleanup());
  };
}, [isRootSafe, bookmarks.currentFolder?.id, getNextIndexForPanel, updatePanelBookmarksWithSave, findEmptySlot, gridDimensions, panelBookmarks, settings.gridLayout]);

  useEffect(() => {
    const newPanelCount = settings.gridLayout === "2-panel" ? 2 
                        : settings.gridLayout === "3-panel" ? 3 
                        : settings.gridLayout === "full-screen" ? 1
                        : 4;
    
    if (newPanelCount !== currentPanelCount) {
      setCurrentPanelCount(newPanelCount);
    }
  }, [settings.gridLayout, currentPanelCount]);

  useEffect(() => {
    const checkFontSize = () => {
      const gridRef = topLeftGridRef.current;
      if (gridRef) {
        const fontSize = parseFloat(getComputedStyle(gridRef).fontSize);
        setIsMaxFontSize(fontSize === 25.6);
      }
    };
    checkFontSize();
    window.addEventListener("resize", checkFontSize);
    return () => window.removeEventListener("resize", checkFontSize);
  }, [settings.dialSize, settings.maxColumns, settings.squareDials, settings.gridLayout]);

  useEffect(() => {
    const handlePanelBookmarkModal = (event: CustomEvent) => {
      const panel = event.detail?.panel;
      if (panel) {
        openModalForPanel(panel);
      }
    };

    document.addEventListener('openPanelBookmarkModal', handlePanelBookmarkModal);
    
    return () => {
      document.removeEventListener('openPanelBookmarkModal', handlePanelBookmarkModal);
    };
  }, []);

  useEffect(() => {
    if (settings.wallpaper !== "custom-image" && settings.wallpaper !== "custom-color") {
      setGearColor(null);
      return;
    }
    const updateGearColor = async () => {
      const root = document.documentElement;
      const bg = getComputedStyle(root).backgroundColor;
      if (bg.startsWith("rgba")) {
        const bgImg = getComputedStyle(root).backgroundImage;
        const match = bgImg.match(/url\(['"]?([^'"]*?)['"]?\)/);
        const url = match?.[1];
        if (!url) return setGearColor(null);
        try {
          const avg = await getImageAverageColor(url);
          setGearColor(avg < 0.5 ? "#ffffff" : "#000000");
        } catch {
          setGearColor(null);
        }
      } else {
        const white = contrastRatio(bg, "#ffffff");
        const black = contrastRatio(bg, "#000000");
        setGearColor(white > black ? "#ffffff" : "#000000");
      }
    };
    updateGearColor();
    window.addEventListener("resize", updateGearColor);
    return () => window.removeEventListener("resize", updateGearColor);
  }, [settings.wallpaper, settings.customColor, settings.customImage]);

  // DnD Functions
  const reorderWithinPanel = useCallback(
    (panel: string, fromIndex: number, toIndex: number) => {
      updatePanelBookmarksWithSave((curr) => {
        const list = curr
          .filter((b) => b.panel === panel)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (!list.length) return curr;

        const boundedTo = Math.max(0, Math.min(toIndex, list.length - 1));
        const [moved] = list.splice(fromIndex, 1);
        list.splice(boundedTo, 0, moved);

        const indexMap = new Map(list.map((b, i) => [b.id, i]));
        const next = curr.map((b) =>
          b.panel === panel ? { ...b, index: indexMap.get(b.id) ?? 0 } : b
        );
        
        return next;
      });
    },
    [updatePanelBookmarksWithSave]
  );

  const moveAcrossPanels = useCallback(
    (fromPanel: string, fromIndex: number, toPanel: string, toIndex: number) => {
      updatePanelBookmarksWithSave((curr) => {
        const fromList = curr
          .filter((b) => b.panel === fromPanel)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const toList = curr
          .filter((b) => b.panel === toPanel)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

        if (!fromList.length) return curr;

        const [moved] = fromList.splice(fromIndex, 1);
        const boundedTo = Math.max(0, Math.min(toIndex, toList.length));
        toList.splice(boundedTo, 0, { ...moved, panel: toPanel });

        const fromIndexMap = new Map(fromList.map((b, i) => [b.id, i]));
        const toIndexMap = new Map(toList.map((b, i) => [b.id, i]));

        const next = curr.map((b) => {
          if (b.id === moved.id) {
            return { ...b, panel: toPanel, index: toIndexMap.get(b.id) ?? 0 };
          }
          if (b.panel === fromPanel) {
            return { ...b, index: fromIndexMap.get(b.id) ?? 0 };
          }
          if (b.panel === toPanel) {
            return { ...b, index: toIndexMap.get(b.id) ?? 0 };
          }
          return b;
        });

        return next;
      });
    },
    [updatePanelBookmarksWithSave]
  );

  // Drag handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, panel: string, indexOrCoord: number | { row: number; col: number }, id: string) => {
      if (panel === "full-screen-panel" && typeof indexOrCoord === "object") {
        draggedRef.current = { id, panel, index: -1, row: indexOrCoord.row, col: indexOrCoord.col };
      } else {
        draggedRef.current = { id, panel, index: indexOrCoord as number };
      }
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", ""); } catch {}

      const origin = e.currentTarget as HTMLElement;
      const iconEl = origin.querySelector('img') || 
                     origin.querySelector('.icon') || 
                     origin.querySelector('[style*="background-image"]') ||
                     origin.querySelector('svg') ||
                     origin.querySelector('.folder-icon');

      if (iconEl) {
        const dragImage = iconEl.cloneNode(true) as HTMLElement;
        dragImage.style.cssText = `
          opacity: 0.8; transform: scale(0.8); pointer-events: none;
          position: fixed; top: -1000px; left: -1000px;
          border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          width: 32px; height: 32px;
        `;
        
        document.body.appendChild(dragImage);
        dragImageRef.current = dragImage;

        try {
          e.dataTransfer.setDragImage(dragImage, 16, 16);
        } catch {}
      }

      addFolderHoverListeners();
      addBreadcrumbListeners();
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    if (dragImageRef.current) {
      try { document.body.removeChild(dragImageRef.current); } catch {}
      dragImageRef.current = null;
    }
    
    cleanupFolderListeners();
    cleanupBreadcrumbListeners();
    clearAllDragStyles();
    draggedRef.current = null;
  }, [clearAllDragStyles]);

  // Folder operations
  const addFolderHoverListeners = useCallback(() => {
    const sortableItems = document.querySelectorAll("[data-id]");
    sortableItems?.forEach((item: any) => {
      const handleDragOver = (e: Event) => {
        const dragEvent = e as DragEvent;
        const draggedItem = document.querySelector(".sortable-chosen") || 
                           document.querySelector("[draggable='true']:hover");
        
        if (draggedItem && draggedItem !== item) {
          const rect = item.getBoundingClientRect();
          const x = dragEvent.clientX - rect.left;
          const width = rect.width;

          if (isInDragZone(x, width) && item.getAttribute("data-type") === "folder") {
            const targetId = item.getAttribute("data-id");
            const d = draggedRef.current;
            if (d && d.id === targetId) return;
            item.classList.add("folder-drop-target");
          } else {
            item.classList.remove("folder-drop-target");
          }
        }
      };

      const handleDragLeave = (e: Event) => {
        const dragEvent = e as DragEvent;
        if (!item.contains(dragEvent.relatedTarget as Node)) {
          item.classList.remove("folder-drop-target");
        }
      };

      item.addEventListener("dragover", handleDragOver);
      item.addEventListener("dragleave", handleDragLeave);
      (item as any)._folderCleanup = () => {
        item.removeEventListener("dragover", handleDragOver);
        item.removeEventListener("dragleave", handleDragLeave);
      };
    });
  }, []);

  const cleanupFolderListeners = useCallback(() => {
    const sortableItems = document.querySelectorAll("[data-id]");
    sortableItems?.forEach((item: any) => {
      if (item._folderCleanup) item._folderCleanup();
    });
  }, []);

  const addBreadcrumbListeners = useCallback(() => {
    const breadcrumbElement = breadcrumbsRef.current;
    if (!breadcrumbElement) return;
    
    const handleDragOver = (e: Event) => {
      e.preventDefault();
      breadcrumbElement.classList.add("breadcrumb-drop-target");
    };
    
    const handleDragLeave = (e: Event) => {
      const dragEvent = e as DragEvent;
      if (!breadcrumbElement.contains(dragEvent.relatedTarget as Node)) {
        breadcrumbElement.classList.remove("breadcrumb-drop-target");
      }
    };
    
    const handleDrop = (e: Event) => {
      e.preventDefault();
      breadcrumbElement.classList.remove("breadcrumb-drop-target");
      
      const d = draggedRef.current;
      if (d && bookmarks.parentId) {
        moveBookmarkToParentWithPanel(d.id, bookmarks.parentId, d.panel);
      }
    };
    
    breadcrumbElement.addEventListener("dragover", handleDragOver);
    breadcrumbElement.addEventListener("dragleave", handleDragLeave);
    breadcrumbElement.addEventListener("drop", handleDrop);
    
    (breadcrumbElement as any)._breadcrumbCleanup = () => {
      breadcrumbElement.removeEventListener("dragover", handleDragOver);
      breadcrumbElement.removeEventListener("dragleave", handleDragLeave);
      breadcrumbElement.removeEventListener("drop", handleDrop);
    };
  }, []);

  const cleanupBreadcrumbListeners = useCallback(() => {
    const breadcrumbElement = breadcrumbsRef.current;
    if (breadcrumbElement && (breadcrumbElement as any)._breadcrumbCleanup) {
      (breadcrumbElement as any)._breadcrumbCleanup();
    }
  }, []);

  const moveBookmarkToFolder = useCallback(async (draggedId: string, folderId: string) => {
    try {
      await bookmarks.moveBookmark({ id: draggedId, parentId: folderId });
      
      if (isRootSafe) {
        updatePanelBookmarksWithSave((current) => current.filter(bm => bm.id !== draggedId));
      } else {
        setPanelBookmarks((current) => current.filter(bm => bm.id !== draggedId));
      }
    } catch (error) {}
  }, [isRootSafe, updatePanelBookmarksWithSave]);

  const moveBookmarkToParentWithPanel = useCallback(async (draggedId: string, parentId: string, originalPanel: string) => {
    try {
      const draggedBookmark = ((bookmarks as any).bookmarks || []).find((bm: any) => bm.id === draggedId);
      
      await bookmarks.moveBookmark({ id: draggedId, parentId: parentId });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      setPanelBookmarks((current) => current.filter(bm => bm.id !== draggedId));
      
      let currentFolderPanel = panelBookmarks.find((bm: any) => bm.id === bookmarks.currentFolder.id)?.panel || 
                              loadPanelBookmarks().find((bm: any) => bm.id === bookmarks.currentFolder.id)?.panel || 
                              originalPanel;
      
      if (draggedBookmark) {
        const panelBookmarkEntry: any = {
          ...draggedBookmark,
          panel: currentFolderPanel,
          isPanelBookmark: true,
        };

        if (currentFolderPanel === "full-screen-panel") {
          const coord = findEmptySlot(loadPanelBookmarks(), gridDimensions.cols, gridDimensions.rows);
          panelBookmarkEntry.row = coord.row;
          panelBookmarkEntry.col = coord.col;
        } else {
          panelBookmarkEntry.index = getNextIndexForPanel(currentFolderPanel);
        }

        const savedPanelBookmarks = loadPanelBookmarks();
        const updatedSavedBookmarks = [...savedPanelBookmarks, panelBookmarkEntry];
        savePanelBookmarks(updatedSavedBookmarks);
      }
    } catch (error) {}
  }, [panelBookmarks, getNextIndexForPanel, findEmptySlot, gridDimensions]);

  const handleDropOnItem = useCallback((e: React.DragEvent, targetPanel: string, targetIndex: number, targetId: string, targetType: string) => {
    e.preventDefault();
    e.stopPropagation();

    const d = draggedRef.current;
    if (!d) return;

    clearAllDragStyles();

    if (targetType === "folder") {
      if (d.id !== targetId) {
        moveBookmarkToFolder(d.id, targetId);
      }
    } else {
      const safeIndex = Math.max(0, d.index);
      if (d.panel === targetPanel) {
        reorderWithinPanel(targetPanel, safeIndex, targetIndex);
      } else {
        moveAcrossPanels(d.panel, safeIndex, targetPanel, targetIndex);
      }
    }

    draggedRef.current = null;
  }, [reorderWithinPanel, moveAcrossPanels, moveBookmarkToFolder, clearAllDragStyles]);

  const handleDropOnSlot = useCallback((e: React.DragEvent, targetRow: number, targetCol: number) => {
    e.preventDefault();
    e.stopPropagation();

    const d = draggedRef.current;
    if (!d) return;

    clearAllDragStyles();

    if (d.panel === "full-screen-panel" && d.row === targetRow && d.col === targetCol) {
      draggedRef.current = null;
      return;
    }

    updatePanelBookmarksWithSave((currentBookmarks) => {
      const targetBookmark = currentBookmarks.find(
        b => b.panel === "full-screen-panel" && b.row === targetRow && b.col === targetCol
      );

      return currentBookmarks.map(bookmark => {
        if (bookmark.id === d.id) {
          return { ...bookmark, panel: "full-screen-panel", row: targetRow, col: targetCol };
        }
        if (targetBookmark && bookmark.id === targetBookmark.id) {
          if (d.panel === "full-screen-panel") {
            return { ...bookmark, row: d.row!, col: d.col! };
          } else {
            const empty = findEmptySlot(
              currentBookmarks.filter(b => b.id !== d.id),
              gridDimensions.cols, gridDimensions.rows
            );
            return { ...bookmark, row: empty.row, col: empty.col };
          }
        }
        return bookmark;
      });
    });

    draggedRef.current = null;
  }, [clearAllDragStyles, gridDimensions, findEmptySlot, updatePanelBookmarksWithSave]);

  const handleDropOnPanelEnd = useCallback((e: React.DragEvent, targetPanel: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const d = draggedRef.current;
    if (!d) return;

    clearAllDragStyles();

    if (targetPanel === "full-screen-panel") {
      updatePanelBookmarksWithSave((current) => {
        const empty = findEmptySlot(current, gridDimensions.cols, gridDimensions.rows);
        return current.map(bookmark =>
          bookmark.id === d.id
            ? { ...bookmark, panel: "full-screen-panel", row: empty.row, col: empty.col }
            : bookmark
        );
      });
    } else {
      const panelItems = panelBookmarks
        .filter((b) => b.panel === targetPanel)
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      const targetIndex = panelItems.length;
      if (d.panel === targetPanel) {
        reorderWithinPanel(targetPanel, d.index, targetIndex - 1);
      } else {
        moveAcrossPanels(d.panel, d.index, targetPanel, targetIndex);
      }
    }
    
    draggedRef.current = null;
  }, [panelBookmarks, reorderWithinPanel, moveAcrossPanels, clearAllDragStyles, gridDimensions, findEmptySlot, updatePanelBookmarksWithSave]);

  // Drag event handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleItemDragEnter = useCallback((e: React.DragEvent) => {
    e.currentTarget.classList.add('drag-over');
  }, []);

  const handleItemDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      e.currentTarget.classList.remove('drag-over');
    }
  }, []);

  const handlePanelDragEnter = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      e.currentTarget.classList.add('drag-over-panel');
    }
  }, []);

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      e.currentTarget.classList.remove('drag-over-panel');
    }
  }, []);

  // Modal functions
  const openModalForPanel = (panel: string) => {
    setActivePanel(panel);
    targetPanelRef.current = panel;
    setIsModalOpen(true);
  };

  const handleSaveBookmark = async (data: { title: string; url: string; panel?: string }) => {
    const targetPanel = data.panel || targetPanelRef.current;
    if (!targetPanel) return;

    const normalizedUrl = normalizeUrl(data.url);

    if (modals.editingBookmarkId && panelBookmarks.some((b) => b.id === modals.editingBookmarkId)) {
      // EDIT BOOKMARK
      try {
        await bookmarks.updateBookmark(modals.editingBookmarkId, {
          title: data.title,
          url: normalizedUrl,
        });
        
        updatePanelBookmarksWithSave((current) =>
          current.map((b) =>
            b.id === modals.editingBookmarkId
              ? {
                  ...b,
                  name: data.title,
                  title: data.title,
                  url: normalizedUrl,
                  panel: data.panel || targetPanel,
                  ...(targetPanel === "full-screen-panel" || (data.panel || targetPanel) === "full-screen-panel"
                    ? (targetSlotIndex !== null
                        ? { row: targetSlotIndex.row, col: targetSlotIndex.col }
                        : { row: b.row, col: b.col })
                    : { index: b.index }),
                }
              : b
          )
        );
        
        modals.editingBookmarkId = null;
        modals.isOpen = null;
        setTargetSlotIndex(null);
      } catch (error) {
        console.error("Error updating bookmark:", error);
      }
    } else {
      // NEW BOOKMARK
      try {
        const tempId = `temp-${Date.now()}-${Math.random()}`;
        const panelBookmarkEntry: any = {
          name: data.title,
          title: data.title,
          type: "bookmark" as const,
          url: normalizedUrl,
          panel: targetPanel,
          id: tempId,
          isPanelBookmark: true,
        };

        if (targetPanel === "full-screen-panel") {
          let coord: { row: number; col: number };
          if (targetSlotIndex !== null) {
            coord = targetSlotIndex;
            setTargetSlotIndex(null);
          } else {
            coord = findEmptySlot(panelBookmarks, gridDimensions.cols, gridDimensions.rows);
          }
          panelBookmarkEntry.row = coord.row;
          panelBookmarkEntry.col = coord.col;
        } else {
          panelBookmarkEntry.index = getNextIndexForPanel(targetPanel);
        }

        updatePanelBookmarksWithSave((current) => [...current, panelBookmarkEntry]);

        const parentId = isRootSafe ? await bookmarks.getBookmarksBarId() : bookmarks.currentFolder.id;
        
        const newBookmark = await bookmarks.createBookmark({
          url: normalizedUrl,
          title: data.title,
          parentId: parentId,
        });

        updatePanelBookmarksWithSave((current) => 
          current.map(bm => 
            bm.id === tempId ? { ...bm, id: newBookmark.id } : bm
          )
        );
        
      } catch (error) {
        updatePanelBookmarksWithSave((current) => current.filter(bm => !bm.id.startsWith('temp-')));
      }
    }
    try {
      localStorage.setItem(ORGANIZED_LAYOUT_KEY, settings.gridLayout);
      localStorage.setItem(HAS_ORGANIZED_KEY, "true");
    } catch (e) {
      console.error('Failed to save organization state:', e);
    }
    setIsModalOpen(false);
    setActivePanel(null);
    targetPanelRef.current = null;
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setActivePanel(null);
    targetPanelRef.current = null;
    setTargetSlotIndex(null);
    modals.editingBookmarkId = null;
    modals.isOpen = null;
  };

  // Render helpers
  const getBookmarksByPanel = useCallback(
    (panelName: string) => {
      const filtered = panelBookmarks.filter((bm) => bm.panel === panelName);
      if (panelName === "full-screen-panel") {
        return filtered.sort((a, b) => {
          const rowDiff = (a.row ?? 0) - (b.row ?? 0);
          return rowDiff !== 0 ? rowDiff : (a.col ?? 0) - (b.col ?? 0);
        });
      }
      return filtered.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    },
    [panelBookmarks]
  );

  const renderPanel = useCallback(
    (panelName: PanelName, gridRef: React.RefObject<HTMLDivElement>) => {
      const list = getBookmarksByPanel(panelName);
      return (
        <div
          className={clsx("Grid", isMaxFontSize && "max-width")}
          style={
            {
              "--grid-max-cols": settings.maxColumns === "Unlimited" ? "999" : settings.maxColumns,
              overflowX: "hidden",
              minHeight: "200px",
              border: "2px solid transparent",
              borderRadius: "12px",
              transition: "all 0.3s ease",
              position: "relative",
              padding: "8px",
            } as React.CSSProperties
          }
          ref={gridRef}
          data-panel={panelName}
          onDragOver={handleDragOver}
          onDragEnter={handlePanelDragEnter}
          onDragLeave={handlePanelDragLeave}
          onDrop={(e) => handleDropOnPanelEnd(e, panelName)}
        >
          {list.map((bm, i) => (
            <div
              key={bm.id}
              data-id={bm.id}
              data-type={bm.type}
              draggable
              onDragStart={(e) => handleDragStart(e, panelName, i, bm.id)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragEnter={handleItemDragEnter}
              onDragLeave={handleItemDragLeave}
              onDrop={(e) => handleDropOnItem(e, panelName, i, bm.id, bm.type)}
              style={{
                transition: 'all 0.2s ease',
                borderRadius: '8px',
                cursor: 'grab',
              }}
            >
              <Dial {...bm} />
            </div>
          ))}

          {isRootSafe && settings.gridLayout !== "full-screen" && (
            <div
              className="add-button"
              onClick={() => openModalForPanel(panelName)}
              data-panel={panelName}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                fontWeight: "bold",
                color: "rgba(255,255,255,0.7)",
                backgroundColor: "rgba(255,255,255,0.1)",
                border: "2px dashed rgba(255,255,255,0.3)",
                borderRadius: "8px",
                minHeight: "60px",
                minWidth: "60px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
              }}
            >
              +
            </div>
          )}
        </div>
      );
    },
    [
      getBookmarksByPanel,
      isMaxFontSize,
      settings.maxColumns,
      handleDragStart,
      handleDragEnd,
      handleDropOnItem,
      handleDropOnPanelEnd,
      handleDragOver,
      handleItemDragEnter,
      handleItemDragLeave,
      handlePanelDragEnter,
      handlePanelDragLeave,
      isRootSafe,
      settings.gridLayout,
    ]
  );

  const renderFullScreenPanel = () => {
    const list = getBookmarksByPanel("full-screen-panel");
    const { cols, rows } = gridDimensions;

    // Build occupied map: "row,col" -> bookmark
    const occupiedMap = new Map<string, any>();
    list
      .filter(bm => bm.row !== undefined && bm.col !== undefined && bm.row < rows && bm.col < cols)
      .forEach(bm => occupiedMap.set(coordToKey(bm.row, bm.col), bm));

    // Generate all visible cells
    const cells: { row: number; col: number; bm: any | null }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ row: r, col: c, bm: occupiedMap.get(coordToKey(r, c)) || null });
      }
    }

    const handleSlotDoubleClick = (row: number, col: number) => {
      if (!occupiedMap.has(coordToKey(row, col))) {
        setTargetSlotIndex({ row, col });
        targetPanelRef.current = "full-screen-panel";
        openModalForPanel("full-screen-panel");
      }
    };

    const handleSlotRightClick = (e: React.MouseEvent, row: number, col: number) => {
      e.preventDefault();
      if (!occupiedMap.has(coordToKey(row, col))) {
        setTargetSlotIndex({ row, col });
      }
    };

    return (
      <div
        className={clsx("Grid", isMaxFontSize && "max-width")}
        style={
          {
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            gap: "1.75em",
            overflowX: "hidden",
            overflowY: "hidden",
            height: "100vh",
            padding: "20px",
            boxSizing: "border-box",
          } as React.CSSProperties
        }
        ref={bottomFullGridRef}
        data-panel="full-screen-panel"
        onDragOver={handleDragOver}
        onDragEnter={handlePanelDragEnter}
        onDragLeave={handlePanelDragLeave}
        onDrop={(e) => handleDropOnPanelEnd(e, "full-screen-panel")}
      >
        {cells.map(({ row, col, bm }) => (
          <div
            key={`slot-${row}-${col}`}
            className="grid-slot"
            data-slot-row={row}
            data-slot-col={col}
            style={{
              gridColumn: col + 1,
              gridRow: row + 1,
              position: 'relative',
              minHeight: '60px',
              minWidth: '60px',
              transition: 'all 0.2s ease',
              borderRadius: '8px',
              cursor: bm ? 'grab' : 'pointer',
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.add('drag-over-slot');
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                e.currentTarget.classList.remove('drag-over-slot');
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.remove('drag-over-slot');
              handleDropOnSlot(e, row, col);
            }}
            onDoubleClick={() => handleSlotDoubleClick(row, col)}
            onContextMenu={(e) => handleSlotRightClick(e, row, col)}
          >
            {bm && (
              <div
                data-id={bm.id}
                data-type={bm.type}
                data-current-row={row}
                data-current-col={col}
                draggable
                onDragStart={(e) => {
                  handleDragStart(e, "full-screen-panel", { row, col }, bm.id);
                }}
                onDragEnd={handleDragEnd}
                style={{
                  transition: 'all 0.2s ease',
                  borderRadius: '8px',
                  cursor: 'grab',
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'auto',
                }}
              >
                <Dial {...bm} />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderGridLayout = () => {
    if (settings.gridLayout === "full-screen") { 
      return renderFullScreenPanel(); 
    }
    
    if (!isRootSafe) {
      const folderBookmarks = panelBookmarks.filter(bm => 
        bm.parentId === bookmarks.currentFolder.id
      );
      
      return (
        <div
          className={clsx("Grid", isMaxFontSize && "max-width")}
          style={
            {
              "--grid-max-cols": settings.maxColumns === "Unlimited" ? "999" : settings.maxColumns,
              overflowX: "hidden",
              minHeight: "200px",
              border: "2px solid transparent",
              borderRadius: "12px",
              transition: "all 0.3s ease",
              position: "relative",
              padding: "60px 80px",
              display: "grid",
              gap: "30px",
              justifyItems: "center",
            } as React.CSSProperties
          }
        >
          {folderBookmarks.map((bm, i) => (
            <div
              key={bm.id}
              data-id={bm.id}
              data-type={bm.type}
              draggable
              onDragStart={(e) => handleDragStart(e, "folder", i, bm.id)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragEnter={handleItemDragEnter}
              onDragLeave={handleItemDragLeave}
              onDrop={(e) => handleDropOnItem(e, "folder", i, bm.id, bm.type)}
              style={{
                transition: 'all 0.2s ease',
                borderRadius: '8px',
                cursor: 'grab',
              }}
            >
              <Dial {...bm} />
            </div>
          ))}
        </div>
      );
    }

    // Panel layouts
    const commonGridStyle = {
      display: "grid",
      height: "100vh",
      gap: "20px",
      padding: "60px 80px",
      overflow: "hidden",
      boxSizing: "border-box" as const,
    };

    if (settings.gridLayout === "2-panel") {
      return (
        <div data-grid-component="true" style={{ ...commonGridStyle, gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr" }}>
          {renderPanel("top-left", topLeftGridRef)}
          {renderPanel("top-right", topRightGridRef)}
        </div>
      );
    } else if (settings.gridLayout === "3-panel") {
      return (
        <div className="three-panel-wrapper" data-grid-component="true" style={{ ...commonGridStyle, gridTemplateColumns: "1fr 1fr", gridTemplateRows: "0.8fr auto" }}>
          {renderPanel("top-left", topLeftGridRef)}
          {renderPanel("top-right", topRightGridRef)}
          <div style={{ gridColumn: "1 / span 2", paddingTop: "0px" }}>
            {renderPanel("bottom-full", bottomFullGridRef)}
          </div>
        </div>
      );
    }
    
    return (
      <div className="FourPanelWrapper" data-grid-component="true" style={{ ...commonGridStyle, gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", overflowY: "visible" }}>
        {renderPanel("top-left", topLeftGridRef)}
        {renderPanel("top-right", topRightGridRef)}
        {renderPanel("bottom-left", bottomLeftGridRef)}
        {renderPanel("bottom-right", bottomRightGridRef)}
      </div>
    );
  };

  const dragStyles = `
    .drag-over {
      background: rgba(99, 102, 241, 0.1) !important;
      border: 2px dashed rgba(99, 102, 241, 0.5) !important;
      transform: scale(0.95);
      border-radius: 8px !important;
    }
    
    .drag-over-panel {
      background: rgba(99, 102, 241, 0.05) !important;
      border: 2px dashed rgba(99, 102, 241, 0.3) !important;
    }
    
    .drag-over-slot {
      background: rgba(99, 102, 241, 0.15) !important;
      border: 2px dashed rgba(99, 102, 241, 0.5) !important;
      transform: scale(1.02);
    }
    
    .folder-drop-target {
      background: rgba(34, 197, 94, 0.1) !important;
      border: 2px dashed rgba(34, 197, 94, 0.5) !important;
      transform: scale(1.05);
      box-shadow: 0 0 20px rgba(34, 197, 94, 0.3) !important;
    }
    
    .breadcrumb-drop-target {
      background: rgba(234, 179, 8, 0.1) !important;
      border: 2px dashed rgba(234, 179, 8, 0.5) !important;
      border-radius: 8px !important;
      padding: 8px 16px !important;
    }
    
    .grid-slot:empty:hover {
      background: rgba(255, 255, 255, 0.05);
      border: 1px dashed rgba(255, 255, 255, 0.2);
    }
    
    .grid-slot:empty:active {
      background: rgba(255, 255, 255, 0.1);
    }
    
    [draggable="true"] {
      cursor: grab !important;
    }
    
    [draggable="true"]:hover:not(.drag-over):not(.folder-drop-target) {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    [draggable="true"]:active {
      cursor: grabbing !important;
    }
    
    * {
      user-select: none;
    }
  `;

  return (
    <>
      <style>{dragStyles}</style>
      
      {!isRootSafe && (
        <div 
          className="Breadcrumbs" 
          ref={breadcrumbsRef}
          style={{
            position: "fixed",
            top: "20px",
            left: "20px",
            zIndex: 1000,
            margin: "0",
            padding: "0",
            backgroundColor: "transparent",
            transition: "all 0.3s ease",
          }}
        >
          <a 
            href={`#${bookmarks.parentId}`} 
            title="Go to parent folder"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "rgba(255, 255, 255, 0.8)",
              textDecoration: "none",
              fontSize: "16px",
              fontWeight: "500",
              padding: "0",
              backgroundColor: "transparent",
              border: "none",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              style={{
                width: "20px",
                height: "20px",
                fill: "currentColor",
              }}
            >
              <rect fill="none" height="24" width="24" />
              <g>
                <polygon points="17.77,3.77 16,2 6,12 16,22 17.77,20.23 9.54,12" />
              </g>
            </svg>
            <span>{bookmarks.currentFolder.title}</span>
          </a>
        </div>
      )}
      
      {renderGridLayout()}

      {isModalOpen && (
        <BookmarkModal
          onClose={handleCloseModal}
          onSave={handleSaveBookmark}
          targetPanel={activePanel}
        />
      )}

      <SettingsGear
        style={{
          color: gearColor || undefined,
          position: "fixed",
          top: "20px",
          right: "20px",
          zIndex: 1000,
        }}
      />
    </>
  );
});