const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json;charset=utf-8"}});
const now=()=>Date.now();
const id=()=>crypto.randomUUID();
const clean=(v,n=30)=>String(v??"").replace(/[<>&"']/g,"").trim().slice(0,n);
async function hash(v){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function body(req){try{return await req.json()}catch{return {}}}
async function auth(req,env){const raw=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!raw)return null;return env.DB.prepare("SELECT * FROM users WHERE token_hash=?").bind(await hash(raw)).first()}
function taxFor(income){const cuts=[14e12,50e12,88e12,150e12,300e12,500e12,1000e12,Infinity],rates=[.06,.15,.24,.35,.38,.40,.42,.45];let tax=0,prev=0;for(let i=0;i<cuts.length;i++){const part=Math.max(0,Math.min(income,cuts[i])-prev);tax+=part*rates[i];if(income<=cuts[i])break;prev=cuts[i]}return Math.floor(tax)}
async function areFriends(env,a,b){return !!(await env.DB.prepare("SELECT 1 ok FROM friendships WHERE status='accepted' AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))").bind(a,b,b,a).first())}

async function api(req,env,url){
  const path=url.pathname,method=req.method;
  if(path==="/api/register"&&method==="POST"){
    const d=await body(req),nickname=clean(d.nickname,12);if(nickname.length<2)return json({error:"닉네임은 2글자 이상이어야 합니다."},400);
    const token=crypto.randomUUID()+crypto.randomUUID(),userId=id(),code=Math.random().toString(36).slice(2,8).toUpperCase(),t=now();
    try{await env.DB.prepare("INSERT INTO users(id,token_hash,nickname,friend_code,last_seen,created_at) VALUES(?,?,?,?,?,?)").bind(userId,await hash(token),nickname,code,t,t).run();return json({token,user:{id:userId,nickname,friend_code:code}})}catch{return json({error:"이미 사용 중인 닉네임입니다."},409)}
  }
  const user=await auth(req,env);if(!user)return json({error:"로그인이 필요합니다."},401);
  await env.DB.prepare("UPDATE users SET last_seen=? WHERE id=?").bind(now(),user.id).run();
  if(path==="/api/me")return json({user:{id:user.id,nickname:user.nickname,friend_code:user.friend_code,balance:user.balance}});
  if(path==="/api/state"&&method==="POST"){
    const d=await body(req),balance=Math.max(0,Math.min(Number(d.balance)||0,1e40));
    await env.DB.prepare("UPDATE users SET balance=? WHERE id=?").bind(balance,user.id).run();
    await env.DB.prepare(`INSERT INTO rankings(user_id,assets,hamlet,territory,collection,rare_items,achievements,rebirth,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET assets=excluded.assets,hamlet=excluded.hamlet,territory=excluded.territory,collection=excluded.collection,rare_items=excluded.rare_items,achievements=excluded.achievements,rebirth=excluded.rebirth,updated_at=excluded.updated_at`).bind(user.id,balance,+d.hamlet||0,+d.territory||0,+d.collection||0,+d.rare_items||0,+d.achievements||0,+d.rebirth||0,now()).run();return json({ok:true});
  }
  if(path==="/api/inventory/sync"&&method==="POST"){
    const d=await body(req),items=d.items&&typeof d.items==="object"?d.items:{};
    const statements=Object.entries(items).slice(0,100).map(([key,value])=>env.DB.prepare("INSERT INTO inventory(user_id,item_key,quantity) VALUES(?,?,?) ON CONFLICT(user_id,item_key) DO UPDATE SET quantity=MAX(inventory.locked,excluded.quantity)").bind(user.id,clean(key,80),Math.max(0,Math.floor(+value||0))));
    if(statements.length)await env.DB.batch(statements);return json({ok:true});
  }
  if(path==="/api/artworks"&&method==="POST"){
    const d=await body(req),artId=clean(d.id,80),title=clean(d.title,30),pixels=Array.isArray(d.pixels)?d.pixels.slice(0,1024):[];if(!artId||!title||pixels.length!==1024)return json({error:"그림 데이터가 올바르지 않습니다."},400);
    await env.DB.prepare("INSERT OR IGNORE INTO artworks(id,creator_id,owner_id,title,pixels,created_at) VALUES(?,?,?,?,?,?)").bind(artId,user.id,user.id,title,JSON.stringify(pixels),now()).run();return json({ok:true});
  }
  if(path==="/api/friends"){
    const rows=await env.DB.prepare(`SELECT f.id,f.status,u.id user_id,u.nickname,u.friend_code,u.last_seen FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END WHERE f.requester_id=? OR f.addressee_id=? ORDER BY u.nickname`).bind(user.id,user.id,user.id).all();return json({friends:rows.results.map(x=>({...x,online:now()-x.last_seen<60000}))});
  }
  if(path==="/api/friends/request"&&method==="POST"){
    const d=await body(req),target=await env.DB.prepare("SELECT id FROM users WHERE friend_code=?").bind(clean(d.code,12).toUpperCase()).first();if(!target||target.id===user.id)return json({error:"친구 코드를 확인해주세요."},404);
    try{await env.DB.prepare("INSERT INTO friendships(id,requester_id,addressee_id,status,created_at) VALUES(?,?,?,?,?)").bind(id(),user.id,target.id,"pending",now()).run();return json({ok:true})}catch{return json({error:"이미 요청했거나 친구입니다."},409)}
  }
  if(path==="/api/friends/accept"&&method==="POST"){
    const d=await body(req);await env.DB.prepare("UPDATE friendships SET status='accepted' WHERE id=? AND addressee_id=? AND status='pending'").bind(clean(d.id,50),user.id).run();return json({ok:true});
  }
  if(path==="/api/messages"&&method==="GET"){
    const other=clean(url.searchParams.get("user"),50);if(!await areFriends(env,user.id,other))return json({error:"친구끼리만 메시지를 보낼 수 있습니다."},403);
    const rows=await env.DB.prepare("SELECT * FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at DESC LIMIT 100").bind(user.id,other,other,user.id).all();return json({messages:rows.results.reverse()});
  }
  if(path==="/api/messages"&&method==="POST"){
    const d=await body(req),to=clean(d.to,50),text=clean(d.body,300);if(!text)return json({error:"메시지를 입력해주세요."},400);if(!await areFriends(env,user.id,to))return json({error:"친구끼리만 메시지를 보낼 수 있습니다."},403);
    await env.DB.prepare("INSERT INTO messages(id,sender_id,receiver_id,body,created_at) VALUES(?,?,?,?,?)").bind(id(),user.id,to,text,now()).run();return json({ok:true});
  }
  if(path==="/api/auctions"&&method==="GET"){
    const rows=await env.DB.prepare("SELECT a.*,u.nickname seller_name FROM auctions a JOIN users u ON u.id=a.seller_id WHERE a.status='active' ORDER BY a.created_at DESC LIMIT 100").all();return json({auctions:rows.results});
  }
  if(path==="/api/auctions/mine"&&method==="GET"){
    const rows=await env.DB.prepare("SELECT * FROM auctions WHERE seller_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();return json({auctions:rows.results});
  }
  if(path==="/api/auctions"&&method==="POST"){
    const d=await body(req),kind=["art","toilet"].includes(d.kind)?d.kind:"item",asset=clean(d.asset_key,80),title=clean(d.title,30),price=Math.floor(+d.price||0);if(!asset||!title||price<0)return json({error:"물건과 가격을 확인해주세요."},400);
    if(kind==="item"){const inv=await env.DB.prepare("SELECT quantity,locked FROM inventory WHERE user_id=? AND item_key=?").bind(user.id,asset).first();if(!inv||inv.quantity-inv.locked<1)return json({error:"판매 가능한 수량이 없습니다."},400);await env.DB.prepare("UPDATE inventory SET locked=locked+1 WHERE user_id=? AND item_key=?").bind(user.id,asset).run()}
    else if(kind==="art"){let art=await env.DB.prepare("SELECT id FROM artworks WHERE id=? AND owner_id=?").bind(asset,user.id).first();if(!art&&Array.isArray(d.payload?.pixels)&&d.payload.pixels.length===1024){await env.DB.prepare("INSERT OR IGNORE INTO artworks(id,creator_id,owner_id,title,pixels,created_at) VALUES(?,?,?,?,?,?)").bind(asset,user.id,user.id,title,JSON.stringify(d.payload.pixels),now()).run();art={id:asset}}if(!art)return json({error:"소유한 그림이 아닙니다."},400)}
    await env.DB.prepare("INSERT INTO auctions(id,seller_id,kind,asset_key,title,payload,price,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(id(),user.id,kind,asset,title,JSON.stringify(d.payload||{}),price,now()).run();return json({ok:true});
  }
  if(path.match(/^\/api\/auctions\/[^/]+\/buy$/)&&method==="POST"){
    const auctionId=path.split("/")[3],a=await env.DB.prepare("SELECT * FROM auctions WHERE id=? AND status='active'").bind(auctionId).first();if(!a)return json({error:"이미 판매됐거나 취소된 물건입니다."},409);if(a.seller_id===user.id)return json({error:"자기 물건은 구매할 수 없습니다."},400);if(user.balance<a.price)return json({error:"코인이 부족합니다."},400);
    const week=now()-604800000,sum=await env.DB.prepare("SELECT COALESCE(SUM(gross),0) total FROM sales WHERE seller_id=? AND created_at>=?").bind(a.seller_id,week).first(),tax=taxFor(sum.total+a.price)-taxFor(sum.total),net=a.price-tax,t=now();
    const claim=await env.DB.prepare("UPDATE auctions SET status='sold',buyer_id=?,tax=?,sold_at=? WHERE id=? AND status='active'").bind(user.id,tax,t,a.id).run();if(!claim.meta.changes)return json({error:"다른 사용자가 먼저 구매했습니다."},409);
    await env.DB.batch([env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=?").bind(a.price,user.id),env.DB.prepare("INSERT INTO sales(id,seller_id,gross,tax,created_at) VALUES(?,?,?,?,?)").bind(id(),a.seller_id,a.price,tax,t)]);
    if(a.kind==="item")await env.DB.batch([env.DB.prepare("UPDATE inventory SET quantity=quantity-1,locked=MAX(0,locked-1) WHERE user_id=? AND item_key=?").bind(a.seller_id,a.asset_key),env.DB.prepare("INSERT INTO inventory(user_id,item_key,quantity) VALUES(?,?,1) ON CONFLICT(user_id,item_key) DO UPDATE SET quantity=quantity+1").bind(user.id,a.asset_key)]);else if(a.kind==="art")await env.DB.prepare("UPDATE artworks SET owner_id=?,trade_count=trade_count+1 WHERE id=?").bind(user.id,a.asset_key).run();await env.DB.prepare("INSERT INTO mailbox(id,user_id,body,amount,created_at) VALUES(?,?,?,?,?)").bind(id(),a.seller_id,`${a.title} 판매 완료 · 세금 ${tax}`,net,t).run();return json({ok:true,price:a.price,tax,received:net,kind:a.kind,asset_key:a.asset_key,payload:JSON.parse(a.payload||"{}")});
  }
  if(path.match(/^\/api\/auctions\/[^/]+\/cancel$/)&&method==="POST"){
    const auctionId=path.split("/")[3],a=await env.DB.prepare("SELECT * FROM auctions WHERE id=? AND seller_id=? AND status='active'").bind(auctionId,user.id).first();if(!a)return json({error:"취소할 수 없는 판매글입니다."},404);await env.DB.prepare("UPDATE auctions SET status='cancelled' WHERE id=? AND status='active'").bind(a.id).run();if(a.kind==="item")await env.DB.prepare("UPDATE inventory SET locked=MAX(0,locked-1) WHERE user_id=? AND item_key=?").bind(user.id,a.asset_key).run();return json({ok:true,kind:a.kind,asset_key:a.asset_key,payload:JSON.parse(a.payload||"{}")});
  }
  if(path==="/api/mailbox"&&method==="GET"){
    const rows=await env.DB.prepare("SELECT * FROM mailbox WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();return json({mail:rows.results});
  }
  if(path.match(/^\/api\/mailbox\/[^/]+\/claim$/)&&method==="POST"){
    const mailId=path.split("/")[3],m=await env.DB.prepare("SELECT * FROM mailbox WHERE id=? AND user_id=?").bind(mailId,user.id).first();if(!m||m.claimed)return json({error:"이미 확인한 우편입니다."},409);await env.DB.prepare("UPDATE mailbox SET claimed=1,read_at=? WHERE id=?").bind(now(),m.id).run();return json({ok:true,amount:m.amount||0});
  }
  if(path==="/api/guilds"&&method==="GET"){
    const rows=await env.DB.prepare("SELECT g.*,COUNT(m.user_id) members FROM guilds g LEFT JOIN guild_members m ON m.guild_id=g.id GROUP BY g.id ORDER BY g.level DESC,g.created_at LIMIT 50").all();return json({guilds:rows.results});
  }
  if(path==="/api/guilds/me"&&method==="GET"){
    const guild=await env.DB.prepare("SELECT g.*,m.role,m.contribution FROM guild_members m JOIN guilds g ON g.id=m.guild_id WHERE m.user_id=?").bind(user.id).first();if(!guild)return json({guild:null});const members=await env.DB.prepare("SELECT u.nickname,m.role,m.contribution,u.last_seen FROM guild_members m JOIN users u ON u.id=m.user_id WHERE m.guild_id=? ORDER BY m.role DESC,m.contribution DESC").bind(guild.id).all();return json({guild,members:members.results});
  }
  if(path==="/api/guilds"&&method==="POST"){
    const d=await body(req),name=clean(d.name,16),cost=1000000;if(name.length<2)return json({error:"길드 이름은 2글자 이상이어야 합니다."},400);if(user.balance<cost)return json({error:"길드 생성에 100만 코인이 필요합니다."},400);if(await env.DB.prepare("SELECT 1 ok FROM guild_members WHERE user_id=?").bind(user.id).first())return json({error:"이미 길드에 가입되어 있습니다."},409);const gid=id(),t=now();try{await env.DB.batch([env.DB.prepare("INSERT INTO guilds(id,name,owner_id,created_at) VALUES(?,?,?,?)").bind(gid,name,user.id,t),env.DB.prepare("INSERT INTO guild_members(guild_id,user_id,role,joined_at) VALUES(?,?,?,?)").bind(gid,user.id,"owner",t),env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=?").bind(cost,user.id)]);return json({ok:true,cost})}catch{return json({error:"이미 사용 중인 길드 이름입니다."},409)}
  }
  if(path.match(/^\/api\/guilds\/[^/]+\/join$/)&&method==="POST"){
    const gid=path.split("/")[3];if(await env.DB.prepare("SELECT 1 ok FROM guild_members WHERE user_id=?").bind(user.id).first())return json({error:"이미 길드에 가입되어 있습니다."},409);if(!await env.DB.prepare("SELECT 1 ok FROM guilds WHERE id=?").bind(gid).first())return json({error:"길드를 찾을 수 없습니다."},404);await env.DB.prepare("INSERT INTO guild_members(guild_id,user_id,role,joined_at) VALUES(?,?,?,?)").bind(gid,user.id,"member",now()).run();return json({ok:true});
  }
  if(path==="/api/coop"&&method==="POST"){
    const d=await body(req),mode=d.mode==="guild"?"guild":"duo",partner=clean(d.partner_id,50),cost=mode==="duo"?100000:500000;if(user.balance<cost)return json({error:`참가비 ${cost.toLocaleString()}코인이 필요합니다.`},400);let guildId=null;if(mode==="duo"&&!await areFriends(env,user.id,partner))return json({error:"친구만 2인 영지전에 초대할 수 있습니다."},403);if(mode==="guild"){const gm=await env.DB.prepare("SELECT guild_id FROM guild_members WHERE user_id=?").bind(user.id).first();if(!gm)return json({error:"길드 가입이 필요합니다."},403);guildId=gm.guild_id}const rid=id(),hp=mode==="guild"?200000:50000,t=now();await env.DB.batch([env.DB.prepare("INSERT INTO coop_raids(id,host_id,partner_id,guild_id,mode,enemy_hp,max_hp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(rid,user.id,mode==="duo"?partner:null,guildId,mode,hp,hp,t,t),env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=?").bind(cost,user.id)]);return json({ok:true,id:rid,cost});
  }
  if(path==="/api/coop"&&method==="GET"){
    const gm=await env.DB.prepare("SELECT guild_id FROM guild_members WHERE user_id=?").bind(user.id).first(),rows=await env.DB.prepare("SELECT * FROM coop_raids WHERE (host_id=? OR partner_id=? OR (guild_id IS NOT NULL AND guild_id=?)) AND status!='closed' ORDER BY updated_at DESC LIMIT 20").bind(user.id,user.id,gm?.guild_id||"").all();return json({raids:rows.results});
  }
  if(path.match(/^\/api\/coop\/[^/]+\/attack$/)&&method==="POST"){
    const raidId=path.split("/")[3],r=await env.DB.prepare("SELECT * FROM coop_raids WHERE id=? AND status!='closed'").bind(raidId).first();if(!r)return json({error:"종료된 협력전입니다."},404);const gm=r.guild_id?await env.DB.prepare("SELECT 1 ok FROM guild_members WHERE guild_id=? AND user_id=?").bind(r.guild_id,user.id).first():null;if(r.host_id!==user.id&&r.partner_id!==user.id&&!gm)return json({error:"참가자가 아닙니다."},403);const d=await body(req),damage=Math.max(100,Math.min(25000,Math.floor(+d.damage||100))),left=Math.max(0,r.enemy_hp-damage),done=left<=0,t=now(),hit=await env.DB.prepare("UPDATE coop_raids SET enemy_hp=?,status=?,updated_at=? WHERE id=? AND status!='closed'").bind(left,done?"closed":"active",t,r.id).run();if(!hit.meta.changes)return json({error:"이미 종료된 협력전입니다."},409);if(done){const ids=r.mode==="duo"?[r.host_id,r.partner_id].filter(Boolean):(await env.DB.prepare("SELECT user_id FROM guild_members WHERE guild_id=?").bind(r.guild_id).all()).results.map(x=>x.user_id);for(const uid of ids)await env.DB.prepare("INSERT INTO mailbox(id,user_id,body,amount,created_at) VALUES(?,?,?,?,?)").bind(id(),uid,"협력 영지전 승리 보상",500000,t).run()}return json({ok:true,enemy_hp:left,max_hp:r.max_hp,done,reward:done?500000:0});
  }
  if(path==="/api/rankings"){
    const rows=await env.DB.prepare(`SELECT u.nickname,r.*, (LOG(MAX(r.assets,1))*30+r.hamlet*20+r.territory*20+r.collection*15+r.rare_items*10+r.achievements*5) score FROM rankings r JOIN users u ON u.id=r.user_id ORDER BY score DESC LIMIT 100`).all();return json({rankings:rows.results});
  }
  return json({error:"없는 API입니다."},404);
}

export default {async fetch(req,env){const url=new URL(req.url);if(url.pathname.startsWith("/api/"))return api(req,env,url);return env.ASSETS.fetch(req)}};
