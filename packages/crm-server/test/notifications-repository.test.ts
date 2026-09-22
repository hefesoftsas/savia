import {beforeAll,afterAll,it,expect} from 'vitest';
import {notificationFixture} from './notifications-fixture';
import {NotificationRepository} from '../src/notifications/repository';
import type {NoticeEventInput} from '@savia/crm-shared/notifications';
let fixture:Awaited<ReturnType<typeof notificationFixture>>;
let repository:NotificationRepository;
const scope={kind:'workspace',id:'domain:general'} as const;
const input:NoticeEventInput={scope,key:'one',actor:{kind:'user',id:'admin'},source:{kind:'admin-message',id:'one'},title:'Review',body:'',audience:{kind:'explicit',principals:['alice']},createdAt:1000,expiresAt:null};
beforeAll(async()=>{fixture=await notificationFixture();repository=new NotificationRepository(fixture.db)});
afterAll(async()=>fixture?.dispose());
it('accepts duplicates but rejects a changed event payload',async()=>{
 const first=await repository.accept(input);
 expect((await repository.accept(input)).id).toBe(first.id);
 await expect(repository.accept({...input,title:'Changed'})).rejects.toMatchObject({status:409});
});
it('rolls event capture back with the enclosing transaction',async()=>{
 await expect(fixture.db.batch([...repository.eventStatements({...input,key:'rollback'}),fixture.db.prepare('INSERT INTO crm_write_guards(id,valid) VALUES (?,0)').bind('bad')])).rejects.toThrow();
 expect(await fixture.db.prepare("SELECT count(*) AS n FROM notification_events WHERE event_key='rollback'").first('n')).toBe(0);
});
it('pages equal timestamps without overlap and isolates recipients',async()=>{
 for(let i=0;i<4;i++){
 const event=await repository.accept({...input,key:'page'+i});
 await fixture.db.prepare('INSERT INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at) VALUES (?,?,?,?,?,?)').bind('page'+i,event.id,'workspace',scope.id,i===3?'bob':'alice',1000).run();
 }
 const first=await repository.list('alice',[scope],{limit:2});
 expect(first.items.map(x=>x.id)).toEqual(['page2','page1']);
 const second=await repository.list('alice',[scope],{limit:2,cursor:first.nextCursor!});
 expect(second.items.map(x=>x.id)).toEqual(['page0']);
 await expect(repository.markRead('bob',scope,'page0',true)).rejects.toMatchObject({status:404});
 await repository.markRead('alice',scope,'page0',true);
 await repository.markRead('alice',scope,'page0',true);
 expect((await repository.list('alice',[scope],{filter:'unread'})).items).toHaveLength(2);
});
