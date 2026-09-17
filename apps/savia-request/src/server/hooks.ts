import type { Env } from './env';
// Minimal Bruno surface used by the four reference requests. No imports, bindings or network.
export async function hook(env:Env,code:string,payload:{body:string;values:Record<string,string>;response?:string}){
 if(!code.trim())return {body:payload.body,variables:{} as Record<string,string>};
 const module=`export default { async fetch(request) {
 const data=await request.json(); let body=data.body; const variables=Object.create(null);
 const console={log(){},warn(){},error(){},info(){},debug(){}};
 const bru={getEnvVar:(key)=>data.values[key],getGlobalEnvVar:(key)=>data.values[key],getVar:(key)=>variables[key]??data.values[key],setVar:(key,value)=>{variables[key]=String(value)}};
 const req={getBody:()=>body,setBody:(value)=>{body=String(value)}};
 const res={getBody:()=>data.response??''};
 try { await (async()=>{\n${code}\n})(); return Response.json({body,variables}); }
 catch {return Response.json({error:'El hook rechazó los datos o la respuesta. Revisa los campos y el script.'},{status:422});}
 }};`;
 const worker=env.LOADER.load({compatibilityDate:'2026-09-04',mainModule:'hook.js',modules:{'hook.js':module},globalOutbound:null,limits:{cpuMs:100,subRequests:0}});
 const response=await worker.getEntrypoint().fetch(new Request('https://hook.local/',{method:'POST',body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)}));
 const result=await response.json() as {body:string;variables:Record<string,string>;error?:string};
 if(!response.ok||result.error)throw new Error(result.error||'Falló el hook.');
 if(typeof result.body!=='string'||!result.variables||typeof result.variables!=='object')throw new Error('Salida del hook inválida.');
 return result;
}
