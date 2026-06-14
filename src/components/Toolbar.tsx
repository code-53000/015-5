import {
  Brush,
  Eraser,
  Pipette,
  Undo2,
  Redo2,
  Trash2,
  Save,
  Grid3X3,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Ribbon,
  MousePointer2,
  Copy,
  ClipboardPaste,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Move,
  Lock,
  Unlock,
} from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useColorStore } from "@/store/colorStore";
import clsx from "clsx";

interface Props {
  onSave: () => void;
  onResize: () => void;
  onRendererReady?: (r: unknown) => void;
}

export default function Toolbar({ onSave, onResize }: Props) {
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  const viewport = useCanvasStore((s) => s.viewport);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const fitViewport = useCanvasStore((s) => s.fitViewport);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const clearAll = useCanvasStore((s) => s.clearAll);
  const undos = useCanvasStore((s) => s.undos.length);
  const redos = useCanvasStore((s) => s.redos.length);
  const showStitch = useCanvasStore((s) => s.showStitchMark);
  const setShowStitch = useCanvasStore((s) => s.setShowStitchMark);
  const schemeName = useCanvasStore((s) => s.currentSchemeName);
  const saving = useCanvasStore((s) => null);

  const selectionRects = useCanvasStore((s) => s.selectionRects);
  const selectionClipboard = useCanvasStore((s) => s.selectionClipboard);
  const selectionClearOnToolSwitch = useCanvasStore((s) => s.selectionClearOnToolSwitch);
  const selectionCopy = useCanvasStore((s) => s.selectionCopy);
  const selectionPaste = useCanvasStore((s) => s.selectionPaste);
  const selectionRotate = useCanvasStore((s) => s.selectionRotate);
  const selectionFlip = useCanvasStore((s) => s.selectionFlip);
  const setSelectionActionMode = useCanvasStore((s) => s.setSelectionActionMode);
  const setSelectionGhostOffset = useCanvasStore((s) => s.setSelectionGhostOffset);
  const setSelectionClearOnToolSwitch = useCanvasStore((s) => s.setSelectionClearOnToolSwitch);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const hoveredCell = useCanvasStore((s) => s.hoveredCell);

  const selectedColor = useColorStore((s) => s.colors.find((c) => c.id === s.selectedColorId));

  const handleZoom = (factor: number) => {
    const currentScale = useCanvasStore.getState().viewport.scale;
    setViewport({ scale: Math.max(2, Math.min(60, currentScale * factor)) });
  };

  const tools = [
    { id: "brush" as const, icon: Brush, label: "画笔", shortcut: "B" },
    { id: "eraser" as const, icon: Eraser, label: "橡皮", shortcut: "E" },
    { id: "picker" as const, icon: Pipette, label: "吸管", shortcut: "I" },
    { id: "select" as const, icon: MousePointer2, label: "选区", shortcut: "V" },
  ];

  return (
    <header className="h-14 flex items-center gap-2 px-4 paper-card border-b border-linen-300 shrink-0">
      <div className="flex items-center gap-2 mr-2">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-stitch-300 to-stitch-500 flex items-center justify-center shadow-md">
          <Ribbon className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col leading-tight">
          <h1 className="font-serif font-bold text-sienna-700 text-[15px]">绣意小本</h1>
          <span className="text-[10px] text-sienna-400 truncate max-w-[140px]">{schemeName}</span>
        </div>
      </div>

      <div className="h-7 w-px bg-linen-300 mx-1" />

      <div className="flex items-center gap-1 bg-linen-100 rounded-lg p-1 border border-linen-300">
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.shortcut})`}
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                tool === t.id
                  ? "bg-white shadow-sm text-stitch-500"
                  : "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
              )}
            >
              <Icon className="w-4 h-4" strokeWidth={2} />
            </button>
          );
        })}
      </div>

      {tool === "select" && (
        <>
          <div className="h-7 w-px bg-linen-300 mx-1" />
          <div className="flex items-center gap-1 bg-linen-100 rounded-lg p-1 border border-linen-300">
            <button
              onClick={selectionCopy}
              disabled={selectionRects.length === 0}
              title="复制选区 (Ctrl+C)"
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                selectionRects.length > 0
                  ? "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
                  : "text-linen-400 cursor-not-allowed"
              )}
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const s = useCanvasStore.getState();
                if (s.selectionClipboard) {
                  s.setSelectionActionMode("pasting");
                  s.setSelectionGhostOffset(s.hoveredCell || { col: 0, row: 0 });
                }
              }}
              disabled={!selectionClipboard}
              title="粘贴 (Ctrl+V)"
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                selectionClipboard
                  ? "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
                  : "text-linen-400 cursor-not-allowed"
              )}
            >
              <ClipboardPaste className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-linen-300 mx-0.5" />
            <button
              onClick={() => selectionRotate(true)}
              disabled={selectionRects.length === 0}
              title="顺时针旋转 90° (R)"
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                selectionRects.length > 0
                  ? "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
                  : "text-linen-400 cursor-not-allowed"
              )}
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => selectionRotate(false)}
              disabled={selectionRects.length === 0}
              title="逆时针旋转 90° (Shift+R)"
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                selectionRects.length > 0
                  ? "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
                  : "text-linen-400 cursor-not-allowed"
              )}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-linen-300 mx-0.5" />
            <button
              onClick={() => selectionFlip(true)}
              disabled={selectionRects.length === 0}
              title="水平翻转 (H)"
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                selectionRects.length > 0
                  ? "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
                  : "text-linen-400 cursor-not-allowed"
              )}
            >
              <FlipHorizontal className="w-4 h-4" />
            </button>
            <button
              onClick={() => selectionFlip(false)}
              disabled={selectionRects.length === 0}
              title="垂直翻转 (F)"
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                selectionRects.length > 0
                  ? "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
                  : "text-linen-400 cursor-not-allowed"
              )}
            >
              <FlipVertical className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-linen-300 mx-0.5" />
            <button
              onClick={clearSelection}
              disabled={selectionRects.length === 0}
              title="取消选区 (Esc)"
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                selectionRects.length > 0
                  ? "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
                  : "text-linen-400 cursor-not-allowed"
              )}
            >
              <Move className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSelectionClearOnToolSwitch(!selectionClearOnToolSwitch)}
              title={selectionClearOnToolSwitch ? "切换工具时清除选区" : "切换工具时保留选区"}
              className={clsx(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                selectionClearOnToolSwitch
                  ? "text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
                  : "text-stitch-500 bg-linen-200/60"
              )}
            >
              {selectionClearOnToolSwitch ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            </button>
          </div>
        </>
      )}

      <div className="h-7 w-px bg-linen-300 mx-1" />

      <button
        onClick={undo}
        disabled={undos === 0}
        title="撤销 (Ctrl+Z)"
        className="stitch-btn !w-8 !h-8 !p-0 flex items-center justify-center"
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <button
        onClick={redo}
        disabled={redos === 0}
        title="重做 (Ctrl+Y)"
        className="stitch-btn !w-8 !h-8 !p-0 flex items-center justify-center"
      >
        <Redo2 className="w-4 h-4" />
      </button>
      <button
        onClick={clearAll}
        title="清空画布"
        className="stitch-btn !w-8 !h-8 !p-0 flex items-center justify-center text-stitch-500 hover:text-stitch-600"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="h-7 w-px bg-linen-300 mx-1" />

      <div className="flex items-center gap-1 bg-linen-100 rounded-lg p-1 border border-linen-300">
        <button
          onClick={() => handleZoom(0.8)}
          title="缩小"
          className="w-8 h-8 rounded-md flex items-center justify-center text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="w-14 text-center text-xs font-medium text-sienna-600 tabular-nums">
          {Math.round(viewport.scale * 10)}%
        </span>
        <button
          onClick={() => handleZoom(1.25)}
          title="放大"
          className="w-8 h-8 rounded-md flex items-center justify-center text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-linen-300 mx-0.5" />
        <button
          onClick={() => {
            const canvasEl = document.querySelector<HTMLCanvasElement>(".stitch-canvas-target canvas");
            if (!canvasEl) {
              fitViewport(window.innerWidth - 380, window.innerHeight - 160);
            } else {
              const parent = canvasEl.closest(".stitch-canvas-target") as HTMLElement;
              if (parent) {
                fitViewport(parent.clientWidth, parent.clientHeight);
              } else {
                fitViewport(window.innerWidth - 380, window.innerHeight - 160);
              }
            }
          }}
          title="适合窗口"
          className="w-8 h-8 rounded-md flex items-center justify-center text-sienna-500 hover:text-sienna-700 hover:bg-linen-200/60"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      <div className="h-7 w-px bg-linen-300 mx-1" />

      <button
        onClick={() => setShowStitch(!showStitch)}
        title={showStitch ? "隐藏针脚标记" : "显示针脚标记"}
        className={clsx(
          "stitch-btn !h-8 !px-2 !py-0 flex items-center gap-1 text-xs",
          showStitch && "bg-sienna-100 border-sienna-300 text-sienna-700"
        )}
      >
        <Grid3X3 className="w-3.5 h-3.5" />
        <span>X</span>
      </button>

      <button
        onClick={onResize}
        title="修改网格尺寸"
        className="stitch-btn !h-8 !px-2 !py-0 flex items-center gap-1 text-xs"
      >
        <Grid3X3 className="w-3.5 h-3.5" />
        <span className="tabular-nums">
          {useCanvasStore.getState().cols}×{useCanvasStore.getState().rows}
        </span>
      </button>

      {selectedColor && (
        <div className="flex items-center gap-2 ml-2 px-3 py-1 bg-linen-100 border border-linen-300 rounded-lg">
          <div
            className="w-6 h-6 rounded shadow-stitch-in border border-linen-300 shrink-0"
            style={{ backgroundColor: selectedColor.hexColor }}
          />
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-medium text-sienna-700">
              {selectedColor.brand} {selectedColor.code}
            </span>
            <span className="text-[10px] text-sienna-400">{selectedColor.hexColor.toUpperCase()}</span>
          </div>
        </div>
      )}

      <div className="flex-1" />

      <button
        onClick={onSave}
        className="stitch-btn-primary !h-9 !px-4 flex items-center gap-1.5"
      >
        <Save className="w-4 h-4" />
        <span>{saving ? "保存中..." : "保存方案"}</span>
      </button>
    </header>
  );
}
