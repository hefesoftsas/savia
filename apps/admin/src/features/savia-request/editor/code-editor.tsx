import { useContext, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import { XMLValidator } from "fast-xml-parser";
import xmlFormat from "xml-formatter";
import { Button } from "@/components/ui/button";
import { VariableNames, variableCompletion } from "./variable-completion";

type CodeEditorProps = {
  value: string;
  onChange(value: string): void;
  language?: "json" | "xml" | "javascript" | "text";
  label: string;
  height?: string;
};

export function CodeEditor({
  value,
  onChange,
  language = "json",
  label,
  height = "22rem",
}: CodeEditorProps) {
  const names = useContext(VariableNames);
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const [error, setError] = useState("");
  const completion = useMemo(
    () => autocompletion({ override: [variableCompletion(names)] }),
    [names],
  );
  const extension = useMemo(() => {
    const languageExtension =
      language === "xml"
        ? xml()
        : language === "javascript"
          ? javascript()
          : json();
    return [
      languageExtension,
      completion,
      EditorView.contentAttributes.of({ "aria-label": label }),
      EditorView.lineWrapping,
    ];
  }, [completion, label, language]);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const format = () => {
    try {
      let next = value;
      if (language === "json")
        next = JSON.stringify(JSON.parse(value), null, 2);
      if (language === "xml") {
        const valid = XMLValidator.validate(value);
        if (valid !== true) throw new Error(valid.err.msg);
        next = xmlFormat(value, {
          indentation: "  ",
          collapseContent: true,
          lineSeparator: "\n",
        });
      }
      onChange(next);
      setError("");
    } catch (exception) {
      setError(
        exception instanceof Error ? exception.message : "Formato inválido.",
      );
    }
  };

  return (
    <section className="overflow-hidden rounded-md border bg-card">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label} · {language.toUpperCase()}
        </span>
        {language === "json" || language === "xml" ? (
          <Button onClick={format} size="sm" type="button" variant="outline">
            Formatear
          </Button>
        ) : null}
      </div>
      <CodeMirror
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          autocompletion: true,
        }}
        extensions={extension}
        height={height}
        onChange={onChange}
        theme={dark ? "dark" : "light"}
        value={value}
      />
      {error ? (
        <p className="border-t px-3 py-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
