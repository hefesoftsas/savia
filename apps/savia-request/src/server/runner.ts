import {lookupDaneCity} from './dane';
import type { Env } from './env';
import type { Flow, Run, Trace } from './types';
import { createRun, getVariables, persistRun } from './store';
import { scopeTenant } from './tenant';
import { hook } from './hooks';
import { responsePreview } from './response-preview';
const insuranceAutoLightFolder='06-Cotizaciones/Autos-livianos/';
export const escapeXml=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function isInsuranceAutoLightQuote(flow:Flow){
 return flow.steps[0]?.sourcePath?.startsWith(insuranceAutoLightFolder)&&flow.kind!=='lookup'&&flow.kind!=='auth';
}
function mockInsuranceQuote(flow:Flow){
 const seed=[...flow.id].reduce((total,char)=>total+char.charCodeAt(0),0);
 return {quoteNumber:`SIM-${flow.id.toUpperCase()}`,premiumTotal:String(700000+(seed%900000)),currency:'COP',product:flow.name,simulated:true,documentUrl:null};
}
function interpolate(text:string,values:Record<string,string>,encode:(value:string)=>string=(v)=>v){return text.replace(/\{\{([^}]+)\}\}/g,(_,key:string)=>{if(values[key]===undefined)throw new Error(`Falta variable: ${key}`);return encode(String(values[key]));});}
function requestBody(template:string,values:Record<string,string>,type:string){
 if(type==='xml')return interpolate(template,values,escapeXml);
 if(type==='json'){
  // Current collection uses whole JSON payloads supplied by pre-request hooks.
  // Also support string placeholders without corrupting quotes or backslashes.
  let quoted=false,escaped=false,result='';
  for(let i=0;i<template.length;i++){
   if(template.startsWith('{{',i)){const end=template.indexOf('}}',i+2);if(end<0)throw new Error('Falta variable: template incompleto');const key=template.slice(i+2,end);if(values[key]===undefined)throw new Error('Falta variable: '+key);result+=quoted?JSON.stringify(values[key]).slice(1,-1):values[key];i=end+1;continue;}
   const char=template[i];result+=char;if(escaped){escaped=false;continue;}if(char==='\\'&&quoted){escaped=true;continue;}if(char==='"')quoted=!quoted;
  }
  JSON.parse(result);return result;
 }
 return interpolate(template,values);
}
export async function execute(env:Env,flow:Flow,input:Record<string,string>,mode:'mock'|'live',versionId:string|null,tenant=''){
 const scope=scopeTenant(tenant);
 const run:Run={id:crypto.randomUUID(),flowId:flow.id,mode,versionId,status:'running',createdAt:new Date().toISOString(),steps:[],result:null};
 await createRun(env,run,scope);
 const start=Date.now();const persist=()=>persistRun(env,run,scope);
 try {
  if(flow.id==='dane-city-lookup'){
   if(mode!=='live')throw new Error('La consulta DANE usa el catálogo oficial. Selecciona modo live; es una consulta de solo lectura.');
   run.result=await lookupDaneCity(input.city,input.department||undefined);
   run.status='success';run.steps=[{name:'Consulta oficial DIVIPOLA',status:'success',durationMs:Date.now()-start,httpStatus:200,responseJson:run.result}];
   await persist();return run;
  }
  const mockProviderQuote=mode==='mock'&&isInsuranceAutoLightQuote(flow);
  const vars=await getVariables(env,flow.id,true,scope);const values:Record<string,string>=Object.create(null);const secretKeys=new Set(vars.filter(v=>v.secret).map(v=>v.key));
  // The SBS simulator accepts placeholder product settings; they are never persisted or used live.
  for(const v of vars)values[v.key]=mode==='mock'&&v.secret?'SIMULADO':mode==='mock'&&/^sbs-producto-(8|10|11)$/.test(flow.id)&&/^sbs_product_\d+_/.test(v.key)&&v.value===''?'0':v.value;
  for(const [key,value]of Object.entries(input)){
   if(!Object.hasOwn(flow.input,key))throw new Error(`Entrada no declarada: ${key}`);
   if(vars.some(v=>v.key===key))throw new Error(`La entrada no puede reemplazar configuración: ${key}`);
   values[key]=String(value);
  }
  const produced=new Set(flow.steps.flatMap(step=>[...step.post.matchAll(/bru\.setVar\(["']([^"']+)["']/g)].map(m=>m[1])));
  const referenced=new Set(flow.steps.flatMap(step=>{
   const keys=[...JSON.stringify([step.body,step.url,step.headers,step.auth]).matchAll(/\{\{([^}]+)\}\}/g)].map(m=>m[1]);
   for(const m of step.pre.matchAll(/(?:getEnvVar|getGlobalEnvVar|getVar|environmentValue|requiredInput)\(["']([^"']+)["']/g))keys.push(m[1]);return keys;
  }));
  const missing=[...referenced].filter(key=>!produced.has(key)&&(values[key]===undefined||(values[key]===''&&!key.endsWith('secondSurname'))));
  if(missing.length&&!mockProviderQuote)throw new Error('Completa las variables: '+missing.join(', '));

  const destinations=mockProviderQuote?flow.steps.map(()=>new URL('https://mock.savia.invalid')):flow.steps.map(step=>{
   const whole=step.url.match(/^\{\{([^}]+)\}\}$/);
   const url=new URL(whole?values[whole[1]]:interpolate(step.url,values,encodeURIComponent));
   // A URL stored as a whole variable is already encoded as a URL, not a path segment.
   return url;
  });
  for(let i=0;i<destinations.length;i++)if(!['https:','http:'].includes(destinations[i].protocol)||destinations[i].username||destinations[i].password||!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(flow.steps[i].method))throw new Error('URL o método inválido. Usa HTTP o HTTPS sin credenciales en la URL.');
  let latestResponse:unknown=null;
  for(let index=0;index<flow.steps.length;index++){
   const step=flow.steps[index];if(Date.now()-start>300000)throw new Error('Se agotó el tiempo total del flujo.');
   const trace:Trace={name:step.name,status:'running',durationMs:0};run.steps.push(trace);const stepStart=Date.now();
   try {
    let response:Response;
    if(mockProviderQuote)response=Response.json(mockInsuranceQuote(flow));
    else {
     const publicValues=Object.fromEntries(Object.entries(values).filter(([key])=>!secretKeys.has(key)));
     const before=await hook(env,step.pre,{body:step.body,values:publicValues});
     for(const [key,value]of Object.entries(before.variables)){if(secretKeys.has(key))throw new Error('Un hook no puede reemplazar secretos.');values[key]=value;}
     const headers=Object.fromEntries(Object.entries(step.headers).map(([key,value])=>[key,interpolate(value,values)]));
     if(step.auth){const user=interpolate(step.auth.username,values),password=interpolate(step.auth.password,values);headers.authorization='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode(user+':'+password)));}
     const contentType=Object.entries(headers).find(([k])=>k.toLowerCase()==='content-type')?.[1]??'';
     const type=contentType.includes('json')?'json':contentType.includes('xml')?'xml':step.bodyType??'xml';
     const body=['GET','HEAD'].includes(step.method)?undefined:requestBody(before.body,values,type);
     if(mode==='mock'){
     if(flow.id==='sura-autos-provider' && index===flow.steps.length-1)response=Response.json({placa:String(values.sura_test_plate??'').toUpperCase(),modelo:'2023',fasecolda:'04408010',valorAsegurado:65000000,valorAccesorios:0,simulated:true});
     else if(step.post.includes('liberty_autos_access_token'))response=Response.json({access_token:'SIMULATED-TOKEN',token_type:'Bearer',simulated:true});
     else response=Response.json({simulated:true,message:'Respuesta de demostración. No valida el contrato del proveedor.',method:step.method,requestReceived:true});
     }else response=await fetch(destinations[index],{method:step.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(30000)});
    }
    trace.httpStatus=response.status;
    const raw=await response.text();if(raw.length>2000000)throw new Error('Respuesta demasiado grande.');
    const secrets=[...vars.filter(v=>v.secret).map(v=>v.value),...Object.entries(values).filter(([key])=>/(token|session_id)/i.test(key)).map(([,v])=>v)];
    trace.responseJson=responsePreview(raw,secrets);latestResponse=trace.responseJson;
    if(!response.ok)throw new Error(`Proveedor respondió HTTP ${response.status}.`);
    if(/<(?:[\w-]+:)?Fault\b/i.test(raw))throw new Error('Proveedor devolvió un SOAP Fault. Consulta el JSON de respuesta.');
    if(!mockProviderQuote){
     const after=await hook(env,step.post,{body:step.body,values:Object.fromEntries(Object.entries(values).filter(([key])=>!secretKeys.has(key))),response:raw});
     for(const [key,value]of Object.entries(after.variables)){if(secretKeys.has(key))throw new Error('Un hook no puede reemplazar secretos.');values[key]=value;}
     trace.extracted=Object.keys(after.variables);
    }
    trace.status='success';
   }catch(error){trace.status='failed';trace.error=error instanceof Error&&/^(Proveedor |El hook|Un hook|Falta variable|Respuesta|SBS )/.test(error.message)?error.message:'No se pudo completar el paso (conexión, timeout, JSON o script).';throw new Error(trace.error);}
   finally{trace.durationMs=Date.now()-stepStart;await persist();}
  }
  const prefix=flow.resultPrefix??(flow.id==='sbs-producto-8'?'sbs_product_8':null);
  if(mockProviderQuote)run.result=mockInsuranceQuote(flow);
  else if(prefix){const quote=values[prefix+'_quote_number'],premium=values[prefix+'_premium_total'];if(!quote||!premium)throw new Error('La respuesta no contiene número de cotización y prima.');run.result={quoteNumber:quote,premiumTotal:premium,currency:'COP',simulated:mode==='mock',documentUrl:null};}
  else run.result={simulated:mode==='mock',response:latestResponse,note:flow.kind==='auth'?'Token obtenido; oculto en la respuesta.':'Requests completados. Revisa en la respuesta JSON si el proveedor aceptó la operación.'};
  run.status='success';
 }catch(error){run.status='failed';run.error=error instanceof Error?error.message:'Falló la ejecución.';}
 await persist();return run;
}
