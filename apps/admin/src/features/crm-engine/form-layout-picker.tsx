import "./form-layout-picker.css";

const COLUMN_LABELS: Record<1 | 2 | 3, string> = {
  1: "Una columna",
  2: "Dos columnas",
  3: "Tres columnas",
};

export function FormLayoutPreview({ columns }: { columns: 1 | 2 | 3 }) {
  return (
    <div
      aria-hidden="true"
      className="form-layout-preview"
      data-columns={columns}
      data-testid={`form-layout-preview-${columns}`}
    >
      <span className="form-layout-preview-title" />
      <div className="form-layout-preview-fields">
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function FormColumnPicker({
  value,
  onChange,
  name = "form-columns",
  className,
}: {
  value: 1 | 2 | 3;
  onChange: (columns: 1 | 2 | 3) => void;
  name?: string;
  className?: string;
}) {
  return (
    <div
      aria-label="Columnas del formulario"
      className={["form-column-picker", className].filter(Boolean).join(" ")}
      role="radiogroup"
    >
      {([1, 2, 3] as const).map((columns) => (
        <label className="form-column-option" key={columns}>
          <input
            aria-label={COLUMN_LABELS[columns]}
            checked={value === columns}
            name={name}
            onChange={() => onChange(columns)}
            type="radio"
            value={columns}
          />
          <span className="form-column-option-content">
            <span className="form-column-option-title">
              {COLUMN_LABELS[columns]}
            </span>
            <FormLayoutPreview columns={columns} />
          </span>
        </label>
      ))}
    </div>
  );
}
