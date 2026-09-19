import type {RecordRelationGroup} from '@savia/crm-shared/relations';
import type {LocalStore} from './store';
import type {SyncTransport} from './contracts';
import {isOfflineError} from '@/offline/offline-error';

/** Complete relation snapshots only; absence is unavailable, never an empty selection. */
export async function localRecordLinks(store:LocalStore,network:SyncTransport,path:string,init:RequestInit,collection:string,id:string):Promise<Response>{
 const blocked=await store.authorizationError();
 if(blocked)return Response.json({error:'Acceso local no disponible.'},{status:403});
 const metadata=await store.db.collections.get(collection);
 if(!metadata||metadata.capability==='remote')return network(path,init);
 const params=new URL(path,'https://local.invalid').searchParams;
 const page=Math.max(1,Number(params.get('page'))||1),perPage=Math.min(100,Math.max(1,Number(params.get('perPage'))||25));
 const cached=async():Promise<Response|undefined>=>{
  const snapshot=await store.db.linkSnapshots.get([collection,id]);
  if(!snapshot)return;
  const groups:RecordRelationGroup[]=[];
  for(const group of snapshot.groups){
   const outgoing=group.definition.sourceObject===collection;
   const target=outgoing?group.definition.targetObject:group.definition.sourceObject;
   const targetMetadata=await store.db.collections.get(target);
   if(!targetMetadata||targetMetadata.capability==='remote')return Response.json({error:'La colección relacionada ya no está disponible localmente.'},{status:403});
   const display=outgoing?group.definition.targetDisplayField:group.definition.sourceDisplayField;
   const records=await Promise.all(group.ids.slice((page-1)*perPage,page*perPage).map(async key=>{
    const document=await store.get(target,key);
    return {id:key,label:String((display?document?.[display]:undefined)??document?.name??key),...(document?{data:document}:{missing:true})};
   }));
   groups.push({definition:group.definition,direction:outgoing?'outgoing':'incoming',targetObject:target,targetLabel:targetMetadata.object.label,label:outgoing?group.definition.targetLabel:group.definition.sourceLabel,records,total:group.ids.length,canEdit:true});
  }
  return Response.json({data:groups,local:true});
 };
 const pending=await store.getPendingBundle(collection,id);
 if(pending){
  const snapshot=await cached();
  return snapshot??Response.json({error:'Los vínculos de este registro pertenecen a un formulario pendiente de sincronizar.'},{status:503});
 }
 if(navigator.onLine===false){
  return (await cached())??Response.json({error:'Los vínculos aún no se han descargado. Conecta para preparar este formulario.'},{status:503});
 }
 let response:Response;
 try{response=await network(path,init);}catch(error){if(isOfflineError(error)){const saved=await cached();if(saved)return saved;}throw error;}
 if(response.status>=500){const saved=await cached();if(saved)return saved;}
 if(response.ok&&page===1){
  const body=await response.clone().json() as {data?:RecordRelationGroup[]};
  if(Array.isArray(body.data)&&body.data.every(g=>g.total===g.records.length&&new Set(g.records.map(r=>r.id)).size===g.total)){
   await store.db.transaction('rw',[store.db.outbox,store.db.linkSnapshots,store.db.collections,store.db.syncState],async()=>{
    if(await store.getPendingBundle(collection,id)||await store.authorizationError())return;
    if(!(await store.db.collections.get(collection)))return;
    await store.db.linkSnapshots.put({collection,id,groups:body.data!.filter(g=>g.definition.storage==='local').map(g=>({definition:g.definition,ids:g.records.map(r=>r.id)}))});
   });
  }
 }
 // A queued save may have committed while the request was in flight.
 if(await store.getPendingBundle(collection,id))return (await cached())??Response.json({error:'Vínculos pendientes de sincronizar.'},{status:503});
 return response;
}
