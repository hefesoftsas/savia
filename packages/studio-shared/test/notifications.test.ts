import { describe, it, expect } from 'vitest';
import { noticeEventSchema, inboxQuerySchema, adminNoticeSchema, retentionSchema } from '../src/notifications';
const event = {
 scope: {kind:'workspace',id:'domain:general'}, key:'event-1',
 actor:{kind:'user',id:'alice'}, source:{kind:'admin-message',id:'message-1'},
 title:'Review',body:'',audience:{kind:'explicit',principals:['bob']},createdAt:1000,expiresAt:null,
};
describe('notification contracts',()=>{
 it('accepts bounded events and defaults pagination',()=>{
  expect(noticeEventSchema.parse(event)).toEqual(event);
  expect(inboxQuerySchema.parse({}).limit).toBe(30);
  expect(inboxQuerySchema.safeParse({limit:101}).success).toBe(false);
 });
 it('rejects account broadcasts and another principal',()=>{
  const account={...event,scope:{kind:'account',id:'alice'}};
  expect(noticeEventSchema.safeParse({...account,audience:{kind:'workspace-members'}}).success).toBe(false);
  expect(noticeEventSchema.safeParse(account).success).toBe(false);
  expect(noticeEventSchema.safeParse({...account,audience:{kind:'explicit',principals:['alice']}}).success).toBe(true);
 });
 it('rejects empty, duplicate, excessive and forged recipients',()=>{
  for(const principals of [[],['bob','bob'],Array.from({length:101},(_,i)=>'u'+i)])
   expect(noticeEventSchema.safeParse({...event,audience:{kind:'explicit',principals}}).success).toBe(false);
  expect(noticeEventSchema.safeParse({...event,principalId:'admin'}).success).toBe(false);
  expect(noticeEventSchema.safeParse({...event,source:{kind:'url',url:'https://example.com'}}).success).toBe(false);
 });
 it('measures encoded payload size and preserves legacy workflow titles',()=>{
  expect(noticeEventSchema.safeParse({...event,title:'x'.repeat(500)}).success).toBe(true);
  expect(noticeEventSchema.safeParse({...event,title:'x'.repeat(500),body:'😀'.repeat(4000)}).success).toBe(false);
  expect(adminNoticeSchema.safeParse({title:'x'.repeat(201),body:'',audience:event.audience}).success).toBe(false);
 });
 it('validates retention ordering and rejects control characters in identifiers',()=>{
  expect(retentionSchema.safeParse({readDays:90,unreadDays:30}).success).toBe(false);
  expect(noticeEventSchema.safeParse({...event,key:'bad\u0000key'}).success).toBe(false);
 });
});
