<script context="module" lang="ts">
  export interface DiffWordDecoration {
    startCol: number;
    endCol: number;
    type: "added" | "removed";
  }

  export interface DiffLineDecoration {
    lineNumber: number;
    type: "added" | "removed" | "modified" | "unchanged";
    words?: DiffWordDecoration[];
  }

  export interface DiffLinePaddingDecoration {
    lineNumber: number;
    paddingPx: number;
  }

  export interface DiffGapDecoration {
    afterLineNumber: number;
    gapPx: number;
  }

  export interface DiffDecorationConfig {
    lines: DiffLineDecoration[];
    paddings?: DiffLinePaddingDecoration[];
    gaps: DiffGapDecoration[];
  }

  export interface ScrollInfo {
    scrollTop: number;
    scrollLeft: number;
    lineNo: number | null;
    lineTop: number;
    lineHeight: number;
    ratio: number;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { EditorView, keymap, drawSelection, lineNumbers, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
  import { EditorState, Compartment, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";

  export let value: string = "";
  export let rows: number = 8;
  export let readonly: boolean = false;
  export let diffDecorations: DiffDecorationConfig | null = null;

  const dispatch = createEventDispatcher<{
    change: string;
    scroll: { scrollTop: number; scrollLeft: number };
  }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let isInternalUpdate = false;
  let isSyncingScroll = false;
  let handleScrollListener: (() => void) | null = null;
  const editableCompartment = new Compartment();

  export function setScroll(scrollTop: number, scrollLeft: number) {
    if (!view || !view.scrollDOM) return;
    const dom = view.scrollDOM;
    if (Math.abs(dom.scrollTop - scrollTop) > 0.5 || Math.abs(dom.scrollLeft - scrollLeft) > 0.5) {
      isSyncingScroll = true;
      dom.scrollTop = scrollTop;
      dom.scrollLeft = scrollLeft;
      requestAnimationFrame(() => {
        isSyncingScroll = false;
      });
    }
  }

  export function getScroll(): { scrollTop: number; scrollLeft: number } {
    if (!view || !view.scrollDOM) return { scrollTop: 0, scrollLeft: 0 };
    return {
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft
    };
  }

  export function getScrollInfo(): ScrollInfo {
    if (!view || !view.scrollDOM) {
      return { scrollTop: 0, scrollLeft: 0, lineNo: null, lineTop: 0, lineHeight: 1, ratio: 0 };
    }
    const dom = view.scrollDOM;
    const scrollTop = dom.scrollTop;
    const scrollLeft = dom.scrollLeft;

    try {
      const block = view.lineBlockAtHeight(scrollTop);
      const lineNo = view.state.doc.lineAt(block.from).number;
      const lineTop = block.top;
      const lineHeight = Math.max(block.height, 1);
      const ratio = Math.max(0, Math.min(1, (scrollTop - lineTop) / lineHeight));
      return { scrollTop, scrollLeft, lineNo, lineTop, lineHeight, ratio };
    } catch {
      return { scrollTop, scrollLeft, lineNo: null, lineTop: 0, lineHeight: 1, ratio: 0 };
    }
  }

  export function scrollToLine(lineNo: number, ratio: number, scrollLeft?: number) {
    if (!view || !view.scrollDOM) return;
    try {
      const doc = view.state.doc;
      const clampedLine = Math.max(1, Math.min(lineNo, doc.lines));
      const lineObj = doc.line(clampedLine);
      const block = view.lineBlockAt(lineObj.from);
      const targetTop = block.top + ratio * block.height;
      setScroll(targetTop, scrollLeft ?? view.scrollDOM.scrollLeft);
    } catch {
      setScroll(0, scrollLeft ?? view.scrollDOM.scrollLeft);
    }
  }

  export function getLineHeights(): Map<number, number> {
    const heights = new Map<number, number>();
    if (!view) return heights;
    const doc = view.state.doc;
    for (let l = 1; l <= doc.lines; l++) {
      try {
        const lineObj = doc.line(l);
        const block = view.lineBlockAt(lineObj.from);
        heights.set(l, block.height);
      } catch {
        // Fallback
      }
    }
    return heights;
  }

  class LinePaddingWidget extends WidgetType {
    constructor(public heightPx: number) {
      super();
    }

    toDOM() {
      const div = document.createElement("div");
      div.className = "cm-diff-line-padding";
      div.style.height = `${this.heightPx}px`;
      return div;
    }

    eq(other: LinePaddingWidget) {
      return Math.abs(other.heightPx - this.heightPx) < 0.5;
    }
  }

  class GapSpacerWidget extends WidgetType {
    constructor(public heightPx: number) {
      super();
    }

    toDOM() {
      const div = document.createElement("div");
      div.className = "cm-diff-gap-spacer";
      div.style.height = `${this.heightPx}px`;
      return div;
    }

    eq(other: GapSpacerWidget) {
      return Math.abs(other.heightPx - this.heightPx) < 0.5;
    }
  }

  const setDiffDecorationsEffect = StateEffect.define<DecorationSet>();

  const diffDecorationsField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decorations, tr) {
      decorations = decorations.map(tr.changes);
      for (const effect of tr.effects) {
        if (effect.is(setDiffDecorationsEffect)) {
          decorations = effect.value;
        }
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f)
  });

  const latexHighlightStyle = HighlightStyle.define([
    { tag: t.comment, color: "#94a3b8", fontStyle: "italic" },
    { tag: t.keyword, color: "#ec4899", fontWeight: "bold" },
    { tag: t.macroName, color: "#38bdf8", fontWeight: "600" },
    { tag: t.bracket, color: "#f59e0b" },
    { tag: t.string, color: "#a855f7" },
    { tag: t.number, color: "#10b981" }
  ]);

  const latexTheme = EditorView.theme(
    {
      "&": {
        backgroundColor: "#0f172a",
        color: "#e2e8f0",
        borderRadius: "0.375rem",
        border: "1px solid #334155",
        fontSize: "0.875rem",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
      },
      "&.cm-focused": {
        outline: "2px solid #38bdf8",
        outlineOffset: "-1px"
      },
      ".cm-content": {
        caretColor: "#38bdf8",
        padding: "0 12px"
      },
      ".cm-line": {
        padding: "0",
        lineHeight: "1.5rem"
      },
      ".cm-gutters": {
        backgroundColor: "#0f172a",
        color: "#64748b",
        borderRight: "1px solid #334155",
        borderRadius: "0.375rem 0 0 0.375rem"
      },
      ".cm-gutterElement": {
        padding: "0 8px 0 12px"
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "#f1f5f9"
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "#38bdf8"
      },
      "&.cm-editor": {
        height: "100%"
      },
      ".cm-scroller": {
        overflow: "auto"
      }
    },
    { dark: true }
  );

  onMount(() => {
    const minHeight = `${Math.max(rows, 3) * 1.5}rem`;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        EditorView.lineWrapping,
        history(),
        drawSelection(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        StreamLanguage.define({
          token(stream) {
            if (stream.match(/^%.*/)) return "comment";
            if (stream.match(/^\\(?:begin|end)\b/)) return "keyword";
            if (stream.match(/^\\[a-zA-Z]+/)) return "macroName";
            if (stream.match(/^\\./)) return "macroName";
            if (stream.match(/^[{}[\]]/)) return "bracket";
            if (stream.match(/^\$+/)) return "string";
            if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
            stream.next();
            return null;
          }
        }),
        syntaxHighlighting(latexHighlightStyle),
        latexTheme,
        diffDecorationsField,
        editableCompartment.of(EditorView.editable.of(!readonly)),
        EditorView.theme({
          "&": { minHeight },
          ".cm-scroller": { minHeight }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            isInternalUpdate = true;
            value = update.state.doc.toString();
            dispatch("change", value);
            isInternalUpdate = false;
          }
        })
      ]
    });

    view = new EditorView({
      state,
      parent: container
    });

    const scrollDOM = view.scrollDOM;
    handleScrollListener = () => {
      if (isSyncingScroll) return;
      dispatch("scroll", {
        scrollTop: scrollDOM.scrollTop,
        scrollLeft: scrollDOM.scrollLeft
      });
    };
    scrollDOM.addEventListener("scroll", handleScrollListener, { passive: true });
  });

  function applyDiffDecorations(
    editorView: EditorView,
    config: DiffDecorationConfig | null
  ) {
    if (!editorView) return;
    if (!config) {
      editorView.dispatch({
        effects: setDiffDecorationsEffect.of(Decoration.none)
      });
      return;
    }

    const doc = editorView.state.doc;
    const totalLines = doc.lines;
    const builder = new RangeSetBuilder<Decoration>();

    const lineDecoMap = new Map<number, DiffLineDecoration>();
    for (const lineDeco of config.lines) {
      lineDecoMap.set(lineDeco.lineNumber, lineDeco);
    }

    const paddingMap = new Map<number, number>();
    if (config.paddings) {
      for (const pDeco of config.paddings) {
        paddingMap.set(pDeco.lineNumber, pDeco.paddingPx);
      }
    }

    const gapMap = new Map<number, number>();
    for (const gapDeco of config.gaps) {
      gapMap.set(gapDeco.afterLineNumber, gapDeco.gapPx);
    }

    if (gapMap.has(0)) {
      const gapPx = gapMap.get(0)!;
      if (gapPx > 0 && totalLines >= 1) {
        const line1 = doc.line(1);
        builder.add(
          line1.from,
          line1.from,
          Decoration.widget({
            widget: new GapSpacerWidget(gapPx),
            side: -1,
            block: true
          })
        );
      }
    }

    for (let l = 1; l <= totalLines; l++) {
      const lineObj = doc.line(l);
      const lineDeco = lineDecoMap.get(l);

      if (lineDeco && lineDeco.type !== "unchanged") {
        builder.add(
          lineObj.from,
          lineObj.from,
          Decoration.line({
            attributes: { class: `cm-diff-line-${lineDeco.type}` }
          })
        );

        if (lineDeco.words && lineDeco.words.length > 0) {
          for (const w of lineDeco.words) {
            const fromPos = Math.min(lineObj.from + w.startCol, lineObj.to);
            const toPos = Math.min(lineObj.from + w.endCol, lineObj.to);
            if (fromPos < toPos) {
              builder.add(
                fromPos,
                toPos,
                Decoration.mark({
                  class: `cm-diff-word-${w.type}`
                })
              );
            }
          }
        }
      }

      if (paddingMap.has(l)) {
        const pPx = paddingMap.get(l)!;
        if (pPx > 0) {
          builder.add(
            lineObj.to,
            lineObj.to,
            Decoration.widget({
              widget: new LinePaddingWidget(pPx),
              side: 1,
              block: true
            })
          );
        }
      }

      if (gapMap.has(l)) {
        const gapPx = gapMap.get(l)!;
        if (gapPx > 0) {
          builder.add(
            lineObj.to,
            lineObj.to,
            Decoration.widget({
              widget: new GapSpacerWidget(gapPx),
              side: 1,
              block: true
            })
          );
        }
      }
    }

    editorView.dispatch({
      effects: setDiffDecorationsEffect.of(builder.finish())
    });
  }

  $: if (view) {
    applyDiffDecorations(view, diffDecorations);
  }

  $: if (view && !isInternalUpdate) {
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value }
      });
    }
  }

  $: if (view) {
    view.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!readonly))
    });
  }

  onDestroy(() => {
    if (view) {
      if (handleScrollListener && view.scrollDOM) {
        view.scrollDOM.removeEventListener("scroll", handleScrollListener);
      }
      view.destroy();
    }
  });
</script>

<div class="latex-editor-wrapper" bind:this={container}></div>

<style>
  .latex-editor-wrapper {
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  :global(.cm-diff-line-added) {
    background-color: rgba(16, 185, 129, 0.15) !important;
  }
  :global(.cm-diff-line-removed) {
    background-color: rgba(239, 68, 68, 0.15) !important;
  }
  :global(.cm-diff-line-modified) {
    background-color: rgba(245, 158, 11, 0.15) !important;
  }
  :global(.cm-diff-word-added) {
    background-color: rgba(16, 185, 129, 0.35);
    color: #6ee7b7;
    border-radius: 2px;
    text-decoration: underline;
  }
  :global(.cm-diff-word-removed) {
    background-color: rgba(239, 68, 68, 0.35);
    color: #fca5a5;
    border-radius: 2px;
    text-decoration: line-through;
  }
  :global(.cm-diff-line-padding) {
    display: block;
    box-sizing: border-box;
    background: transparent;
  }
  :global(.cm-diff-gap-spacer) {
    background-color: rgba(15, 23, 42, 0.6);
    background-image: repeating-linear-gradient(
      45deg,
      #1e293b 0,
      #1e293b 8px,
      #0f172a 8px,
      #0f172a 16px
    );
    border-top: 1px dashed #334155;
    border-bottom: 1px dashed #334155;
    display: block;
    box-sizing: border-box;
  }
</style>
