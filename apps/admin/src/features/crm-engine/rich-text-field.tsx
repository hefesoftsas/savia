import { useRef, useState } from "react";
import type { IFieldProps } from "@form-eng/core";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function RichTextValue({ value }: { value: unknown }) {
  return (
    <div className="space-y-2 break-words [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_blockquote]:border-l [&_blockquote]:pl-3">
      <ReactMarkdown
        skipHtml
        allowedElements={[
          "p",
          "strong",
          "em",
          "ul",
          "ol",
          "li",
          "a",
          "br",
          "blockquote",
          "code",
        ]}
        unwrapDisallowed
        components={{
          a: ({ href, children }) =>
            href && /^(https?:|mailto:)/i.test(href) ? (
              <a
                href={href}
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {String(value ?? "")}
      </ReactMarkdown>
    </div>
  );
}
export function RichTextField(props: IFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const value = typeof props.value === "string" ? props.value : "";
  const id = String(props.config?.inputId ?? props.fieldName);
  function format(before: string, after = before) {
    if (props.readOnly) return;
    const start = ref.current?.selectionStart ?? value.length;
    const end = ref.current?.selectionEnd ?? start;
    props.setFieldValue?.(
      props.fieldName!,
      value.slice(0, start) +
        before +
        value.slice(start, end) +
        after +
        value.slice(end),
    );
    ref.current?.focus();
  }
  if (props.readOnly) return <RichTextValue value={value} />;
  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label="Text formatting"
        className="flex flex-wrap gap-1"
      >
        {(
          [
            ["Bold", "**", "**"],
            ["Italic", "*", "*"],
            ["Bullet list", "\n- ", ""],
            ["Numbered list", "\n1. ", ""],
            ["Link", "[", "](https://)"],
          ] as const
        ).map(([label, before, after]) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="sm"
            disabled={preview}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(before, after)}
          >
            {label}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Edit" : "Preview"}
        </Button>
      </div>
      {preview ? (
        <RichTextValue value={value} />
      ) : (
        <Textarea
          ref={ref}
          id={id}
          name={props.fieldName}
          aria-labelledby={`${id}_label`}
          aria-describedby={`${id}_help`}
          aria-invalid={!!props.error}
          aria-required={props.required}
          required={props.required}
          rows={6}
          maxLength={Number(props.config?.maxLength ?? 100000)}
          value={value}
          onChange={(event) =>
            props.setFieldValue?.(props.fieldName!, event.target.value)
          }
        />
      )}
      <p id={`${id}_help`} className="text-sm text-muted-foreground">
        Use the formatting buttons or Markdown. Preview shows the formatted
        text.
      </p>
    </div>
  );
}
