/** Both mail providers use the same selectable code and plain-text alternative. */
export function verificationEmail(code:string){
 if(!/^\d{6}$/.test(code))throw new TypeError('A six-digit verification code is required.');
 const subject='Your CampusCare BMSIT verification code';
 const text=`Your CampusCare verification code is ${code}.\n\nIt expires in 5 minutes. Enter it on CampusCare to sign in to your BMSIT account.\n\nDo not share this code. CampusCare will never ask you to send it to anyone.\n\nIf you did not request this sign-in, you can safely ignore this email. Your account remains protected.\n\nCampusCare | BMSIT campus pilot`;
 const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CampusCare sign-in code</title></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;color:#172033;font-family:Arial,Helvetica,sans-serif;">
 <div style="display:none;font-size:1px;line-height:1px;color:#f0f2f5;max-height:0;max-width:0;opacity:0;overflow:hidden;">Your CampusCare sign-in code expires in 5 minutes. Never share it.</div>
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f2f5;">
  <tr><td align="center" style="padding:36px 16px 20px;">
   <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px;">
    <tr><td style="padding:32px 28px 0;">
     <span style="color:#305bea;font-size:27px;font-weight:700;letter-spacing:-0.8px;">CampusCare<span style="color:#305bea;">.</span></span>
     <div style="margin-top:8px;color:#7a8497;font-size:11px;font-weight:700;letter-spacing:1.4px;">BMSIT CAMPUS PILOT</div>
    </td></tr>
    <tr><td align="center" style="padding:34px 28px 0;">
     <h1 style="margin:0;font-size:19px;line-height:28px;font-weight:600;">Your sign-in code</h1>
     <p style="margin:12px 0 0;font-size:14px;line-height:22px;color:#526078;">Use this one-time code to sign in to your BMSIT account.</p>
    </td></tr>
    <tr><td align="center" style="padding:24px 20px 12px;">
     <div style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;line-height:48px;letter-spacing:7px;color:#172033;">${code}</div>
    </td></tr>
    <tr><td align="center" style="padding:0 28px 28px;">
     <p style="margin:0;font-size:13px;line-height:21px;color:#647087;">This code expires in <strong style="color:#172033;">5 minutes</strong>.</p>
    </td></tr>
    <tr><td style="padding:0 28px;"><div style="height:1px;background-color:#e4e8ef;line-height:1px;font-size:1px;">&nbsp;</div></td></tr>
    <tr><td style="padding:24px 28px 30px;">
     <p style="margin:0 0 14px;font-size:13px;line-height:21px;color:#526078;">If you did not request this sign-in, you can safely ignore this email. Your account remains protected.</p>
     <p style="margin:0;font-size:13px;line-height:21px;color:#526078;"><strong style="color:#172033;">Never share your code.</strong> CampusCare will never ask you to send it to anyone.</p>
    </td></tr>
   </table>
   <p style="margin:18px 0 0;color:#8a93a3;font-size:12px;line-height:18px;">CampusCare &middot; Facility reporting for BMSIT</p>
  </td></tr>
 </table>
</body></html>`;
 return {subject,text,html};
}
