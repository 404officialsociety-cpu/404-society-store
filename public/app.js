const PRODUCTS=[
{id:"tee-01",name:"ERROR 404 TEE",category:"T-Shirts",price:1299,tag:"SIGNAL LOST",accent:"pink"},
{id:"tee-02",name:"SYSTEM OVERSIZED TEE",category:"Oversized T-Shirts",price:1499,tag:"NO DEFAULT",accent:"cyan"},
{id:"hoodie-01",name:"NULL HOODIE",category:"Hoodies",price:2299,tag:"ACCESS DENIED",accent:"lime"},
{id:"tee-03",name:"GLITCH CLUB TEE",category:"T-Shirts",price:1399,tag:"404 CLUB",accent:"purple"},
{id:"oversize-02",name:"OFFLINE OVERSIZED",category:"Oversized T-Shirts",price:1599,tag:"STAY UNKNOWN",accent:"pink"},
{id:"hoodie-02",name:"NOT FOUND HOODIE",category:"Hoodies",price:2499,tag:"RELOAD",accent:"cyan"}
];
let cart=JSON.parse(localStorage.getItem("404-cart")||"[]");
const money=n=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n);
const $=s=>document.querySelector(s);
function art(p){return `<div class="product-art"><div class="shape" style="background:var(--${p.accent})"></div><span>404</span></div>`}
function renderProducts(category="All"){
  const list=category==="All"?PRODUCTS:PRODUCTS.filter(p=>p.category===category);
  $("#productGrid").innerHTML=list.map(p=>`<article class="product">${art(p)}<div class="product-info"><h3>${p.name}</h3><div class="meta">${p.category} · ${p.tag}</div><div class="price">${money(p.price)}</div><button class="add" onclick="add('${p.id}')">Add to bag</button></div></article>`).join("");
}
function renderFilters(){
 const cats=["All",...new Set(PRODUCTS.map(p=>p.category))];
 $("#filters").innerHTML=cats.map(c=>`<button class="filter ${c==="All"?"active":""}" onclick="filterProducts('${c}',this)">${c}</button>`).join("");
}
window.filterProducts=(c,el)=>{document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));el.classList.add("active");renderProducts(c)};
window.add=id=>{const p=PRODUCTS.find(x=>x.id===id),row=cart.find(x=>x.id===id);row?row.qty++:cart.push({id,qty:1});save();openCart()};
window.changeQty=(id,d)=>{const x=cart.find(i=>i.id===id);if(!x)return;x.qty+=d;if(x.qty<=0)cart=cart.filter(i=>i.id!==id);save();renderCart()};
function save(){localStorage.setItem("404-cart",JSON.stringify(cart));renderCart()}
function renderCart(){
 $("#cartCount").textContent=cart.reduce((a,x)=>a+x.qty,0);
 $("#cartItems").innerHTML=cart.length?cart.map(x=>{const p=PRODUCTS.find(i=>i.id===x.id);return `<div class="cart-row"><div class="mini">${p.name.split(" ")[0]}</div><div><b>${p.name}</b><div class="meta">${money(p.price)} × ${x.qty}</div><div class="qty"><button onclick="changeQty('${p.id}',-1)">−</button> <button onclick="changeQty('${p.id}',1)">+</button></div></div><b>${money(p.price*x.qty)}</b></div>`}).join(""):`<p class="meta">Your bag is empty. Add something loud.</p>`;
 $("#cartTotal").textContent=money(cart.reduce((a,x)=>a+PRODUCTS.find(p=>p.id===x.id).price*x.qty,0));
}
function openCart(){$("#drawer").classList.add("open");$("#backdrop").classList.add("open");$("#drawer").setAttribute("aria-hidden","false")}
function closeCart(){$("#drawer").classList.remove("open");$("#backdrop").classList.remove("open")}
$("#cartButton").onclick=openCart;$("#closeCart").onclick=closeCart;$("#backdrop").onclick=closeCart;
$("#checkoutButton").onclick=()=>{if(!cart.length)return alert("Your bag is empty.");$("#checkoutModal").classList.add("open");closeCart()};
$("#closeModal").onclick=()=>$("#checkoutModal").classList.remove("open");
$("#checkoutForm").onsubmit=async e=>{
 e.preventDefault();const msg=$("#checkoutMessage");msg.textContent="Creating secure payment…";
 const fd=new FormData(e.target);const items=cart.map(x=>({productId:x.id,name:PRODUCTS.find(p=>p.id===x.id).name,quantity:x.qty,unitPrice:PRODUCTS.find(p=>p.id===x.id).price}));
 try{
  const r=await fetch("/api/create-payment",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({customer:{name:fd.get("name"),email:fd.get("email"),phone:fd.get("phone")},items})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||"Could not create payment");
  if(data.payment_session_id && window.Cashfree){
    const cashfree=Cashfree({mode:data.mode||"sandbox"});
    cashfree.checkout({paymentSessionId:data.payment_session_id,redirectTarget:"_self"});
  }else throw new Error(data.message||"Payment gateway is not configured yet.");
 }catch(err){msg.textContent=err.message}
};
renderFilters();renderProducts();renderCart();
