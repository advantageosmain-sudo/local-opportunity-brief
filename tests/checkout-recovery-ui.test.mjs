import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness(fetcher) {
 const code=ts.transpileModule(readFileSync(new URL('../components/checkout-recovery.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const slots=[],requests=[],listeners=new Map();let hook=0;
 const react={useState(initial){const i=hook++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=v;}];},useRef(initial){const i=hook++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn){const i=hook++;if(!(i in slots)){slots[i]=true;fn();}}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};const exports={};
 vm.runInNewContext(code,{exports,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;throw Error(name);},fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return fetcher();},window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}});
 const flatten=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(flatten):[n,...flatten(n.props?.children)];
 const render=()=>{hook=0;return flatten(exports.CheckoutRecovery());};
 return {requests,button:()=>render().find(n=>n.type==='button'),message:()=>render().find(n=>n.props?.role==='status').props.children,leave:()=>listeners.get('pagehide')(),back:()=>listeners.get('pageshow')({persisted:true})};
}
const response=(status=200,body={status:'recovered',message:'Recovered without checkout.'})=>({ok:status>=200&&status<300,json:async()=>body});
test('recovery button suppresses double clicks and never opens a new checkout',async()=>{
 let finish;const pending=new Promise(r=>{finish=r;});const h=harness(()=>pending);
 const click=h.button().props.onClick;const a=click();const b=click();assert.equal(h.button().props.disabled,true);assert.equal(h.requests.length,1);
 finish(response());await Promise.all([a,b]);assert.equal(h.button().props.disabled,true);assert.equal(h.message(),'Recovered without checkout.');
 await h.button().props.onClick();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/owner/stripe-checkout-recovery');assert.equal(h.requests[0].body.attemptId,'71bb3487-c303-4a48-bc7f-9ea91a2f6488');
});
test('permission/provider failure leaves retry available and shows no success',async()=>{
 const h=harness(()=>response(503,{error:'Provider cannot be verified.'}));await h.button().props.onClick();assert.equal(h.button().props.disabled,false);assert.equal(h.message(),'Provider cannot be verified.');
});
test('malformed success and failed network never claim recovery',async()=>{
 for(const result of [()=>response(200,{url:'https://checkout.stripe.com/x'}),()=>{throw new Error('offline');}]){const h=harness(result);await h.button().props.onClick();assert.equal(h.button().props.disabled,false);assert.doesNotMatch(h.message(),/^Recovered/);}
});
test('Back restores button and ignores a stale in-flight response',async()=>{
 let finish;const pending=new Promise(r=>{finish=r;});let n=0;const h=harness(()=>++n===1?pending:response(200,{status:'already_recovered',message:'Previously recovered.'}));
 const action=h.button().props.onClick();h.leave();h.back();assert.equal(h.button().props.disabled,false);finish(response());await action;assert.match(h.message(),/Returned to recovery/);
 await h.button().props.onClick();assert.equal(h.message(),'Previously recovered.');assert.equal(h.button().props.disabled,true);
});
