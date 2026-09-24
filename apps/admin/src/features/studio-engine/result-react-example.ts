export const RESULT_REACT_EXAMPLE = `export default function Results({ rows, columns, disabled, load, locale, t }: ResultsProps) {
  const messages = {
    results: ["Resultados", "Results", "Resultados"], search: ["Buscar", "Search", "Buscar"],
    simulation: ["Simulación · ", "Simulation · ", "Simulação · "], compare: ["Comparar", "Compare", "Comparar"],
    load: ["Cargar datos", "Load data", "Carregar dados"], comparison: ["Comparación", "Comparison", "Comparação"],
    detail: ["Detalle", "Detail", "Detalhe"],
  };
  const text = (key) => t(messages, key);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const visible = rows.filter(row => [row.title, ...row.values].join(" ").toLowerCase().includes(query.toLowerCase()));
  const compared = rows.filter(row => selected.includes(row.id));
  return <main lang={locale}>
    <style>{\`body{margin:0;font:14px system-ui;color:#20212a;background:white}main{padding:8px}input,button{padding:10px;font:inherit}article{border:1px solid #ddd;border-radius:12px;padding:20px}h2{margin-top:0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:16px;margin:20px 0}dt{color:#666;font-size:12px}dd{margin:4px 0 16px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd}\`}</style>
    <h2>{text("results")} ({visible.length})</h2>
    <label>{text("search")} <input value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="cards">{visible.map(row => <article key={row.id}>
      <small>{row.simulation ? text("simulation") : ""}{row.status}</small>
      <h3>{row.title}</h3>
      <dl>{columns.map((column, i) => <React.Fragment key={i}><dt>{column.label}</dt><dd>{row.values[i]}</dd></React.Fragment>)}</dl>
      {row.errors.map((error,i) => <p role="alert" key={i}>{error}</p>)}
      <label><input type="checkbox" checked={selected.includes(row.id)} onChange={e => setSelected(current => e.target.checked ? [...current,row.id] : current.filter(id => id !== row.id))}/> {text("compare")}</label>
      <button disabled={disabled} onClick={() => load(row.id)}>{text("load")}</button>
    </article>)}</div>
    {compared.length > 1 && <section><h2>{text("comparison")}</h2><div style={{overflowX:"auto"}}><table><thead><tr><th>{text("detail")}</th>{compared.map(row => <th key={row.id}>{row.title}</th>)}</tr></thead><tbody>{columns.map((column,i) => <tr key={i}><th>{column.label}</th>{compared.map(row => <td key={row.id}>{row.values[i]}</td>)}</tr>)}</tbody></table></div></section>}
  </main>;
}`;
