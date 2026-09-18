const state={products:[],filter:"All",cart:JSON.parse(localStorage.getItem("404_cart")||"[]")};
const $=s=>document.querySelector(s);
const money=n=>`₹${Number(n||0).toLocaleString("en-IN")}`;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function saveCart(){localStorage.setItem("404_cart",JSON.stringify(state.cart));renderCart()}
function categories(){const s=new Set();state.products.forEach(p=>{if(p.productType)s.add(p.productType);(p.tags||[]).forEach(t=>s.add(t))});return["All",...Array.from(s).slice(0,8)]}
function renderFilters(){const el=$("#filters");el.innerHTML=categories().map(c=>`<button class="${c===state.filter?"active":""}" data-filter="${esc(c)}">${esc(c)}</button>`).join("");el.querySelectorAll("button").forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;renderFilters();renderProducts()})}
function renderProducts(){
 const grid=$("#productGrid"), products=state.products.filter(p=>state.filter==="All"||p.productType===state.filter||(p.tags||[]).includes(state.filter));
 if(!products.length){grid.innerHTML='<p class="message">No Shopify products match this filter.</p>';return}
 grid.innerHTML=products.map(p=>{const v=p.variants?.[0];return `<article class="product-card">
 <div class="product-image">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy">`:'<div class="product-placeholder">404</div>'}</div>
 <div class="product-info"><p class="eyebrow">${esc(p.productType||"404 SOCIETY")}</p><h3>${esc(p.title)}</h3><p class="product-price">${money(v?.price)}</p>
 ${p.variants?.length>1?`<label class="variant-picker"><span>Variant</span><select data-variant-for="${esc(p.id)}">${p.variants.map(x=>`<option value="${esc(x.id)}" ${x.availableForSale?"":"disabled"}>${esc(x.title)}${x.availableForSale?"":" — Sold out"}</option>`).join("")}</select></label>`:""}
 <button class="add-button" data-add="${esc(p.id)}">Add to bag</button></div></article>`}).join("");
 grid.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{const p=state.products.find(x=>x.id===b.dataset.add);const sel=grid.querySelector(`[data-variant-for="${CSS.escape(p.id)}"]`);const v=p.variants.find(x=>x.id===(sel?.value||p.variants[0]?.id));if(!v?.availableForSale)return;addToCart(p,v)})
}
function addToCart(p,v){const x=state.cart.find(i=>i.variantId===v.id);if(x)x.quantity=Math.min(20,x.quantity+1);else state.cart.push({productId:p.id,variantId:v.id,title:p.title,variantTitle:v.title,image:v.image||p.image||"",price:Number(v.price),quantity:1});saveCart();openCart()}
function renderCart(){const count=state.cart.reduce((n,x)=>n+x.quantity,0);$("#cartCount").textContent=count;$("#cartItems").innerHTML=state.cart.length?state.cart.map((x,i)=>`<div class="cart-item">${x.image?`<img src="${esc(x.image)}" alt="">`:""}<div><strong>${esc(x.title)}</strong><small>${esc(x.variantTitle)}</small><div>${money(x.price)} × ${x.quantity}</div><button data-remove="${i}">Remove</button></div></div>`).join(""):'<p class="message">Your bag is empty.</p>';$("#cartTotal").textContent=money(state.cart.reduce((n,x)=>n+x.price*x.quantity,0));document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{state.cart.splice(Number(b.dataset.remove),1);saveCart()})}
function openCart(){$("#drawer").classList.add("open");$("#drawer").setAttribute("aria-hidden","false");$("#backdrop").classList.add("show")}
function closeCart(){$("#drawer").classList.remove("open");$("#drawer").setAttribute("aria-hidden","true");$("#backdrop").classList.remove("show")}
async function loadProducts(){try{const r=await fetch("/api/products",{cache:"no-store"}),d=await r.json();if(!r.ok)throw Error(d.error||"Could not load Shopify products");state.products=d.products||[];renderFilters();renderProducts()}catch(e){console.error(e);$("#productGrid").innerHTML=`<p class="message">Shopify products could not be loaded. ${esc(e.message)}</p>`}}
$("#cartButton").onclick=openCart;$("#closeCart").onclick=closeCart;$("#backdrop").onclick=closeCart;
$("#checkoutButton").onclick=()=>{$("#checkoutModal").classList.add("open");$("#checkoutModal").setAttribute("aria-hidden","false");$("#checkoutMessage").textContent=""};
$("#closeModal").onclick=()=>{$("#checkoutModal").classList.remove("open");$("#checkoutModal").setAttribute("aria-hidden","true")};
$("#checkoutForm").onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector("button[type=submit]"),msg=$("#checkoutMessage");btn.disabled=true;msg.textContent="Creating secure payment…";try{const f=new FormData(e.target),payload={customer:{name:f.get("name"),email:f.get("email"),phone:f.get("phone")},items:state.cart.map(x=>({variantId:x.variantId,quantity:x.quantity}))};const r=await fetch("/api/create-payment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok)throw Error(d.error||"Payment setup failed");if(!d.payment_session_id||!window.Cashfree)throw Error("Cashfree payment session was not returned.");const cf=Cashfree({mode:d.mode==="production"?"production":"sandbox"});await cf.checkout({paymentSessionId:d.payment_session_id,redirectTarget:"_self"})}catch(e){console.error(e);msg.textContent=e.message;btn.disabled=false}};
renderCart();loadProducts();
