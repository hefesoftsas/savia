import { z } from 'zod';
const id = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const noticeScopeSchema = z.discriminatedUnion('kind', [
 z.strictObject({kind:z.literal('workspace'),id}), z.strictObject({kind:z.literal('account'),id}),
]);
export const noticeSourceSchema = z.discriminatedUnion('kind', [
 z.strictObject({kind:z.literal('record'),collection:id,id,operation:z.enum(['created','updated','deleted'])}),
 z.strictObject({kind:z.literal('workflow-task'),id}),
 z.strictObject({kind:z.literal('admin-message'),id}),
 z.strictObject({kind:z.literal('security-request'),id}),
]);
const principals = z.array(id).min(1).max(100).refine(a=>new Set(a).size===a.length,'Duplicate recipients');
export const noticeAudienceSchema = z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('explicit'),principals}),
 z.strictObject({kind:z.literal('workspace-members')}),
 z.strictObject({kind:z.literal('collection-followers'),collection:id}),
]);
export const noticeEventSchema = z.strictObject({
 scope:noticeScopeSchema,key:id,actor:z.strictObject({kind:z.enum(['user','workflow','public-form','system']),id:id.nullable()}),
 source:noticeSourceSchema,title:z.string().trim().min(1).max(500),body:z.string().max(4000),
 audience:noticeAudienceSchema,createdAt:time,expiresAt:time.nullable(),
 requireAcknowledgement:z.boolean().optional(),
}).superRefine((event,ctx)=>{
 if(event.scope.kind==='account' && (event.audience.kind!=='explicit' || event.audience.principals.length!==1 || event.audience.principals[0]!==event.scope.id))
  ctx.addIssue({code:'custom',message:'Account notices belong only to their principal'});
 if(new TextEncoder().encode(JSON.stringify(event)).length>16384)
  ctx.addIssue({code:'custom',message:'Event exceeds 16 KiB'});
 if(event.expiresAt!==null && event.expiresAt<=event.createdAt)
  ctx.addIssue({code:'custom',message:'Expiry must follow creation'});
});
export const inboxQuerySchema = z.strictObject({cursor:z.string().max(2048).optional(),limit:z.coerce.number().int().min(1).max(100).default(30),filter:z.enum(['all','unread','pending']).default('all')});
export const adminNoticeSchema = z.strictObject({title:z.string().trim().min(1).max(200),body:z.string().max(4000).default(''),audience:z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('explicit'),principals}),z.strictObject({kind:z.literal('workspace-members')}),
]),requireAcknowledgement:z.boolean().default(false)}).refine(v=>new TextEncoder().encode(JSON.stringify(v)).length<=16384,'Message exceeds 16 KiB');
export const retentionSchema=z.strictObject({readDays:z.number().int().min(7).max(365),unreadDays:z.number().int().min(30).max(730)}).refine(v=>v.unreadDays>=v.readDays,'Unread retention must include read retention');
export const notificationDefaults={maxEvents:50,maxRecipients:100,maxRecipientAttempts:1000,softBudgetMs:20000,leaseMs:60000,readDays:90,unreadDays:180} as const;
export type NoticeScope=z.infer<typeof noticeScopeSchema>;
export type NoticeSource=z.infer<typeof noticeSourceSchema>;
export type NoticeEventInput=z.infer<typeof noticeEventSchema>;
export type NoticeAudience=z.infer<typeof noticeAudienceSchema>;
export type NoticeActor=NoticeEventInput['actor'];
export type InboxQuery=z.input<typeof inboxQuerySchema>;
export type NoticeActionState='none'|'pending'|'done'|'expired'|'unavailable';
export type NoticeView={id:string;scope:NoticeScope;title:string;body:string;createdAt:number;readAt:number|null;archivedAt:number|null;source:NoticeSource;actionState:NoticeActionState};
export type InboxPage={items:NoticeView[];nextCursor:string|null;cutoff:string};
export type DispatchOptions={now?:()=>number;random?:()=>number;workerId:string;maxEvents?:number;maxRecipients?:number;maxRecipientAttempts?:number;softBudgetMs?:number;leaseMs?:number};
export type DispatchReport={claimed:number;delivered:number;skipped:number;failed:number;retried:number;recoveredLeases:number};
export interface NotificationPolicy {
 canReadScope(principal:string,scope:NoticeScope):Promise<boolean>;
 canReadSource(principal:string,scope:NoticeScope,source:NoticeSource):Promise<boolean>;
 canSend(principal:string,scope:NoticeScope):Promise<boolean>;
 recipients(event:NoticeEventInput,after:string|null,limit:number):Promise<{ids:string[];nextCursor:string|null}>;
}
