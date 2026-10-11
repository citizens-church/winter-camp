import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configured,validate,sendInterest} from '../form-core.js';
const valid={parentName:'Example Parent',email:'parent@example.invalid',phone:'',interest:'interested',consent:true};
test('blank config fails closed',()=>assert.equal(configured({endpoint:'',turnstileSiteKey:''}),false));
test('only credential-free HTTPS interest endpoint enabled',()=>{assert.equal(configured({endpoint:'https://camp.example/interest',turnstileSiteKey:'public'}),true);for(const endpoint of ['http://camp.example/interest','https://user:password@camp.example/interest','https://camp.example/no'])assert.equal(configured({endpoint,turnstileSiteKey:'public'}),false)});
test('minimal valid parent data accepted',()=>assert.deepEqual(validate(valid),{}));
test('invalid contact and absent consent rejected',()=>{const e=validate({...valid,parentName:'',email:'bad',phone:'<script>',consent:false});assert.deepEqual(Object.keys(e),['parentName','email','phone','consent'])});
test('overlong fields and invalid interest rejected',()=>{assert.equal(Object.keys(validate({...valid,parentName:'a'.repeat(121),email:'a'.repeat(255),phone:'1'.repeat(33),interest:'other'})).length,4)});
test('only explicit server success displays success',async()=>{assert.equal(await sendInterest('https://example.invalid/interest',valid,async()=>new Response('{"ok":true}',{status:200})),true);for(const response of [new Response('{}'),new Response('html'),new Response('{"ok":true}',{status:500})])await assert.rejects(sendInterest('https://example.invalid',valid,async()=>response))});
test('rate limit and network errors are actionable',async()=>{await assert.rejects(sendInterest('https://example.invalid',valid,async()=>new Response('{}',{status:429})),/wait/);await assert.rejects(sendInterest('https://example.invalid',valid,async()=>{throw new TypeError('network')}),/connection/)});
test('no credentials or redirects in submission',async()=>{await sendInterest('https://example.invalid',valid,async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),valid);return new Response('{"ok":true}')})});
test('sign-up links to the Brushfire interest event',async()=>{const h=await readFile(new URL('../index.html',import.meta.url),'utf8');assert.match(h,/January 29–31/);assert.match(h,/href="https:\/\/citizenschurch\.brushfire\.com\/2027wintercampinterestform"/);assert.doesNotMatch(h,/name="(?:child|student|birth|medical)/i);assert.match(h,/\$325/);assert.match(h,/Fill out the interest form/);assert.doesNotMatch(h,/<form/)});

test('frontend matches server email constraints',()=>{for(const email of ['a..b@example.com','.a@example.com','a@-example.com','a@exam_ple.com'])assert.ok(validate({...valid,email}).email);assert.deepEqual(validate({...valid,email:'parent+camp@example.org'}),{})});
test('server validation and verification errors offer correction',async()=>{await assert.rejects(sendInterest('https://example.invalid',valid,async()=>new Response('{"error":"validation_failed"}',{status:400})),/check your contact details/);await assert.rejects(sendInterest('https://example.invalid',valid,async()=>new Response('{"error":"verification_failed"}',{status:400})),/expired/)});
