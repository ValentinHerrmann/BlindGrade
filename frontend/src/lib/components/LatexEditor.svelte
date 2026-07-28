<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { EditorView, keymap, drawSelection } from "@codemirror/view";
  import { EditorState, Compartment } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";

  export let value: string = "";
  export let rows: number = 8;
  export let readonly: boolean = false;

  const dispatch = createEventDispatcher<{ change: string }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let isInternalUpdate = false;
  const editableCompartment = new Compartment();

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
        padding: "8px 12px"
      },
      ".cm-line": {
        padding: "0"
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
  });

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
</style>
