import { XMLParser } from 'fast-xml-parser';
const parser=new XMLParser({removeNSPrefix:true,parseTagValue:false});
export function simulator(expectedCoverages=2){
 const session='SIM-'+crypto.randomUUID(); let coverage=0; let created=false; let closed=false;
 return async (body:string)=>{
  const tree=parser.parse(body)?.Envelope?.Body??{}; let xml='';
  if(tree.AIGAutos_CrearSesion){created=true;xml=`<No_Sesion>${session}</No_Sesion>`;}
  else {
   const request=tree.AIGAutos_AdicionarCoberturaASesion??tree.AIGAutos_CotizaryCerrarSesion;
   if(!created||closed||request?.idSesion!==session)xml='<Fault><faultstring>Sesión simulada inválida</faultstring></Fault>';
   else if(tree.AIGAutos_AdicionarCoberturaASesion){coverage++;xml='<CoberturaAgregada>true</CoberturaAgregada>';}
   else if(coverage===expectedCoverages){closed=true;xml='<No_Cotizacion>SIM-0001</No_Cotizacion><Prima_Total>1250000</Prima_Total>';}
   else xml='<Fault><faultstring>Faltan coberturas</faultstring></Fault>';
  }
  return new Response(`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Result>${xml}</Result></soap:Body></soap:Envelope>`,{headers:{'content-type':'text/xml'}});
 };
}
export const demoInput:Record<string,string>={
 'auto_light.applicant.documentType':'CC','auto_light.applicant.documentNumber':'0000000000','auto_light.applicant.firstName':'PERSONA','auto_light.applicant.surname':'SIMULADA','auto_light.applicant.secondSurname':'','auto_light.applicant.gender':'F','auto_light.applicant.birthDate':'1990-01-01','auto_light.applicant.city':'11001','auto_light.applicant.address':'DIRECCIÓN SIMULADA','auto_light.applicant.phone':'3000000000','auto_light.applicant.email':'demo@example.invalid','auto_light.vehicle.fasecoldaCode':'00000000','auto_light.vehicle.productionYear':'2024','auto_light.vehicle.isNew':'false','auto_light.vehicle.circulationCity':'11001','auto_light.vehicle.plate':'TESTCAR','auto_light.vehicle.accessoriesValue':'0','auto_light.vehicle.declaredValue':'50000000'
};
