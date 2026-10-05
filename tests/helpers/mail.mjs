import assert from 'node:assert/strict';

// Decode the transport independently; assertions exercise both MIME alternatives.
export function decodeMailParts(mime){
 const boundary=mime.match(/^Content-Type: multipart\/alternative; boundary="([^"]+)"\r?$/m)?.[1];
 assert.ok(boundary,'An HTML email must provide a multipart/alternative boundary.');
 assert.ok(mime.endsWith(`--${boundary}--\r\n`),'The MIME boundary must close.');
 const parts={};
 for(const part of mime.split('--'+boundary)){
  const type=part.match(/Content-Type: (text\/(?:plain|html)); charset=UTF-8\r\n/)?.[1];
  if(!type)continue;
  assert.match(part,/Content-Transfer-Encoding: base64\r\n/);
  const content=part.split('\r\n\r\n')[1].trim();
  assert.ok(content.split('\r\n').every(line=>line.length<=76));
  parts[type]=Buffer.from(content.replace(/\s/g,''),'base64').toString('utf8');
 }
 assert.equal(Object.keys(parts).length,2);
 return {text:parts['text/plain'],html:parts['text/html']};
}

export function assertMailContent({text,html},code){
 assert.ok(text.includes('code is '+code));
 assert.ok(html.includes('>'+code+'</div>'));
 for(const content of [text,html]){
  assert.ok(content.includes('CampusCare'));
  assert.ok(content.includes('5 minutes'));
  assert.ok(content.includes('If you did not request this sign-in'));
  assert.ok(!content.includes('chatgpt.site'));
 }
 assert.ok(!/<script|<iframe|<form|<img|https?:\/\//i.test(html),'No active content, external images or tracking requests.');
}
