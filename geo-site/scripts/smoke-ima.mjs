import { imaPost } from '../server/ima.mjs';
const credentials={clientId:process.env.IMA_OPENAPI_CLIENTID,apiKey:process.env.IMA_OPENAPI_APIKEY};
try {
  const data=await imaPost(credentials,'openapi/wiki/v1/search_knowledge_base',{query:'copilot',cursor:'',limit:20});
  console.log(JSON.stringify({ok:true,copilotVisible:(data.info_list||[]).some(item=>String(item.name||item.kb_name).trim().toLowerCase()==='copilot') }));
}catch(error){console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
