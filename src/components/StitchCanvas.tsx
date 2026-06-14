import { useEffect, useRef, useCallback } from "react";
import { CanvasRenderer } from "@/engine/CanvasRenderer";
import { useCanvasStore } from "@/store/canvasStore";
import { useColorStore } from "@/store/colorStore";
import type { SelectionRect } from "@/types";

export interface StitchCanvasHandle {
  getRenderer: () => CanvasRenderer | null;
}

function isPointInRect(col: number, row: number, rect: SelectionRect): boolean {
  return (
    col >= rect.col &&
    col < rect.col + rect.width &&
    row >= rect.row &&
    row < rect.row + rect.height
  );
}

function isPointInAnyRect(col: number, row: number, rects: SelectionRect[]): boolean {
  return rects.some((r) => isPointInRect(col, row, r));
}

export default function StitchCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const isPanningRef = useRef(false);
  const isPaintingRef = useRef(false);
  const spacePressedRef = useRef(false);
  const lastPaintRef = useRef<{ col: number; row: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const marchingRafRef = useRef<number | null>(null);

  const selectStartRef = useRef<{ col: number; row: number } | null>(null);
  const selectDraggingRef = useRef(false);
  const moveStartRef = useRef<{ col: number; row: number; x: number; y: number } | null>(null);
  const isMovingRef = useRef(false);

  const {
    cols, rows, cells, viewport, tool,
    hoveredCell, showStitchMark,
    selectionRects, selectionClipboard, selectionActionMode,
    selectionGhostOffset, selectionMarchingPhase,
    setViewport, setHoveredCell, paintCell, pushUndo,
    setSelectionRects, clearSelection, setSelectionActionMode,
    setSelectionGhostOffset, setSelectionMarchingPhase,
    selectionCopy, selectionPaste, selectionMove,
    selectionRotate, selectionFlip,
  } = useCanvasStore();

  const colors = useColorStore((s) => s.colors);
  const selectedColorId = useColorStore((s) => s.selectedColorId);
  const setSelectedColorId = useColorStore((s) => s.setSelected);

  const colorMapRef = useRef(new Map<string, ReturnType<typeof useColorStore.getState>["colors"][number]>());
  useEffect(() => {
    colorMapRef.current = new Map(colors.map((c) => [c.id, c]));
  }, [colors]);

  const scheduleRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const r = rendererRef.current;
      if (!r) return;
      const state = useCanvasStore.getState();
      const ghostCells = state.selectionActionMode === "pasting" ? state.selectionClipboard?.cells : null;
      r.render({
        viewport: state.viewport,
        cols: state.cols,
        rows: state.rows,
        cells: state.cells,
        colorMap: colorMapRef.current,
        hoveredCell: state.hoveredCell,
        showStitchMark: state.showStitchMark,
        selectionRects: state.selectionRects,
        selectionMarchingPhase: state.selectionMarchingPhase,
        ghostCells,
        ghostOffset: state.selectionGhostOffset,
      });
    });
  }, []);

  const startMarchingAnimation = useCallback(() => {
    if (marchingRafRef.current) return;
    let lastTime = performance.now();
    const animate = (time: number) => {
      const delta = time - lastTime;
      lastTime = time;
      const state = useCanvasStore.getState();
      const newPhase = (state.selectionMarchingPhase + delta * 0.03) % 20;
      setSelectionMarchingPhase(newPhase);
      scheduleRender();
      marchingRafRef.current = requestAnimationFrame(animate);
    };
    marchingRafRef.current = requestAnimationFrame(animate);
  }, [scheduleRender, setSelectionMarchingPhase]);

  const stopMarchingAnimation = useCallback(() => {
    if (marchingRafRef.current) {
      cancelAnimationFrame(marchingRafRef.current);
      marchingRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (selectionRects.length > 0 || selectionActionMode === "pasting") {
      startMarchingAnimation();
    } else {
      stopMarchingAnimation();
    }
  }, [selectionRects.length, selectionActionMode, startMarchingAnimation, stopMarchingAnimation]);

  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;

    const handleResize = () => {
      const rect = el.getBoundingClientRect();
      renderer.resize(rect.width, rect.height);
      scheduleRender();
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    scheduleRender();

    setTimeout(() => {
      const store = useCanvasStore.getState();
      const rect = el.getBoundingClientRect();
      store.fitViewport(rect.width, rect.height, 40);
    }, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopMarchingAnimation();
    };
  }, [scheduleRender, stopMarchingAnimation]);

  useEffect(() => {
    scheduleRender();
  }, [
    viewport, cols, rows, cells, hoveredCell, showStitchMark,
    selectionRects, selectionMarchingPhase, selectionGhostOffset,
    selectionActionMode, selectionClipboard,
    scheduleRender,
  ]);

  useEffect(() => {
    scheduleRender();
  }, [colors, scheduleRender]);

  const applyPaintAt = useCallback(
    (col: number, row: number) => {
      const state = useCanvasStore.getState();
      const mode = state.tool;
      if (mode === "brush") {
        if (!selectedColorId) return;
        paintCell(col, row, selectedColorId);
      } else if (mode === "eraser") {
        paintCell(col, row, null);
      } else if (mode === "picker") {
        const cid = state.cells[row]?.[col];
        if (cid) setSelectedColorId(cid);
      }
    },
    [selectedColorId, paintCell, setSelectedColorId]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getPos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onMouseMove = (e: MouseEvent) => {
      const pos = getPos(e);
      const renderer = rendererRef.current;
      if (!renderer) return;
      const vp = useCanvasStore.getState().viewport;
      const { col, row } = renderer.screenToGrid(pos.x, pos.y, vp);
      const state = useCanvasStore.getState();

      setHoveredCell({ col, row });

      if (isPanningRef.current && panStartRef.current) {
        const dx = pos.x - panStartRef.current.x;
        const dy = pos.y - panStartRef.current.y;
        setViewport({
          offsetX: panStartRef.current.ox + dx,
          offsetY: panStartRef.current.oy + dy,
        });
        return;
      }

      if (state.tool === "select") {
        if (selectDraggingRef.current && selectStartRef.current) {
          const start = selectStartRef.current;
          const width = col - start.col + 1;
          const height = row - start.row + 1;
          const tempRect: SelectionRect = { col: start.col, row: start.row, width, height };
          const s = useCanvasStore.getState();
          const allRects = s.selectionRects.slice(0, e.shiftKey ? -1 : 0);
          setSelectionRects([...allRects, tempRect], false);
          return;
        }

        if (isMovingRef.current && moveStartRef.current && state.selectionRects.length > 0) {
          const { col: startCol, row: startRow } = moveStartRef.current;
          const dCol = col - startCol;
          const dRow = row - startRow;
          if (dCol !== 0 || dRow !== 0) {
            moveStartRef.current = { col, row, x: pos.x, y: pos.y };
            const s = useCanvasStore.getState();
            s.selectionMove(dCol, dRow, true);
          }
          return;
        }

        if (state.selectionActionMode === "pasting" && state.selectionClipboard) {
          const offsetCol = col;
          const offsetRow = row;
          setSelectionGhostOffset({ col: offsetCol, row: offsetRow });
          return;
        }

        if (state.selectionRects.length > 0 && !spacePressedRef.current) {
          const inSelection = isPointInAnyRect(col, row, state.selectionRects);
          canvas.style.cursor = inSelection ? "move" : "crosshair";
        } else {
          canvas.style.cursor = "crosshair";
        }
        return;
      }

      if (isPaintingRef.current && !spacePressedRef.current) {
        const last = lastPaintRef.current;
        if (!last || last.col !== col || last.row !== row) {
          const state = useCanvasStore.getState();
          if (col >= 0 && col < state.cols && row >= 0 && row < state.rows) {
            applyPaintAt(col, row);
            lastPaintRef.current = { col, row };
          }
        }
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const pos = getPos(e);
      const renderer = rendererRef.current;
      if (!renderer) return;
      const vp = useCanvasStore.getState().viewport;
      const { col, row } = renderer.screenToGrid(pos.x, pos.y, vp);
      const state = useCanvasStore.getState();

      const shouldPan =
        e.button === 1 ||
        (e.button === 0 && spacePressedRef.current) ||
        (e.button === 0 && e.shiftKey && state.tool !== "select");

      if (shouldPan) {
        isPanningRef.current = true;
        panStartRef.current = {
          x: pos.x,
          y: pos.y,
          ox: vp.offsetX,
          oy: vp.offsetY,
        };
        canvas.style.cursor = "grabbing";
        e.preventDefault();
        return;
      }

      if (e.button === 0 && state.tool === "select") {
        if (state.selectionActionMode === "pasting" && state.selectionClipboard) {
          if (col >= 0 && col < state.cols && row >= 0 && row < state.rows) {
            selectionPaste(col, row);
          }
          return;
        }

        const inSelection = isPointInAnyRect(col, row, state.selectionRects);
        if (inSelection && !e.shiftKey) {
          isMovingRef.current = true;
          moveStartRef.current = { col, row, x: pos.x, y: pos.y };
          canvas.style.cursor = "grabbing";
          pushUndo();
          return;
        }

        selectStartRef.current = { col, row };
        selectDraggingRef.current = true;
        setSelectionActionMode("drawing");
        if (!e.shiftKey) {
          setSelectionRects([{ col, row, width: 1, height: 1 }], false);
        } else {
          const s = useCanvasStore.getState();
          setSelectionRects([...s.selectionRects, { col, row, width: 1, height: 1 }], false);
        }
        return;
      }

      if (e.button === 0) {
        const mode = state.tool;
        if (mode === "picker") {
          const cid = state.cells[row]?.[col];
          if (cid) setSelectedColorId(cid);
          return;
        }
        if (col >= 0 && col < state.cols && row >= 0 && row < state.rows) {
          pushUndo();
          isPaintingRef.current = true;
          lastPaintRef.current = { col, row };
          applyPaintAt(col, row);
        }
      }
    };

    const onMouseUp = () => {
      isPaintingRef.current = false;
      isPanningRef.current = false;
      panStartRef.current = null;
      lastPaintRef.current = null;
      selectDraggingRef.current = false;
      selectStartRef.current = null;
      isMovingRef.current = false;
      moveStartRef.current = null;

      const state = useCanvasStore.getState();
      if (state.tool === "select" && state.selectionActionMode === "drawing") {
        setSelectionActionMode("idle");
      }

      if (canvasRef.current) {
        const s = useCanvasStore.getState();
        if (spacePressedRef.current) {
          canvasRef.current.style.cursor = "grab";
        } else if (s.tool === "select" && s.selectionRects.length > 0) {
          canvasRef.current.style.cursor = "crosshair";
        } else {
          canvasRef.current.style.cursor = "crosshair";
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pos = getPos(e);
      const vp = useCanvasStore.getState().viewport;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(2, Math.min(60, vp.scale * delta));
      const ratio = newScale / vp.scale;
      setViewport({
        scale: newScale,
        offsetX: pos.x - (pos.x - vp.offsetX) * ratio,
        offsetY: pos.y - (pos.y - vp.offsetY) * ratio,
      });
    };

    const onMouseLeave = () => {
      setHoveredCell(null);
      isPanningRef.current = false;
      isPaintingRef.current = false;
      panStartRef.current = null;
      lastPaintRef.current = null;
      selectDraggingRef.current = false;
      selectStartRef.current = null;
      isMovingRef.current = false;
      moveStartRef.current = null;
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("contextmenu", onContextMenu);

    return () => {
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [applyPaintAt, setViewport, setHoveredCell, pushUndo, setSelectedColorId,
      setSelectionRects, setSelectionActionMode, setSelectionGhostOffset,
      selectionPaste]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        spacePressedRef.current = true;
        if (canvasRef.current && !isPanningRef.current) {
          canvasRef.current.style.cursor = "grab";
        }
      }
      if (e.code === "KeyB") useCanvasStore.getState().setTool("brush");
      if (e.code === "KeyE") useCanvasStore.getState().setTool("eraser");
      if (e.code === "KeyI") useCanvasStore.getState().setTool("picker");
      if (e.code === "KeyV" && !e.ctrlKey && !e.metaKey) {
        const s = useCanvasStore.getState();
        if (s.selectionClipboard && s.tool === "select") {
          s.setSelectionActionMode("pasting");
          s.setSelectionGhostOffset(s.hoveredCell || { col: 0, row: 0 });
        } else {
          useCanvasStore.getState().setTool("select");
        }
      }
      if (e.code === "Escape") {
        const s = useCanvasStore.getState();
        if (s.selectionActionMode === "pasting") {
          s.setSelectionActionMode("idle");
          s.setSelectionGhostOffset(null);
        } else {
          s.clearSelection();
        }
      }
      if (e.code === "KeyC" && (e.ctrlKey || e.metaKey)) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.selectionCopy();
        }
      }
      if (e.code === "KeyV" && (e.ctrlKey || e.metaKey)) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionClipboard) {
          e.preventDefault();
          if (s.selectionActionMode !== "pasting") {
            s.setSelectionActionMode("pasting");
            s.setSelectionGhostOffset(s.hoveredCell || { col: 0, row: 0 });
          }
        }
      }
      if (e.code === "KeyR" && !e.repeat) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.selectionRotate(!e.shiftKey);
        }
      }
      if (e.code === "KeyH" && !e.repeat && !e.ctrlKey && !e.metaKey) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.selectionFlip(true);
        }
      }
      if (e.code === "KeyF" && !e.repeat && !e.ctrlKey && !e.metaKey) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.selectionFlip(false);
        }
      }
      if ((e.code === "Delete" || e.code === "Backspace") && !e.repeat) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.pushUndo();
          const changes: { col: number; row: number; colorId: null }[] = [];
          for (const rect of s.selectionRects) {
            for (let r = rect.row; r < rect.row + rect.height; r++) {
              for (let c = rect.col; c < rect.col + rect.width; c++) {
                if (c >= 0 && c < s.cols && r >= 0 && r < s.rows) {
                  if (s.cells[r][c] !== null) {
                    changes.push({ col: c, row: r, colorId: null });
                  }
                }
              }
            }
          }
          if (changes.length > 0) {
            s.paintCells(changes);
          }
        }
      }
      if (e.code === "ArrowUp" && !e.repeat) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.selectionMove(0, -1);
        }
      }
      if (e.code === "ArrowDown" && !e.repeat) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.selectionMove(0, 1);
        }
      }
      if (e.code === "ArrowLeft" && !e.repeat) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.selectionMove(-1, 0);
        }
      }
      if (e.code === "ArrowRight" && !e.repeat) {
        const s = useCanvasStore.getState();
        if (s.tool === "select" && s.selectionRects.length > 0) {
          e.preventDefault();
          s.selectionMove(1, 0);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        useCanvasStore.getState().undo();
      }
      if (
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyZ") ||
        ((e.metaKey || e.ctrlKey) && e.code === "KeyY")
      ) {
        e.preventDefault();
        useCanvasStore.getState().redo();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spacePressedRef.current = false;
        if (canvasRef.current && !isPanningRef.current) {
          const s = useCanvasStore.getState();
          canvasRef.current.style.cursor = s.tool === "select" ? "crosshair" : "crosshair";
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative linen-bg overflow-hidden rounded-xl"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: "crosshair", touchAction: "none" }}
      />
    </div>
  );
}
