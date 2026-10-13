'use client';

import {lazy, Suspense, useEffect, useState} from 'react';
import {Building2} from 'lucide-react';
import {Busy} from './ui';
import VerificationPanel from './signin-panel';
import {accessStatus, type AccessStatus} from './access-client';

const CampusCare = lazy(() => import('./campuscare'));

function WorkspaceLoading() {
 return <main className="loading-page"><span className="brandmark"><Building2/></span><h2>Opening your workspace</h2><Busy/></main>;
}

export default function CampusCareEntry() {
 const [verified, setVerified] = useState(false);
 const [status, setStatus] = useState<AccessStatus>({});
 const [initialError, setInitialError] = useState('');

 useEffect(() => {
  let active = true;
  accessStatus().then((result) => {
   if (!active) return;
   setStatus(result);
   if (result.verified) setVerified(true);
  }).catch((error) => {
   if (active) setInitialError((error as Error).message);
  });
  return () => { active = false; };
 }, []);

 if (verified) return <Suspense fallback={<WorkspaceLoading/>}><CampusCare initiallyVerified/></Suspense>;
 return <VerificationPanel status={status} initialError={initialError} onVerified={() => setVerified(true)} onCodeSent={() => { void import('./campuscare').catch(() => {}); }}/>
}
