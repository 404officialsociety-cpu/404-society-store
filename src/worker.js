const json = (data, status=200) => new Response(JSON.stringify(data), {
  status, headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});

const DEMO = {
  "tee-01": {name:"ERROR 404 TEE", price:1299},
  "tee-02": {name:"SYSTEM OVERSIZED TEE", price:1499},
  "hoodie-01": {name:"NULL HOODIE", price:2299},
  "tee-03": {name:"GLITCH CLUB TEE", price:1399},
  "oversize-02": {name:"OFFLINE OVERSIZED", price:1599},
  "hoodie-02": {name:"NOT FOUND HOODIE", price:2499}
};

function envMode(env){ return env.CASHFREE_ENV === "production" ? "production" : "sandbox"; }
function cashfreeBase(env){
  return envMode(env) === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}
function uuid(){ return crypto.randomUUID(); }

async function createCashfreeOrder(env, order, origin){
  if(!env.CASHFREE_CLIENT_ID || !env.CASHFREE_CLIENT_SECRET){
    return {configured:false, message:"Cashfree is not configured. Add the Worker secrets before accepting live payments."};
  }
  const apiVersion = env.CASHFREE_API_VERSION || "2025-01-01";
  const payload = {
    order_id: order.id,
    order_amount: order.amount / 100,
    order_currency: "INR",
    customer_details: {
      customer_id: order.id,
      customer_name: order.customer.name,
      customer_email: order.customer.email,
      customer_phone: order.customer.phone
    },
    order_meta: {
      return_url: `${origin}/?payment=return&order_id=${encodeURIComponent(order.id)}`
    }
  };
  const r = await fetch(`${cashfreeBase(env)}/orders`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-client-id":env.CASHFREE_CLIENT_ID,
      "x-client-secret":env.CASHFREE_CLIENT_SECRET,
      "x-api-version":apiVersion
    },
    body:JSON.stringify(payload)
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.message || "Cashfree order creation failed");
  return {configured:true,payment_session_id:data.payment_session_id,mode:envMode(env)};
}

async function saveOrder(env, order, cashfree){
  if(!env.DB) return;
  await env.DB.prepare(`INSERT INTO orders
    (id,cashfree_order_id,customer_name,customer_email,customer_phone,amount,currency,items_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(order.id, cashfree?.order_id || null, order.customer.name, order.customer.email,
      order.customer.phone, order.amount, "INR", JSON.stringify(order.items),
      "created", order.createdAt, order.createdAt).run();
}

async function handleCreatePayment(request, env, origin){
  const body=await request.json();
  const customer=body.customer||{};
  const items=Array.isArray(body.items)?body.items:[];
  if(!customer.name||!customer.email||!customer.phone||!items.length) return json({error:"Missing checkout details"},400);

  // Server-side price calculation: never trust prices sent by the browser.
  const safeItems=items.map(x=>{
    const p=DEMO[x.productId];
    const qty=Math.max(1,Math.min(20,Number(x.quantity)||1));
    if(!p) throw new Error(`Unknown product: ${x.productId}`);
    return {productId:x.productId,name:p.name,quantity:qty,unitPrice:p.price};
  });
  const amount=safeItems.reduce((sum,x)=>sum+x.unitPrice*x.quantity,0);
  const order={id:`404_${Date.now()}_${uuid().slice(0,8)}`,customer,items:safeItems,amount:amount*100,createdAt:new Date().toISOString()};
  const cf=await createCashfreeOrder(env,order,origin);
  if(cf.configured) await saveOrder(env,order,cf);
  return json({...cf,order_id:order.id});
}

async function handlePaymentStatus(request, env){
  const u=new URL(request.url), id=u.searchParams.get("order_id");
  if(!id) return json({error:"order_id required"},400);
  if(!env.CASHFREE_CLIENT_ID||!env.CASHFREE_CLIENT_SECRET) return json({status:"not_configured"});
  const r=await fetch(`${cashfreeBase(env)}/orders/${encodeURIComponent(id)}`,{
    headers:{
      "x-client-id":env.CASHFREE_CLIENT_ID,
      "x-client-secret":env.CASHFREE_CLIENT_SECRET,
      "x-api-version":env.CASHFREE_API_VERSION||"2025-01-01"
    }
  });
  const data=await r.json().catch(()=>({}));
  return json(data,r.status);
}

async function handleQikink(request, env){
  // Intentionally isolated. Do not guess or expose a Qikink credential/payload in the browser.
  // Configure this adapter from the API specification enabled for your Qikink account.
  if(!env.QIKINK_API_BASE || !env.QIKINK_API_KEY || !env.QIKINK_API_SECRET)
    return json({error:"Qikink fulfillment is not configured. Add its server-side secrets and map the account's current order API payload in src/worker.js."},501);
  return json({error:"Qikink adapter placeholder: connect the exact order endpoint/payload from your Qikink account before enabling live fulfillment."},501);
}

async function handleWebhook(request, env){
  // Keep webhook verification/processing server-side. Add the signature verification
  // required by your current Cashfree account/API documentation before going live.
  const body=await request.text();
  let data={};try{data=JSON.parse(body)}catch{}
  if(env.DB && data.order_id){
    await env.DB.prepare(`UPDATE orders SET status=?,updated_at=? WHERE cashfree_order_id=? OR id=?`)
      .bind(data.order_status||data.payment_status||"updated",new Date().toISOString(),data.order_id,data.order_id).run();
  }
  return json({ok:true});
}

export default {
  async fetch(request, env, ctx){
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/create-payment" && request.method==="POST") return await handleCreatePayment(request,env,url.origin);
      if(url.pathname==="/api/payment-status" && request.method==="GET") return await handlePaymentStatus(request,env);
      if(url.pathname==="/api/qikink-order" && request.method==="POST") return await handleQikink(request,env);
      if(url.pathname==="/api/cashfree-webhook" && request.method==="POST") return await handleWebhook(request,env);
      return env.ASSETS.fetch(request);
    }catch(e){
      console.error(e);
      return json({error:e.message||"Server error"},500);
    }
  }
};
