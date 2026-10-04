// Svix's documented standard: HMAC-SHA256(id + '.' + timestamp + '.' + raw body).
// https://docs.svix.com/receiving/verifying-payloads/how-manual
// No API key, provider read, or secret generation occurs here.
export async function readBoundedBody(request: Request, maxBytes = 32768) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('BODY_LIMIT');
  if (!request.body) return '';
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  let timedOut=false;let timeout:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{timedOut=true;reject(new Error('BODY_TIMEOUT'));void reader.cancel().catch(()=>{});},5000);});
  try {
    while(true){const {done,value}=await Promise.race([reader.read(),deadline]);if(timedOut)throw new Error('BODY_TIMEOUT');if(done)break;size+=value.byteLength;if(size>maxBytes){void reader.cancel().catch(()=>{});throw new Error('BODY_LIMIT');}chunks.push(value);}
  } finally {clearTimeout(timeout);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
}
function decode64(value:string) {
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length%4!==0)throw new Error('Invalid base64');
  const binary=atob(value);return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
export async function verifyResendSignature(raw:string,headers:Headers,secret:string,now=Date.now()) {
  const id=headers.get('svix-id')??'',timestamp=headers.get('svix-timestamp')??'',signatures=headers.get('svix-signature')??'';
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||signatures.length>1024)throw new Error('Invalid signature');
  if(!secret.startsWith('whsec_')||secret.length>256)throw new Error('Invalid secret');
  const keyBytes=decode64(secret.slice(6));if(keyBytes.length===0)throw new Error('Invalid secret');
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=new TextEncoder().encode(`${id}.${timestamp}.${raw}`);
  const tokens=signatures.split(' ');if(tokens.length>8)throw new Error('Invalid signature');
  for(const token of tokens){if(!token.startsWith('v1,'))continue;try{const signature=decode64(token.slice(3));if(signature.length===32&&await crypto.subtle.verify('HMAC',key,signature,bytes))return id;}catch{/* malformed candidates never validate */}}
  throw new Error('Invalid signature');
}
export async function sha256(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
