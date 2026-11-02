'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {isDeepStrictEqual} = require('node:util');
const newman = require('newman');
const {createFixtures} = require('../selenium/fixtures.cjs');
const ROOT = path.resolve(__dirname,'../..');
const OUTPUT = path.join(ROOT,'tests/evidence/postman');

function r(label, method, route, opts={}) {
  const tests=[];
  if(opts.status!==undefined) tests.push(`pm.test(${JSON.stringify('Mã HTTP đúng: '+JSON.stringify(opts.status))},()=>pm.expect(pm.response.code).to.be.oneOf(${JSON.stringify(Array.isArray(opts.status)?opts.status:[opts.status])}));`);
  if(opts.location!==undefined) tests.push(`pm.test('Địa chỉ chuyển hướng đúng',()=>pm.expect(pm.response.headers.get('Location')).to.eql(${JSON.stringify(opts.location)}));`);
  if(opts.json) {
    tests.push("pm.test('Phản hồi có định dạng JSON',()=>pm.expect(pm.response.headers.get('Content-Type')||'').to.include('application/json'));");
    for(const [k,v] of Object.entries(opts.json)) tests.push(`pm.test(${JSON.stringify('Giá trị '+k+' đúng')},()=>pm.expect(pm.response.json()[${JSON.stringify(k)}]).to.eql(${JSON.stringify(v)}));`);
  }
  tests.push(...(opts.tests||[]));
  const headers={Accept:'application/json',...opts.headers};
  let body;
  if(opts.body!==undefined){headers['Content-Type']='application/json';body={mode:'raw',raw:JSON.stringify(opts.body),options:{raw:{language:'json'}}};}
  if(opts.form!==undefined){headers['Content-Type']='application/x-www-form-urlencoded';body={mode:'urlencoded',urlencoded:Object.entries(opts.form).map(([key,value])=>({key,value:String(value),type:'text'}))};}
  return {name:label,request:{method,url:(opts.admin?'{{admin_url}}':'{{user_url}}')+route,header:Object.entries(headers).map(([key,value])=>({key,value})),...(body?{body}:{})},protocolProfileBehavior:{followRedirects:false},event:[{listen:'test',script:{type:'text/javascript',exec:tests}}]};
}
function login(role='user',opts={}) {
  return r('Đăng nhập '+role,'POST',role==='admin'?'/login':role==='shipper'?'/auth/shipper-login':'/auth/login',{
    admin:role==='admin',form:{account:`{{${role}_account}}`,password:'{{password}}'},status:302,
    location:role==='admin'?'/dashboard':role==='shipper'?'/shipper/dashboard':'/?login_success=1',...opts});
}
function logout(){return r('Đăng xuất khách hàng','GET','/auth/logout',{status:302,location:'/'});}
const CASES=[...require('./cases-auth.cjs')({r,login,logout}),...require('./cases-commerce.cjs')({r,login,logout})].sort((a,b)=>a.id.localeCompare(b.id));
const GUARD=[
  "const allowed=pm.environment.get('active_case');",
  "const current=pm.info.requestName.split(' | ')[0];",
  "const urls=['user_url','admin_url'].map(k=>pm.environment.get(k)||'');",
  "if (!allowed || current!==allowed || !urls.every(u=>/^http:\\/\\/(127\\.0\\.0\\.1|localhost):[1-9][0-9]{3,4}$/.test(u))) {",
  "  pm.execution.skipRequest(); console.warn('Chỉ chạy thư mục active_case trong môi trường kiểm thử tạm đã chuẩn bị.');",
  "}",
];
function collection(){return {info:{name:'Website quần áo - Kiểm thử Postman',description:'24 ca API trên database tạm riêng. Chạy npm run test:postman để kiểm thử toàn bộ. Trong Postman Desktop, khởi động môi trường với --serve --case=API-xx rồi chọn đúng thư mục đó. Không dùng dữ liệu đang vận hành.',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},event:[{listen:'prerequest',script:{type:'text/javascript',exec:GUARD}}],item:CASES.map(c=>({name:c.id+' '+c.title,description:`Dữ liệu: ${c.data}\nMong đợi: ${c.expected}\nPhạm vi: ${c.scope}`,item:c.requests.map((q,i)=>({...q,name:`${c.id} | ${String(i+1).padStart(2,'0')} | ${q.name}`}))}))};}
async function port(){const s=net.createServer();await new Promise((a,b)=>{s.once('error',b);s.listen(0,'127.0.0.1',a);});const p=s.address().port;await new Promise(a=>s.close(a));return p;}
function environment(f,urls,active){
  const values={user_url:urls.user,admin_url:urls.admin,active_case:active,password:f.user.password,user_account:f.user.account,other_account:f.otherUser.account,shipper_account:f.shipper.account,admin_account:f.admin.account,user_email:f.user.gmail,product_id:String(f.product.id),other_product_id:String(f.otherProduct.id),third_product_id:String(f.thirdProduct.id),product_name:f.product.name,pending_order_id:String(f.pendingOrder.id),delivered_order_id:String(f.deliveredOrder.id),waiting_order_id:String(f.waitingOrder.id)};
  return {name:'LOCAL POSTMAN '+active,values:Object.entries(values).map(([key,value])=>({key,value,type:key==='password'?'secret':'default',enabled:true})),_postman_variable_scope:'environment'};
}
function safeResponse(ex){
  return {name:ex.item.name,method:ex.request.method,url:ex.request.url.toString(),status:ex.response?.code||null,timeMs:ex.response?.responseTime||null,
    headers:(ex.response?.headers?.toJSON()||[]).filter(h=>!/set-cookie|cookie|authorization/i.test(h.key)),
    body:ex.response?.stream?.toString('utf8')||'',assertions:(ex.assertions||[]).map(a=>({message:a.assertion,passed:!a.error,error:a.error?.message||null}))};
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function readable(v){return typeof v==='object'?JSON.stringify(v,null,2):String(v);}
async function report(run,dir){
  const c=run.tests.reduce((a,t)=>(a[t.status]=(a[t.status]||0)+1,a),{});
  run.totals={cases:run.tests.length,pass:c.PASS||0,fail:c.FAIL||0,error:c.ERROR||0,requests:run.tests.reduce((a,t)=>a+t.executions.length,0),postmanAssertions:run.tests.reduce((a,t)=>a+t.executions.reduce((n,e)=>n+e.assertions.length,0),0),dbAssertions:run.tests.reduce((a,t)=>a+t.dbChecks.length,0)};
  await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(run,null,2));
  const rows=run.tests.map(t=>`<tr><td><a href="#${t.id}">${t.id}</a></td><td>${esc(t.title)}</td><td class="${t.status}">${t.status}</td><td>${t.executions.length}</td></tr>`).join('');
  const details=run.tests.map(t=>`<section id="${t.id}"><h2>${t.id} ${esc(t.title)}</h2><p><b>Kết quả: <span class="${t.status}">${t.status}</span></b></p><p><b>Dữ liệu:</b> ${esc(t.data)}</p><p><b>Mong đợi:</b> ${esc(t.expected)}</p><p><b>Phạm vi:</b> ${esc(t.scope)}</p>${t.executions.map(e=>`<h3>${esc(e.name)}</h3><p>${e.method} ${esc(e.url)} — HTTP ${e.status}, ${e.timeMs} ms</p><ul>${e.assertions.map(a=>`<li class="${a.passed?'PASS':'FAIL'}">${a.passed?'Đúng':'Sai'}: ${esc(a.message)}${a.error?' — '+esc(a.error):''}</li>`).join('')}</ul><details><summary>Phản hồi thực tế</summary><pre>${esc(e.body)}</pre></details>`).join('')}<h3>Đối chiếu dữ liệu lưu sau ca</h3><table><tr><th>Nội dung</th><th>Mong đợi</th><th>Thực tế</th><th>Kết quả</th></tr>${t.dbChecks.map(a=>`<tr><td>${esc(a.message)}</td><td><pre>${esc(readable(a.expected))}</pre></td><td><pre>${esc(readable(a.actual))}</pre></td><td class="${a.passed?'PASS':'FAIL'}">${a.passed?'Đúng':'Sai'}</td></tr>`).join('')}</table>${t.error?'<pre>'+esc(t.error)+'</pre>':''}</section>`).join('');
  const html=`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kết quả Postman Newman</title><style>body{font:16px/1.5 Arial;margin:36px auto;max-width:1180px;color:#17202a;padding:0 24px}h1,h2,h3{color:#17202a}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #cfd5db;padding:10px;text-align:left;vertical-align:top}th{background:#e7eef6}.PASS{color:#166534}.FAIL,.ERROR{color:#b91c1c}pre{white-space:pre-wrap;word-break:break-word;font:14px/1.4 Consolas}section{border-top:1px solid #ddd;margin-top:40px;padding-top:20px}.summary{font-size:20px;background:#f2f6fa;padding:20px}</style><h1>Kết quả kiểm thử API bằng collection Postman và Newman</h1><p>Lượt chạy ${esc(run.id)} · ${esc(run.localTime)}</p><p>${esc(run.environment)}</p><p class="summary">${run.totals.cases} ca · ${run.totals.pass} đạt · ${run.totals.fail} không đạt · ${run.totals.error} lỗi thực thi<br>${run.totals.requests} yêu cầu · ${run.totals.postmanAssertions} đối chiếu Postman · ${run.totals.dbAssertions} đối chiếu dữ liệu lưu</p><table><tr><th>Mã</th><th>Nội dung</th><th>Kết quả</th><th>Yêu cầu</th></tr>${rows}</table>${details}</html>`;
  await fs.writeFile(path.join(dir,'report.html'),html);
  console.log(JSON.stringify(run.totals));console.log('Báo cáo: '+path.join(dir,'report.html'));
}
async function main(){
  const args=process.argv.slice(2),serve=args.includes('--serve'),only=args.find(a=>a.startsWith('--case='))?.slice(7).toUpperCase();
  if(args.some(a=>a!=='--serve'&&!a.startsWith('--case=')))throw Error('Tùy chọn hợp lệ: --serve --case=API-01');
  if(only&&!CASES.some(c=>c.id===only))throw Error('Mã ca hợp lệ API-01 đến API-24');
  if(serve&&!only)throw Error('Chế độ giao diện yêu cầu --case=API-xx');
  const col=collection();await fs.writeFile(path.join(__dirname,'WebsiteQuanAo.postman_collection.json'),JSON.stringify(col,null,2));
  const template={name:'CHUA KHOI DONG - chi dung database tam',values:[{key:'user_url',value:'http://127.0.0.1:0',enabled:true},{key:'admin_url',value:'http://127.0.0.1:0',enabled:true},{key:'active_case',value:'CHUA_CHON',enabled:true}],_postman_variable_scope:'environment'};
  await fs.writeFile(path.join(__dirname,'LocalTemplate.postman_environment.json'),JSON.stringify(template,null,2));
  const start=new Date(),id=start.toISOString().replace(/[:.]/g,'-');const dir=path.join(OUTPUT,id);await fs.mkdir(dir,{recursive:true});
  const run={id,startedAt:start.toISOString(),localTime:new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',dateStyle:'full',timeStyle:'long'}).format(start),nodeVersion:process.version,newmanVersion:require('newman/package.json').version,environment:'Hai ứng dụng thật trên cổng riêng, MongoDB tạm và dữ liệu giả; cookie phiên không đưa vào báo cáo.',tests:[],sourceHashes:{},cleanupErrors:[]};
  for(const filename of ['user/controllers/authController.js','user/controllers/cartController.js','user/controllers/orderController.js','user/controllers/shipperController.js','admin/src/controllers/product-controllers.js','tests/postman/cases-auth.cjs','tests/postman/cases-commerce.cjs','tests/postman/run.cjs'])run.sourceHashes[filename]=crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,filename))).digest('hex');
  const procs=[];let fixtureEnv;let stopping=false;
  async function close(){if(stopping)return;stopping=true;for(const p of procs){if(p.child.exitCode===null)p.child.kill();await Promise.race([new Promise(a=>p.child.once('exit',a)),new Promise(a=>setTimeout(a,1000))]);await p.log.close().catch(()=>{});}if(fixtureEnv)await fixtureEnv.close();}
  for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>close().finally(()=>process.exit(130)));
  async function startApp(name,p){const log=await fs.open(path.join(dir,`${name}-app.log`),'w');const child=spawn(process.execPath,['server.js'],{cwd:path.join(ROOT,name),windowsHide:true,env:{...process.env,PORT:String(p),NODE_ENV:'test',MONGODB_URI:fixtureEnv.uri,ADMIN_ACCOUNT:fixtureEnv.fixture.admin.account,ADMIN_PASSWORD:fixtureEnv.fixture.admin.password,SESSION_SECRET:'postman-'+crypto.randomBytes(24).toString('hex')},stdio:['ignore',log.fd,log.fd]});procs.push({child,log});let err;child.once('error',e=>{err=e;});const base=`http://127.0.0.1:${p}`;for(let i=0;i<100;i++){if(err)throw err;if(child.exitCode!==null)throw Error(name+' failed to start');try{const x=await fetch(base+(name==='admin'?'/login':'/auth/login'),{signal:AbortSignal.timeout(1000)});await x.text();if(x.status===200)return base;}catch{}await new Promise(a=>setTimeout(a,200));}throw Error('Không khởi động được '+name);}
  try{
    fixtureEnv=await createFixtures();const f=fixtureEnv.fixture;
    for(const [key,account,name] of [['user','postman_customer','Khách Postman A'],['otherUser','postman_other','Khách Postman B'],['admin','postman_admin','Quản trị Postman'],['shipper','postman_shipper','Shipper Postman']]){Object.assign(f[key],{account,name});}
    for(const k of ['product','otherProduct','thirdProduct','category','otherCategory'])f[k].name=f[k].name.replace(/Selenium/g,'Postman');
    await fixtureEnv.reset('postman-start');
    const urls={user:await startApp('user',await port()),admin:await startApp('admin',await port())};run.urls=urls;
    async function prepare(c){await fixtureEnv.reset(c.id);await fixtureEnv.db.collection('users').updateOne({_id:f.otherUser.id},{$set:{orders:[f.pendingOrder.id,f.deliveredOrder.id,f.waitingOrder.id]}});if(c.prepare)await c.prepare({db:fixtureEnv.db,f});}
    async function verify(c,result){if(c.verify)await c.verify({db:fixtureEnv.db,f,executions:result.executions,vars:result.variables||{},check(actual,expected,message){const passed=isDeepStrictEqual(actual,expected);result.dbChecks.push({message,expected,actual,passed});console.log(`  ${passed?'OK':'SAI'} DB: ${message}`);return passed;}});}
    if(serve){const c=CASES.find(c=>c.id===only);await prepare(c);const env=environment(f,urls,c.id);const envPath=path.join(dir,'LOCAL_POSTMAN.postman_environment.json');await fs.writeFile(envPath,JSON.stringify(env,null,2));await fs.writeFile(path.join(__dirname,'ACTIVE_LOCAL.postman_environment.json'),JSON.stringify(env,null,2));console.log('GUI_READY '+JSON.stringify({case:c.id,collection:path.join(__dirname,'WebsiteQuanAo.postman_collection.json'),environment:envPath,urls}));console.log('Nhập verify để đọc dữ liệu sau lượt Postman, reset để chuẩn bị lại, stop để đóng.');const readline=require('node:readline').createInterface({input:process.stdin});await new Promise(resolve=>{readline.on('line',async line=>{try{if(line.trim()==='verify'){const x={id:c.id,title:c.title,data:c.data,expected:c.expected,scope:c.scope,status:'GUI_OBSERVATION',executions:[],dbChecks:[]};await verify(c,x);await fs.writeFile(path.join(dir,'desktop-db-evidence.json'),JSON.stringify(x,null,2));console.log('GUI_DB '+JSON.stringify(x.dbChecks));}else if(line.trim()==='reset'){await prepare(c);console.log('GUI_RESET '+c.id);}else if(line.trim()==='stop'){readline.close();resolve();}}catch(e){console.error(e);}});readline.once('close',resolve);});return;}
    for(const c of CASES.filter(c=>!only||c.id===only)){
      await prepare(c);const result={id:c.id,title:c.title,data:c.data,expected:c.expected,scope:c.scope,status:'ERROR',executions:[],dbChecks:[]};console.log('\n'+c.id+' '+c.title);const startCase=Date.now();
      try{
        const summary=await new Promise((resolve,reject)=>newman.run({collection:col,folder:c.id+' '+c.title,environment:environment(f,urls,c.id),ignoreRedirects:true,timeoutRequest:10000,timeoutScript:5000,reporters:['json','junit'],reporter:{json:{export:path.join(dir,c.id+'.newman.json')},junit:{export:path.join(dir,c.id+'.junit.xml')}}},(err,s)=>err?reject(err):resolve(s)));
        result.executions=summary.run.executions.map(safeResponse);
        result.variables=Object.fromEntries((summary.environment?.values?.toJSON()||[]).filter(v=>!/cookie|session|password/i.test(v.key)).map(v=>[v.key,v.value]));
        await verify(c,result);
        const nonAssertion=summary.run.failures.filter(x=>x.error?.name!=='AssertionError');
        if(nonAssertion.length){result.error=nonAssertion.map(x=>x.error?.message).join('; ');result.status='ERROR';}
        else result.status=result.executions.length===c.requests.length&&result.executions.every(e=>e.status!==null&&e.assertions.every(a=>a.passed))&&result.dbChecks.every(a=>a.passed)?'PASS':'FAIL';
      }catch(e){result.error=e.stack;}
      result.durationMs=Date.now()-startCase;run.tests.push(result);console.log(c.id+': '+result.status);await report(run,dir);
    }
    run.finishedAt=new Date().toISOString();await report(run,dir);process.exitCode=run.tests.some(t=>t.status!=='PASS')?1:0;
  }finally{await close();}
}
main().catch(e=>{console.error(e);process.exitCode=2;});
