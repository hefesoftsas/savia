export const hubspotObjects = [
 {resource:"contacts",label:"Contactos",typeId:"0-1",title:"firstname",fields:{firstname:"Nombres",lastname:"Apellidos",email:"Correo electrónico",phone:"Teléfono",lifecyclestage:"Etapa del cliente"}},
 {resource:"companies",label:"Empresas",typeId:"0-2",title:"name",fields:{name:"Nombre",domain:"Dominio",phone:"Teléfono",city:"Ciudad",industry:"Sector"}},
 {resource:"deals",label:"Oportunidades",typeId:"0-3",title:"dealname",fields:{dealname:"Nombre",amount:"Importe",pipeline:"Proceso comercial",dealstage:"Etapa",closedate:"Fecha de cierre"}},
 {resource:"tickets",label:"Tickets",typeId:"0-5",title:"subject",fields:{subject:"Asunto",content:"Descripción",hs_pipeline:"Proceso",hs_pipeline_stage:"Estado"}},
 {resource:"products",label:"Productos",typeId:"0-7",title:"name",fields:{name:"Nombre",description:"Descripción",price:"Precio"}},
 {resource:"line_items",label:"Partidas",typeId:"0-8",title:"name",fields:{name:"Nombre",quantity:"Cantidad",price:"Precio"}},
 {resource:"quotes",label:"Cotizaciones CRM",typeId:"0-14",title:"hs_title",fields:{hs_title:"Título",hs_status:"Estado"}},
 {resource:"tasks",label:"Tareas CRM",typeId:"0-27",title:"hs_task_subject",fields:{hs_task_subject:"Asunto",hs_task_body:"Descripción",hs_task_status:"Estado",hs_task_priority:"Prioridad",hs_timestamp:"Fecha"}},
 {resource:"notes",label:"Notas CRM",typeId:"0-46",title:"hs_note_body",fields:{hs_note_body:"Nota",hs_timestamp:"Fecha"}},
 {resource:"meetings",label:"Reuniones CRM",typeId:"0-47",title:"hs_meeting_title",fields:{hs_meeting_title:"Título",hs_meeting_body:"Descripción",hs_meeting_start_time:"Inicio",hs_meeting_end_time:"Fin"}},
 {resource:"calls",label:"Llamadas CRM",typeId:"0-48",title:"hs_call_title",fields:{hs_call_title:"Título",hs_call_body:"Descripción",hs_call_status:"Estado",hs_timestamp:"Fecha"}},
 {resource:"emails",label:"Correos CRM",typeId:"0-49",title:"hs_email_subject",fields:{hs_email_subject:"Asunto",hs_email_text:"Contenido",hs_timestamp:"Fecha"}},
] as const;
export function hubspotObject(resource:string) { return hubspotObjects.find(item=>item.resource===resource); }
