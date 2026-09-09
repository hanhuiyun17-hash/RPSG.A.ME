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
  if(path==="/api/auctions"&&method==="POST"){
    const d=await body(req),kind=d.kind==="art"?"art":"item",asset=clean(d.asset_key,80),title=clean(d.title,30),price=Math.floor(+d.price||0);if(!asset||!title||price<1)return json({error:"물건과 가격을 확인해주세요."},400);
    if(kind==="item"){const inv=await env.DB.prepare("SELECT quantity,locked FROM inventory WHERE user_id=? AND item_key=?").bind(user.id,asset).first();if(!inv||inv.quantity-inv.locked<1)return json({error:"판매 가능한 수량이 없습니다."},400);await env.DB.prepare("UPDATE inventory SET locked=locked+1 WHERE user_id=? AND item_key=?").bind(user.id,asset).run()}
    else{let art=await env.DB.prepare("SELECT id FROM artworks WHERE id=? AND owner_id=?").bind(asset,user.id).first();if(!art&&Array.isArray(d.payload?.pixels)&&d.payload.pixels.length===1024){await env.DB.prepare("INSERT OR IGNORE INTO artworks(id,creator_id,owner_id,title,pixels,created_at) VALUES(?,?,?,?,?,?)").bind(asset,user.id,user.id,title,JSON.stringify(d.payload.pixels),now()).run();art={id:asset}}if(!art)return json({error:"소유한 그림이 아닙니다."},400)}
    await env.DB.prepare("INSERT INTO auctions(id,seller_id,kind,asset_key,title,payload,price,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(id(),user.id,kind,asset,title,JSON.stringify(d.payload||{}),price,now()).run();return json({ok:true});
  }
  if(path.match(/^\/api\/auctions\/[^/]+\/buy$/)&&method==="POST"){
    const auctionId=path.split("/")[3],a=await env.DB.prepare("SELECT * FROM auctions WHERE id=? AND status='active'").bind(auctionId).first();if(!a)return json({error:"이미 판매됐거나 취소된 물건입니다."},409);if(a.seller_id===user.id)return json({error:"자기 물건은 구매할 수 없습니다."},400);if(user.balance<a.price)return json({error:"코인이 부족합니다."},400);
    const week=now()-604800000,sum=await env.DB.prepare("SELECT COALESCE(SUM(gross),0) total FROM sales WHERE seller_id=? AND created_at>=?").bind(a.seller_id,week).first(),tax=taxFor(sum.total+a.price)-taxFor(sum.total),net=a.price-tax,t=now();
    const claim=await env.DB.prepare("UPDATE auctions SET status='sold',buyer_id=?,tax=?,sold_at=? WHERE id=? AND status='active'").bind(user.id,tax,t,a.id).run();if(!claim.meta.changes)return json({error:"다른 사용자가 먼저 구매했습니다."},409);
    await env.DB.batch([env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=?").bind(a.price,user.id),env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(net,a.seller_id),env.DB.prepare("INSERT INTO sales(id,seller_id,gross,tax,created_at) VALUES(?,?,?,?,?)").bind(id(),a.seller_id,a.price,tax,t)]);
    if(a.kind==="item")await env.DB.batch([env.DB.prepare("UPDATE inventory SET quantity=quantity-1,locked=MAX(0,locked-1) WHERE user_id=? AND item_key=?").bind(a.seller_id,a.asset_key),env.DB.prepare("INSERT INTO inventory(user_id,item_key,quantity) VALUES(?,?,1) ON CONFLICT(user_id,item_key) DO UPDATE SET quantity=quantity+1").bind(user.id,a.asset_key)]);else await env.DB.prepare("UPDATE artworks SET owner_id=?,trade_count=trade_count+1 WHERE id=?").bind(user.id,a.asset_key).run();return json({ok:true,tax,received:net});
  }
  if(path==="/api/rankings"){
    const rows=await env.DB.prepare(`SELECT u.nickname,r.*, (LOG(MAX(r.assets,1))*30+r.hamlet*20+r.territory*20+r.collection*15+r.rare_items*10+r.achievements*5) score FROM rankings r JOIN users u ON u.id=r.user_id ORDER BY score DESC LIMIT 100`).all();return json({rankings:rows.results});
  }
  return json({error:"없는 API입니다."},404);
}

export default {async fetch(req,env){const url=new URL(req.url);if(url.pathname.startsWith("/api/"))return api(req,env,url);return env.ASSETS.fetch(req)}};
