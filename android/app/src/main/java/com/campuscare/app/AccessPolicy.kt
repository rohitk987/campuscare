package com.campuscare.app

/** Global access failures differ from an ordinary forbidden workflow action. */
object AccessPolicy {
    fun needsSignIn(status: Int, isHtml: Boolean = false, errorCode: String? = null): Boolean =
        status == 401 || status == 428 || isHtml || errorCode == "ACCESS_DENIED"
}
