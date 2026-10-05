import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationEmail} from '../lib/email-template.ts';
import {assertMailContent} from './helpers/mail.mjs';

test('email presents the full code including leading zeros with a text alternative',()=>{
 const message=verificationEmail('004217');
 assertMailContent(message,'004217');
 assert.ok(message.subject.includes('CampusCare'));
 assert.ok(message.html.includes('max-width:600px'));
 assert.ok(message.html.includes('width:100%'));
});

test('only six-digit codes can be interpolated into the HTML email',()=>{
 for(const code of ['12345','1234567','<img>','123456\r\nBcc: attacker@example.test','ABCDEF'])
  assert.throws(()=>verificationEmail(code));
});
