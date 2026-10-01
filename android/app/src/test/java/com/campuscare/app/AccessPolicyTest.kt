package com.campuscare.app

import org.junit.Assert.*
import org.junit.Test

class AccessPolicyTest {
    @Test fun expiredOtpRequiresVerification() { assertTrue(AccessPolicy.needsSignIn(428)) }
    @Test fun revokedEnrollmentRequiresSignIn() { assertTrue(AccessPolicy.needsSignIn(403, errorCode = "ACCESS_DENIED")) }
    @Test fun ordinaryForbiddenActionKeepsSession() { assertFalse(AccessPolicy.needsSignIn(403)) }
    @Test fun dispatcherSignInPageRequiresSignIn() { assertTrue(AccessPolicy.needsSignIn(200, isHtml = true)); assertTrue(AccessPolicy.needsSignIn(401)) }
    @Test fun transientErrorsDoNotRevokeAccess() { for (status in listOf(409, 429, 500, 503)) assertFalse(AccessPolicy.needsSignIn(status)) }
}
