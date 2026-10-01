require('dotenv').config({path:require('path').join(__dirname,'..','.env')});
const express=require('express'),fs=require('fs'),path=require('path'),mime=require('mime-types');
const app=express();
const crypto=require('crypto');
app.set('trust proxy',1);
app.use(express.json());

// ---- Auth Google OAuth ----
const {GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,SESSION_SECRET,BASE_URL}=process.env;
const ALLOWED=(process.env.ALLOWED_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean);
if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET||!SESSION_SECRET||!BASE_URL||!ALLOWED.length){console.error('Config auth manquante (.env)');process.exit(1);}
const REDIRECT=BASE_URL.replace(/\/+$/,'')+'/auth/callback';
const b64=b=>Buffer.from(b).toString('base64url');
const sign=v=>crypto.createHmac('sha256',SESSION_SECRET).update(v).digest('base64url');
const mk=o=>{const p=b64(JSON.stringify(o));return p+'.'+sign(p);};
const rd=t=>{try{const[p,s]=String(t).split('.');const a=Buffer.from(sign(p)),b=Buffer.from(s||'');
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  const o=JSON.parse(Buffer.from(p,'base64url'));return o.exp>Date.now()?o:null;}catch{return null}};
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(c=>{const i=c.indexOf('=');return[c.slice(0,i).trim(),decodeURIComponent(c.slice(i+1))]}));
const setC=(res,n,v,age)=>res.append('Set-Cookie',`${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);

app.get('/auth/login',(req,res)=>{
  const state=crypto.randomBytes(16).toString('hex');
  setC(res,'oauth_state',mk({state,exp:Date.now()+600000}),600);
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({
    client_id:GOOGLE_CLIENT_ID,redirect_uri:REDIRECT,response_type:'code',scope:'openid email',state,prompt:'select_account'}));});

app.get('/auth/callback',async(req,res)=>{
  try{
    const st=rd(cookies(req).oauth_state);
    if(!st||st.state!==req.query.state||!req.query.code)throw new Error('état invalide');
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({code:req.query.code,client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,redirect_uri:REDIRECT,grant_type:'authorization_code'})});
    const t=await r.json();if(!r.ok||!t.id_token)throw new Error('échec Google');
    const u=JSON.parse(Buffer.from(t.id_token.split('.')[1],'base64url'));
    if(u.aud!==GOOGLE_CLIENT_ID||!u.email_verified||!ALLOWED.includes(String(u.email).toLowerCase()))return res.status(403).send('Accès refusé. <a href="/auth/login">Réessayer</a>');
    setC(res,'oauth_state','',0);
    setC(res,'session',mk({email:u.email,exp:Date.now()+7*864e5}),7*86400);
    res.redirect('/');
  }catch(e){res.status(400).send('Erreur de connexion. <a href="/auth/login">Réessayer</a>');}});

app.get('/auth/logout',(req,res)=>{setC(res,'session','',0);res.redirect('/auth/login');});

app.use((req,res,next)=>{
  if(rd(cookies(req).session))return next();
  if(req.path.startsWith('/api/'))return res.status(401).json({error:'non connecté'});
  res.redirect('/auth/login');});
// ---- fin auth ----

app.use(express.static(path.join(__dirname,'public')));
const ROOT=path.resolve(process.env.STORAGE_DIR||path.join(__dirname,'files'));
const TMP=path.join(ROOT,'.tmp');
fs.mkdirSync(TMP,{recursive:true});
const ci=rel=>{let cur=ROOT;for(const seg of String(rel).split(/[/\\]+/).filter(Boolean)){
  const ex=path.join(cur,seg);
  if(seg==='..'||fs.existsSync(ex)){cur=ex;continue;}
  let m;try{m=fs.readdirSync(cur).find(n=>n.toLowerCase()===seg.toLowerCase())}catch{}
  cur=path.join(cur,m||seg);}
  return cur;};
const safe=(rel='')=>{
  const p=path.resolve(ci(rel));
  if((p!==ROOT&&!p.startsWith(ROOT+path.sep))||p===TMP||p.startsWith(TMP+path.sep))throw new Error('chemin invalide');
  return p;};
const clean=n=>{n=String(n||'').trim();if(!n||/[\\/]/.test(n)||n==='.'||n==='..')throw new Error('nom invalide');return n;};
const unique=(dir,name)=>{const e=path.extname(name),b=path.basename(name,e);let n=name,i=1;while(fs.existsSync(path.join(dir,n)))n=`${b} (${i++})${e}`;return n;};
const h=f=>(req,res)=>{try{f(req,res)}catch(e){res.status(400).json({error:e.message})}};

app.get('/api/list',h((req,res)=>{
  const dir=safe(req.query.path);
  res.json(fs.readdirSync(dir,{withFileTypes:true}).filter(d=>!(dir===ROOT&&d.name==='.tmp')).map(d=>{
    const s=fs.statSync(path.join(dir,d.name));
    return{name:d.name,dir:d.isDirectory(),size:s.size,date:s.mtime};}));}));

app.post('/api/mkdir',h((req,res)=>{
  const d=path.join(safe(req.body.path),clean(req.body.name));
  if(fs.existsSync(d))throw new Error('existe déjà');
  fs.mkdirSync(d);res.json({ok:true});}));

app.post('/api/rename',h((req,res)=>{
  const from=safe(req.body.path),to=path.join(path.dirname(from),clean(req.body.name));
  if(fs.existsSync(to))throw new Error('existe déjà');
  fs.renameSync(from,to);res.json({ok:true});}));

app.post('/api/paste',h((req,res)=>{
  const dest=safe(req.body.dest);
  for(const rel of req.body.items){
    const src=safe(rel);
    if(dest===src||dest.startsWith(src+path.sep))throw new Error('impossible de coller un dossier dans lui-même');
    if(!req.body.copy&&path.dirname(src)===dest)continue;
    const to=path.join(dest,unique(dest,path.basename(src)));
    if(req.body.copy)fs.cpSync(src,to,{recursive:true});
    else try{fs.renameSync(src,to)}catch{fs.cpSync(src,to,{recursive:true});fs.rmSync(src,{recursive:true})}
  }
  res.json({ok:true});}));

app.post('/api/delete',h((req,res)=>{
  for(const rel of req.body.items){const p=safe(rel);if(p!==ROOT)fs.rmSync(p,{recursive:true,force:true});}
  res.json({ok:true});}));

app.post('/api/upload/start',(req,res)=>{
  const id=Date.now()+'-'+Math.random().toString(36).slice(2);
  fs.writeFileSync(path.join(TMP,id),'');res.json({uploadId:id});});

app.put('/api/upload/chunk/:id',(req,res)=>{
  const t=path.join(TMP,path.basename(req.params.id));
  if(!fs.existsSync(t))return res.status(404).json({error:'upload inconnu'});
  const w=fs.createWriteStream(t,{flags:'a'});
  req.pipe(w);
  w.on('finish',()=>res.json({ok:true}));
  w.on('error',()=>res.status(500).json({error:'écriture impossible'}));});

app.post('/api/upload/complete',h((req,res)=>{
  const t=path.join(TMP,path.basename(req.body.uploadId));
  if(!fs.existsSync(t))throw new Error('upload inconnu');
  const dir=safe(req.body.dir),name=unique(dir,clean(req.body.filename));
  fs.renameSync(t,path.join(dir,name));res.json({ok:true,name});}));

app.post('/api/upload/abort',h((req,res)=>{
  fs.rmSync(path.join(TMP,path.basename(req.body.uploadId)),{force:true});res.json({ok:true});}));

app.get('/api/download',h((req,res)=>{
  const p=safe(req.query.path),st=fs.statSync(p);
  if(!st.isFile())throw new Error('pas un fichier');
  const name=path.basename(p);
  res.setHeader('Content-Type',mime.lookup(name)||'application/octet-stream');
  res.setHeader('Content-Disposition',`attachment; filename="${name.replace(/[^\x20-\x7e]|"/g,'_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Accept-Ranges','bytes');
  const r=req.headers.range;
  if(r){
    const[a,b]=r.replace('bytes=','').split('-'),s=parseInt(a,10)||0,e=b?parseInt(b,10):st.size-1;
    res.writeHead(206,{'Content-Range':`bytes ${s}-${e}/${st.size}`,'Content-Length':e-s+1});
    fs.createReadStream(p,{start:s,end:e}).pipe(res);
  }else{
    res.writeHead(200,{'Content-Length':st.size});
    fs.createReadStream(p).pipe(res);
  }}));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`DropZone démarré sur port ${PORT}, stockage: ${ROOT}`));