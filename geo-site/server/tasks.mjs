import { HttpError, textValue } from './security.mjs';
import { normalize } from './ima.mjs';

export function parseTasks(rows, companies) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 101 || rows.some(row => !Array.isArray(row))) throw new HttpError(400, '任务表需要标题行和任务行，每批最多 100 行。');
  if (!Array.isArray(companies) || !companies.length || companies.length > 20) throw new HttpError(400, '请上传并指定公司介绍文档，每批最多 20 份。');
  const docs = companies.map(doc => ({ name: textValue(doc.name,'公司文件名',200), brand: textValue(doc.brand,'公司文档对应品牌',120), text: textValue(doc.text,'公司文档正文',180000) }));
  const header = rows[0].map(normalize);
  const aliases = { brand:['品牌名','品牌','公司名'],kb:['geo知识库','知识库'],question:['问句','问题','标题','关键词'],count:['篇数','数量'],media:['媒体平台','发布平台'],ai:['ai平台'],notes:['备注'] };
  const columns = Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,header.findIndex(h=>names.includes(h))]));
  for (const field of ['brand','kb','question']) if(columns[field]<0)throw new HttpError(400,'任务表必须包含：品牌名、GEO知识库、问句。');
  const tasks=[];
  for (const row of rows.slice(1)) {
    if(row.every(cell=>!String(cell??'').trim()))continue;
    const value = key => String(row[columns[key]] ?? '').trim();
    const brand=textValue(value('brand'),'品牌名',120),kb=textValue(value('kb'),'GEO知识库',120),question=textValue(value('question'),'问句',1000);
    const raw=value('count')||'1';if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>20)throw new HttpError(400,'每行篇数须为 1–20 的整数。');
    const matching=docs.filter(d=>normalize(d.brand)===normalize(brand));if(!matching.length)throw new HttpError(400,`品牌「${brand}」缺少对应公司文档，请在文件下方指定品牌。`);
    for(let n=0;n<Number(raw);n++) tasks.push({brand,kb,question,media:value('media'),ai:value('ai'),notes:textValue(value('notes'),'备注',2000,false),variant:n+1});
  }
  if(!tasks.length||tasks.length>100)throw new HttpError(400,'每批需要 1–100 篇文章。');
  return {tasks,companies:docs};
}

export function auditResult(raw) {
  const clean=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let value;try{value=JSON.parse(clean);}catch{throw new HttpError(422,'审核结果不是有效 JSON，已停止，未把草稿标为完成。');}
  if(typeof value.passed!=='boolean'||!Array.isArray(value.issues)||value.issues.some(v=>typeof v!=='string'||!v.trim())||value.passed!==(value.issues.length===0))throw new HttpError(422,'审核结果结构不一致，已停止。');
  return value;
}
