import type { ResultColumn } from "@savia/crm-shared/request-page";

export function resultHtmlExample(_columns: ResultColumn[]): string {
  return `<!doctype html>
<html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font:14px system-ui;color:#20212a;background:#fff}*{box-sizing:border-box}
header{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}h2{margin:0 0 8px}p{color:#595963}
input,button{font:inherit;padding:10px;border:1px solid #ddd;border-radius:8px;background:white;color:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:16px}
article{padding:20px;border:1px solid #ddd;border-radius:12px;display:flex;flex-direction:column;gap:12px}h3{margin:0}dl{margin:0;display:grid;gap:14px}dt{font-size:12px;color:#595963}dd{margin:4px 0;overflow-wrap:anywhere}.amount{font-size:28px;font-weight:700;color:#be0037}.error{color:#a00020}
footer{display:grid;gap:12px;margin-top:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto}section{margin-top:28px}.comparison{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left}td,th{padding:14px;border-bottom:1px solid #ddd;min-width:150px}thead{background:#f5f3f8}
</style></head><body>
<header><div><h2 data-message="explore"></h2><p id="count"></p></div><label><span data-message="search"></span> <input id="search" type="search"></label></header>
<div class="cards" id="cards"></div>
<section><h2 data-message="comparison"></h2><p data-message="hint"></p><div class="comparison" id="comparison"></div></section>
<script>
// Translation values are plain text; use textContent when inserting into the DOM.
const messages={explore:["Explorar resultados","Explore results","Explorar resultados"],search:["Buscar resultados","Search results","Buscar resultados"],comparison:["Comparación de resultados","Result comparison","Comparação de resultados"],hint:["Marca dos o más resultados para compararlos.","Select two or more results to compare.","Selecione dois ou mais resultados para comparar."],results:["resultados","results","resultados"],simulation:["Simulación · ","Simulation · ","Simulação · "],compare:["Comparar","Compare","Comparar"],load:["Cargar datos","Load data","Carregar dados"],response:["Ver respuesta","View response","Ver resposta"],empty:["No hay resultados para esta búsqueda.","No results match this search.","Nenhum resultado para esta busca."],detail:["Detalle","Detail","Detalhe"]};
const text=key=>savia.t(messages,key);
const {rows,columns}=window.savia, selected=new Set();
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
function draw(){
 document.documentElement.lang=savia.locale;
 document.querySelectorAll("[data-message]").forEach(node=>node.textContent=text(node.dataset.message));
 const visible=rows.filter(row=>[row.title,...row.values].join(' ').toLowerCase().includes(document.querySelector('#search').value.toLowerCase()));
 document.querySelector('#count').textContent=visible.length+' '+text('results');
 const cards=document.querySelector('#cards');cards.replaceChildren();
 visible.forEach(row=>{
  const card=el('article');card.append(el('small',(row.simulation?text('simulation'):'')+row.status),el('h3',row.title));
  const list=el('dl');columns.forEach((column,i)=>{const value=el('dd',row.values[i]);if(column.format==='money')value.className='amount';list.append(el('dt',column.label),value)});card.append(list);
  row.errors.forEach(error=>{const p=el('p',error);p.className='error';card.append(p)});
  const footer=el('footer'),label=el('label'),check=el('input');check.type='checkbox';check.checked=selected.has(row.id);check.onchange=()=>{check.checked?selected.add(row.id):selected.delete(row.id);compare()};label.append(check,document.createTextNode(' '+text('compare')));footer.append(label);
  const load=el('button',text('load'));load.disabled=savia.disabled;load.onclick=()=>savia.load(row.id);footer.append(load);
  const detail=el('details');detail.append(el('summary',text('response')),el('pre',JSON.stringify(row.response,null,2)));footer.append(detail);card.append(footer);cards.append(card);
 });if(!visible.length)cards.append(el('p',text('empty')));compare();
}
function compare(){const target=document.querySelector('#comparison');target.replaceChildren();const items=rows.filter(row=>selected.has(row.id));if(items.length<2)return;const table=el('table'),head=el('thead'),heading=el('tr');heading.append(el('th',text('detail')));items.forEach(row=>heading.append(el('th',row.title)));head.append(heading);table.append(head);const body=el('tbody');columns.forEach((column,i)=>{const tr=el('tr');tr.append(el('th',column.label));items.forEach(row=>tr.append(el('td',row.values[i])));body.append(tr)});table.append(body);target.append(table)}
window.addEventListener('savia-locale-change',draw);
document.querySelector('#search').oninput=draw;draw();
</script></body></html>`;
}
