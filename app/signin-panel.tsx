'use client';

import {useEffect, useState, type FormEvent} from 'react';
import {Building2, Mail, ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {InputOTP, InputOTPGroup, InputOTPSlot} from '@/components/ui/input-otp';
import {Field, Busy} from './ui';
import {accessAction, type AccessStatus} from './access-client';
import BmsitInformation from './bmsit-information';

type AccessChallenge = {challengeId: string; email: string; expiresAt: number; resendAt: number};
type VerificationPanelProps = {
 status?: AccessStatus;
 onVerified?: () => unknown;
 onCodeSent?: () => void;
 initialError?: string;
};

export default function VerificationPanel({status = {}, onVerified = () => {}, onCodeSent, initialError = ''}: VerificationPanelProps) {
 const [email, setEmail] = useState('');
 const [challenge, setChallenge] = useState<AccessChallenge | null>(null);
 const [code, setCode] = useState('');
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState(initialError);
 const [hideInitialError, setHideInitialError] = useState(false);
 const [now, setNow] = useState(0);

 useEffect(() => {
  if (!challenge) return;
  const interval = setInterval(() => setNow(Date.now()), 1000);
  return () => clearInterval(interval);
 }, [challenge]);

 const wait = Math.max(0, Math.ceil(((challenge?.resendAt || 0) - now) / 1000));
 const expired = !!challenge && now >= challenge.expiresAt;

 async function send(event?: FormEvent<HTMLFormElement>) {
  event?.preventDefault();
  setBusy(true);
  setHideInitialError(true);
  setError('');
  try {
   const result = await accessAction('send_code', {email: challenge?.email || email});
   setChallenge(result as unknown as AccessChallenge);
   setCode('');
   setNow(Date.now());
   onCodeSent?.();
  } catch (next) {
   setError(next instanceof Error ? next.message : 'The sign-in code could not be sent.');
  } finally {
   setBusy(false);
  }
 }

 async function verify(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!challenge) return;
  setBusy(true);
  setHideInitialError(true);
  setError('');
  try {
   await accessAction('verify_code', {email: challenge.email, challengeId: challenge.challengeId, code});
   await onVerified();
  } catch (next) {
   setError(next instanceof Error ? next.message : 'The code could not be verified.');
  } finally {
   setBusy(false);
  }
 }

 function anotherEmail() {
  setChallenge(null);
  setCode('');
  setError('');
 }

 return <main className="signin-page"><section className="signin-card">
  <div className="brand"><span className="brandmark"><Building2/></span>CampusCare</div>
  <span className="eyebrow">BMSIT · FIRST CAMPUS PILOT</span>
  <h1>{challenge ? <>Check your<br/>college mailbox.</> : <>Sign in with your<br/>BMSIT email.</>}</h1>
  <p>{challenge ? <>Enter the six-digit code sent to <strong>{challenge.email}</strong>. It expires after five minutes.</> : <>Report a facility issue at BMSIT and follow the repair from anywhere.</>}</p>
  {status.configured === false && <div role="alert" className="error-box">Email delivery is being configured. Contact the CampusCare administrator; access remains locked until verification is available.</div>}
  {(error || (!hideInitialError && initialError)) && <div role="alert" className="error-box">{error || initialError}</div>}
  {!challenge && <form onSubmit={send} className="space-y-5">
   <Field label="BMSIT email address" type="email" value={email} onChange={setEmail} required maxLength={200} autoComplete="email" placeholder="yourname@bmsit.in" disabled={busy}/>
   <div className="notice">Use <strong>@bmsit.in</strong> or <strong>@bmsit.ac.in</strong>. Students need an approved current-student record and an active batch.</div>
   <Button type="submit" disabled={busy || status.configured === false || !email.trim()} className="w-full">{busy ? <Busy/> : <Mail size={16}/>}Send sign-in code</Button>
  </form>}
  {challenge && <form onSubmit={verify} className="space-y-5">
   <label className="text-sm font-semibold" htmlFor="college-otp">Email verification code</label>
   <InputOTP id="college-otp" aria-label="Email verification code" maxLength={6} pattern="^[0-9]*$" value={code} onChange={setCode} disabled={busy || expired} autoComplete="one-time-code" inputMode="numeric"><InputOTPGroup>{Array.from({length: 6}, (_, index) => <InputOTPSlot key={index} index={index}/>)}</InputOTPGroup></InputOTP>
   <p className="body-copy">{expired ? 'This code expired. Request a new one.' : 'Check your inbox and spam folder. Never share this code.'}</p>
   <Button className="w-full" disabled={busy || expired || code.length !== 6}>{busy ? <Busy/> : <ShieldCheck size={16}/>}Verify and continue</Button>
  </form>}
  {challenge && <><Button variant="outline" onClick={() => void send()} disabled={busy || status.configured === false || wait > 0} className="w-full"><Mail size={16}/>{wait > 0 ? `Request another code in ${wait}s` : 'Send a new code'}</Button><button disabled={busy} className="text-sm underline" onClick={anotherEmail}>Use another email</button></>}
  <small>Sign in directly with your email code. Location is required only when reporting a new issue.</small>
  <BmsitInformation/>
 </section></main>;
}
