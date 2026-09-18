const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
function envMode(env){return env.CASHFREE_ENV==="production"?"production":"sandbox"}
function cashfreeBase(env){return envMode(env)==="production"?"https://api.cashfree.com/pg":"https://sandbox.cashfree.com/pg"}
function uuid(){return crypto.randomUUID()}
let shopifyToken=null,shopifyTokenExpiresAt=0;
async function getShopifyToken(env){
 if(!env.SHOPIFY_SHOP||!env.SHOPIFY_CLIENT_ID||!env.SHOPIFY_CLIENT_SECRET)throw Error("Shopify is not configured. Add SHOPIFY_SHOP, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.");
 if(shopifyToken&&Date.now()<shopifyTokenExpiresAt-60000)return shopifyToken;
 const r=await fetch(`https://${env.SHOPIFY_SHOP}.myshopify.com/admin/oauth/access_token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:env.SHOPIFY_CLIENT_ID,client_secret:env.SHOPIFY_CLIENT_SECRET})});
 const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw Error(d.error_description||d.error||"Shopify authentication failed");
 shopifyToken=d.access_token;shopifyTokenExpiresAt=Date.now()+Number(d.expires_in||86399)*1000;return shopifyToken;
}
async function shopifyGraphQL(env,query,variables={}){
 const r=await fetch(`https://${env.SHOPIFY_SHOP}.myshopify.com/admin/api/2026-07/graphql.json`,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":await getShopifyToken(env)},body:JSON.stringify({query,variables})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(`Shopify API returned ${r.status}`);if(d.errors?.length)throw Error(d.errors.map(x=>x.message).join("; "));return d.data;
}
async function getShopifyProducts(env){
 const q=`query Products{products(first:100,query:"status:active"){nodes{id title handle productType tags description images(first:1){nodes{url altText}} variants(first:100){nodes{id title sku price availableForSale selectedOptions{name value} image{url altText}}}}}}`;
 const d=await shopifyGraphQL(env,q);
 return(d.products?.nodes||[]).map(p=>({id:p.id,title:p.title,handle:p.handle,productType:p.productType,tags:p.tags||[],description:p.description||"",image:p.images?.nodes?.[0]?.url||"",variants:(p.variants?.nodes||[]).map(v=>({id:v.id,title:v.title,sku:v.sku||"",price:Number(v.price),availableForSale:!!v.availableForSale,selectedOptions:v.selectedOptions||[],image:v.image?.url||""}))}));
}
async function handleProducts(env){return json({products:await getShopifyProducts(env)})}
async function createCashfreeOrder(env,order,origin){
 if(!env.CASHFREE_CLIENT_ID||!env.CASHFREE_CLIENT_SECRET)return{configured:false,message:"Cashfree is not configured."};
 const payload={order_id:order.id,order_amount:order.amount/100,order_currency:"INR",customer_details:{customer_id:order.id,customer_name:order.customer.name,customer_email:order.customer.email,customer_phone:order.customer.phone},order_meta:{return_url:`${origin}/?payment=return&order_id=${encodeURIComponent(order.id)}`}};
 const r=await fetch(`${cashfreeBase(env)}/orders`,{method:"POST",headers:{"Content-Type":"application/json","x-client-id":env.CASHFREE_CLIENT_ID,"x-client-secret":env.CASHFREE_CLIENT_SECRET,"x-api-version":env.CASHFREE_API_VERSION||"2025-01-01"},body:JSON.stringify(payload)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"Cashfree order creation failed");return{configured:true,payment_session_id:d.payment_session_id,mode:envMode(env),cashfree_order_id:d.order_id};
}
async function saveOrder(env,o,cf){if(!env.DB)return;await env.DB.prepare(`INSERT INTO orders(id,cashfree_order_id,customer_name,customer_email,customer_phone,amount,currency,items_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(o.id,cf?.cashfree_order_id||null,o.customer.name,o.customer.email,o.customer.phone,o.amount,"INR",JSON.stringify(o.items),"created",o.createdAt,o.createdAt).run()}
async function handleCreatePayment(request,env,origin){
 const b=await request.json(),customer=b.customer||{},items=Array.isArray(b.items)?b.items:[];if(!customer.name||!customer.email||!customer.phone||!items.length)return json({error:"Missing checkout details"},400);
 const products=await getShopifyProducts(env),vars=new Map();for(const p of products)for(const v of p.variants)vars.set(v.id,{productId:p.id,name:p.title,variantTitle:v.title,sku:v.sku,price:v.price,availableForSale:v.availableForSale});
 const safe=[];for(const x of items){const v=vars.get(x.variantId),qty=Math.max(1,Math.min(20,Number(x.quantity)||1));if(!v)throw Error("A selected Shopify variant no longer exists.");if(!v.availableForSale)throw Error(`${v.name} / ${v.variantTitle} is sold out.`);safe.push({productId:v.productId,variantId:x.variantId,name:v.name,variantTitle:v.variantTitle,sku:v.sku,quantity:qty,unitPrice:v.price})}
 const rupees=safe.reduce((s,x)=>s+x.unitPrice*x.quantity,0),o={id:`404_${Date.now()}_${uuid().slice(0,8)}`,customer,items:safe,amount:Math.round(rupees*100),createdAt:new Date().toISOString()},cf=await createCashfreeOrder(env,o,origin);if(cf.configured)await saveOrder(env,o,cf);return json({...cf,order_id:o.id});
}
async function handlePaymentStatus(request,env){const id=new URL(request.url).searchParams.get("order_id");if(!id)return json({error:"order_id required"},400);if(!env.CASHFREE_CLIENT_ID||!env.CASHFREE_CLIENT_SECRET)return json({status:"not_configured"});const r=await fetch(`${cashfreeBase(env)}/orders/${encodeURIComponent(id)}`,{headers:{"x-client-id":env.CASHFREE_CLIENT_ID,"x-client-secret":env.CASHFREE_CLIENT_SECRET,"x-api-version":env.CASHFREE_API_VERSION||"2025-01-01"}});return json(await r.json().catch(()=>({})),r.status)}
async function handleQikink(request,env){return json({error:"Qikink fulfillment is not enabled yet. Complete Shopify/Qikink SKU mapping and fulfillment testing first."},501)}
async function handleWebhook(request,env){const body=await request.text();let d={};try{d=JSON.parse(body)}catch{}if(env.DB&&d.order_id)await env.DB.prepare(`UPDATE orders SET status=?,updated_at=? WHERE cashfree_order_id=? OR id=?`).bind(d.order_status||d.payment_status||"updated",new Date().toISOString(),d.order_id,d.order_id).run();return json({ok:true})}
export default{async fetch(request,env){const u=new URL(request.url);try{if(u.pathname==="/api/products"&&request.method==="GET")return await handleProducts(env);if(u.pathname==="/api/create-payment"&&request.method==="POST")return await handleCreatePayment(request,env,u.origin);if(u.pathname==="/api/payment-status"&&request.method==="GET")return await handlePaymentStatus(request,env);if(u.pathname==="/api/qikink-order"&&request.method==="POST")return await handleQikink(request,env);if(u.pathname==="/api/cashfree-webhook"&&request.method==="POST")return await handleWebhook(request,env);return env.ASSETS.fetch(request)}catch(e){console.error(e);return json({error:e.message||"Server error"},500)}}};
