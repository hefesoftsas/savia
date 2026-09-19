import { inputHint } from './input-hints';
import type { Env } from './env';
import type { Flow } from './types';
import {getFlow,seedOnce} from './store';
type Schema=Record<string,unknown>;
function shape(value:unknown):Schema {
 if(value===null)return {type:'null'};
 if(Array.isArray(value))return {type:'array',items:value.length?shape(value[0]):{}};
 if(typeof value==='object')return {type:'object',properties:Object.fromEntries(Object.entries(value as object).map(([k,v])=>[k,shape(v)]))};
 return {type:typeof value==='number'?'number':typeof value==='boolean'?'boolean':'string'};
}
function inputs(flow:Flow):Schema {return {type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(flow.input).map(([key,value])=>{
 let schema:Schema={type:'string',examples:[value]};
 if(key.endsWith('_request_body')){try{schema={...schema,description:'Objeto JSON serializado como texto. La estructura interna se muestra en contentSchema.',contentMediaType:'application/json',contentSchema:shape(JSON.parse(value))}}catch{}}
 return [key,{...schema,...inputHint(key)}];
}))}}
export async function openApi(env:Env){
 await seedOnce(env);const rows=await env.DB.prepare('SELECT id FROM flows').all<{id:string}>();
 const paths:Record<string,unknown>={},schemas:Record<string,unknown>={
 Trace:{type:'object',properties:{name:{type:'string'},status:{type:'string'},httpStatus:{type:'integer'},durationMs:{type:'number'},responseJson:{description:'JSON original o XML convertido. Credenciales y sesiones ocultas.'},extracted:{type:'array',items:{type:'string'}},error:{type:'string'}}},
 Run:{type:'object',properties:{id:{type:'string'},flowId:{type:'string'},versionId:{type:['string','null']},mode:{type:'string',enum:['mock','live']},status:{type:'string',enum:['success','failed','running']},createdAt:{type:'string',format:'date-time'},steps:{type:'array',items:{$ref:'#/components/schemas/Trace'}},result:{type:['object','null'],additionalProperties:true,description:'Resultado del flow. Prima en COP cuando el proveedor la entrega; no todos los flows cotizan.'},error:{type:'string'}}}
 };
 const response={description:'Revisa status y responseJson: HTTP 200 no garantiza una cotización aceptada.',content:{'application/json':{schema:{$ref:'#/components/schemas/Run'}}}};
 for(const row of rows.results){const flow=await getFlow(env,row.id);if(!flow)continue;
 const tag=flow.provider??flow.folderPath?.split('/').filter(Boolean).at(-1)??'Requests';const key='Input_'+flow.id;schemas[key]=inputs(flow);
 // Expose nested JSON structures independently too, since the execution API accepts strings.
 for(const [name,value] of Object.entries(flow.input))if(name.endsWith('_request_body'))try{schemas[key+'_'+name]=shape(JSON.parse(value))}catch{}
 const description=flow.id==='dane-city-lookup'?'Consulta de solo lectura al catálogo oficial DIVIPOLA. Envía mode live, input.city y opcionalmente input.department. Retorna status matched, ambiguous o not_found, códigos de cinco dígitos y la fuente. No crea cotizaciones ni contacta aseguradoras. El servicio integrado valida y resuelve las ciudades sin ejecutar scripts configurables.':`Una sola llamada ejecuta el flow completo de ${flow.name} (${flow.steps.length} pasos internos). Los ejemplos contienen la entrada real guardada en Savia request; puedes editarla antes de enviar. Las credenciales configuradas como variables se resuelven en el servidor. mock simula el resultado; live contacta al proveedor y puede crear una cotización.`;
 const body={required:true,content:{'application/json':{examples:{...(flow.id==='dane-city-lookup'?{}:{simulado:{summary:'Datos guardados · simulación',value:{mode:'mock',input:flow.input}}}),real:{summary:'Datos guardados · llamada real al proveedor',value:{mode:'live',input:flow.input}}},schema:{type:'object',required:['mode','input'],properties:{mode:{type:'string',enum:flow.id==='dane-city-lookup'?['live']:['mock','live'],default:flow.id==='dane-city-lookup'?'live':'mock'},input:{$ref:'#/components/schemas/'+key}}}}}};
 paths['/api/flows/'+flow.id+'/runs']={post:{tags:[tag],operationId:'execute_'+flow.id,summary:flow.name,'x-savia-kind':flow.kind??'request',...(flow.input.sura_test_plate!==undefined?{'x-savia-action-label':'Consultar placa'}:{}),description,requestBody:body,responses:{'200':response}}};

 }
 paths['/api/lookups/dane']={get:{tags:['DANE'],operationId:'lookupDaneCity',summary:'Código DANE por ciudad',description:'Consulta de referencia oficial, sin crear cotizaciones. Si hay varios municipios devuelve opciones con departamento.',parameters:[{in:'query',name:'city',required:true,schema:{type:'string',minLength:2,maxLength:100}},{in:'query',name:'department',schema:{type:'string',maxLength:100}}],responses:{'200':{description:'Estado de coincidencia, municipios, códigos de cinco dígitos y fuente oficial.'},'502':{description:'La fuente oficial no está disponible; no se inventan códigos.'}}}};
 return {openapi:'3.1.0',info:{title:'Savia request · API',version:'0.2.0',description:'Documentación de administración de Savia request. Una operación por flow, agrupada por proveedor, con su entrada y respuesta. Los pasos internos se ejecutan juntos. Las estructuras y los ejemplos se generan del borrador guardado. El ejemplo de simulación usa esos mismos datos sin contactar al proveedor; el ejemplo real envía una llamada al proveedor.'},servers:[{url:'/v1/savia-request'}],tags:[...new Set(Object.values(paths).map((item:any)=>(item.post??item.get).tags[0] as string))].sort().map(name=>({name,description:name==='Sura'?'Consulta de vehículo por placa. Envía la placa en input.':undefined})),paths,components:{schemas}};
}
