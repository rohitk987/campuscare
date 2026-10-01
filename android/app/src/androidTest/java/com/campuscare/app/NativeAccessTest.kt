package com.campuscare.app

import android.webkit.CookieManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Only synthetic responses on device loopback; no production identity or OTP bypass. */
@RunWith(AndroidJUnit4::class)
class NativeAccessTest {
    private lateinit var server: AccessFixture
    private lateinit var state: AppState

    @Before fun setup() {
        server = AccessFixture()
        state = AppState(ApiClient(server.url))
        setCookie("native_access_fixture=; Max-Age=0; Path=/")
    }

    @After fun cleanup() {
        state.clearAccess()
        setCookie("native_access_fixture=; Max-Age=0; Path=/")
        server.close()
    }

    @Test fun expiredVerificationClearsEveryProtectedFieldIncludingPhotoAccess() = runBlocking {
        state.connect()
        state.detail = JSONObject().put("private", "cached evidence")
        server.denial = 428
        val failure = runCatching { state.api.photo(state.orgId, "synthetic-ticket") }.exceptionOrNull()
        assertTrue(failure is ApiException && failure.signInRequired)
        assertLocked()
    }

    @Test fun graduationClearsAccessButAnOrdinaryPermissionErrorKeepsTheSession() = runBlocking {
        state.connect()
        server.denial = 403
        server.denialCode = ""
        val permission = runCatching { state.action("admin-only") }.exceptionOrNull()
        assertTrue(permission is ApiException && !permission.signInRequired)
        assertTrue(state.authenticated)
        assertEquals(1, state.tickets.size)
        server.denialCode = "ACCESS_DENIED"
        val revoked = runCatching { state.refresh() }.exceptionOrNull()
        assertTrue(revoked is ApiException && revoked.signInRequired)
        assertLocked()
    }

    @Test fun bootstrapDoesNotUnlockTheAppWhenWorkspaceVerificationFails() = runBlocking {
        server.workspaceDenial = 428
        val failure = runCatching { state.connect() }.exceptionOrNull()
        assertTrue(failure is ApiException && failure.signInRequired)
        assertLocked()
    }

    @Test fun aDelayedResponseCannotRestoreDataOrOverwriteTheNewCookie() = runBlocking {
        state.connect()
        val gate = server.delayWorkspace(cookie = "native_access_fixture=old; Path=/")
        val request = async(Dispatchers.IO) { runCatching { state.refresh() } }
        assertTrue(gate.arrived.await(10, TimeUnit.SECONDS))
        state.clearAccess()
        setCookie("native_access_fixture=new; Path=/")
        gate.release.countDown()
        assertTrue(request.await().exceptionOrNull() is CancellationException)
        assertLocked()
        assertTrue(CookieManager.getInstance().getCookie(server.url).orEmpty().contains("native_access_fixture=new"))
    }

    @Test fun aChangedEmailOnTheSameIdentityClearsOldDetailsAndRejectsRefresh() = runBlocking {
        state.connect()
        state.detail = JSONObject().put("private", "old account")
        server.email = "second-fixture@bmsit.in"
        state.connect()
        assertTrue(state.authenticated)
        assertNull(state.detail)
        assertEquals(server.email, state.user.string("email"))
        server.email = "third-fixture@bmsit.in"
        assertTrue(runCatching { state.refresh() }.exceptionOrNull() is ApiException)
        assertLocked()
    }

    @Test fun logoutUsesTheWebViewCookieAndCallsBothEndpointsEvenOnRevocationFailure() = runBlocking {
        setCookie("native_access_fixture=verified; Path=/")
        state.connect()
        assertTrue(server.lastCookie.contains("native_access_fixture=verified"))
        state.clearAccess()
        state.api.signOut()
        assertEquals(listOf("otp", "platform"), server.logouts.toList())
        assertFalse(CookieManager.getInstance().getCookie(server.url).orEmpty().contains("native_access_fixture=verified"))
        server.logoutFailure = true
        assertTrue(runCatching { state.api.signOut() }.exceptionOrNull() is ApiException)
        assertEquals(listOf("otp", "platform", "otp", "platform"), server.logouts.toList())
    }

    @Test fun anOldExternalRedirectCannotClearANewerVerifiedSession() = runBlocking {
        state.connect()
        val gate = server.delayWorkspace(status = 302, redirect = "https://example.invalid/sign-in")
        val request = async(Dispatchers.IO) { runCatching { state.refresh() } }
        assertTrue(gate.arrived.await(10, TimeUnit.SECONDS))
        state.clearAccess()
        state.connect()
        gate.release.countDown()
        assertTrue(request.await().exceptionOrNull() is CancellationException)
        assertTrue(state.authenticated)
        assertEquals(1, state.tickets.size)
    }

    @Test fun aCanceledSameOriginRedirectNeverReplaysItsRequest() = runBlocking {
        state.connect()
        val gate = server.delayWorkspace(status = 307, redirect = "/replay")
        val request = async(Dispatchers.IO) { runCatching { state.refresh() } }
        assertTrue(gate.arrived.await(10, TimeUnit.SECONDS))
        state.clearAccess()
        gate.release.countDown()
        assertTrue(request.await().exceptionOrNull() is CancellationException)
        assertFalse(server.paths.contains("/replay"))
        assertLocked()
    }

    private fun assertLocked() {
        assertFalse(state.authenticated)
        assertNull(state.bootstrap)
        assertNull(state.detail)
        assertEquals("", state.orgId)
        assertEquals(0, state.workspace.length())
    }

    private fun setCookie(value: String) {
        val done = CountDownLatch(1)
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            CookieManager.getInstance().setCookie(server.url, value) { done.countDown() }
        }
        assertTrue(done.await(10, TimeUnit.SECONDS))
        CookieManager.getInstance().flush()
    }
}

private class AccessFixture : AutoCloseable {
    private val listener = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    private val threads = Executors.newCachedThreadPool { runnable -> Thread(runnable, "native-access-fixture").apply { isDaemon = true } }
    private val sockets = ConcurrentHashMap.newKeySet<Socket>()
    val url = "http://127.0.0.1:${listener.localPort}"
    @Volatile var denial = 0
    @Volatile var denialCode = "ACCESS_DENIED"
    @Volatile var workspaceDenial = 0
    @Volatile var email = "native-fixture@bmsit.in"
    @Volatile var lastCookie = ""
    @Volatile var logoutFailure = false
    val logouts = CopyOnWriteArrayList<String>()
    val paths = CopyOnWriteArrayList<String>()
    @Volatile private var nextGate: Gate? = null
    private val gates = CopyOnWriteArrayList<Gate>()

    init {
        threads.execute {
            while (!listener.isClosed) {
                val socket = runCatching { listener.accept() }.getOrNull() ?: break
                sockets.add(socket)
                threads.execute {
                    try { socket.use { respond(it) } } catch (_: Exception) { /* Connection canceled by a test. */ }
                    finally { sockets.remove(socket) }
                }
            }
        }
    }

    fun delayWorkspace(status: Int = 200, redirect: String? = null, cookie: String? = null): Gate =
        Gate(status, redirect, cookie).also { gates.add(it); nextGate = it }

    private fun identity() = JSONObject().put("id", "synthetic-native-user").put("email", email)
    private fun workspace() = JSONObject().put("accessIdentity", identity())
        .put("member", JSONObject().put("id", "synthetic-member").put("role", "reporter"))
        .put("tickets", JSONArray().put(JSONObject().put("id", "synthetic-ticket")))

    private fun respond(socket: Socket) {
        socket.soTimeout = 15_000
        val reader = socket.getInputStream().bufferedReader(Charsets.UTF_8)
        val request = reader.readLine().split(" ")
        val headers = mutableMapOf<String, String>()
        while (true) {
            val line = reader.readLine() ?: break
            if (line.isEmpty()) break
            val separator = line.indexOf(':')
            if (separator > 0) headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
        }
        var remaining = headers["content-length"]?.toIntOrNull() ?: 0
        val buffer = CharArray(4096)
        while (remaining > 0) { val read = reader.read(buffer, 0, minOf(remaining, buffer.size)); if (read < 0) break; remaining -= read }
        lastCookie = headers["cookie"].orEmpty()
        val uri = URI(request[1])
        paths.add(uri.path)
        var status = 200
        var body = "{}"
        val outgoing = mutableMapOf<String, String>()
        if (uri.path == "/api/access") {
            logouts.add("otp")
            outgoing["Set-Cookie"] = "native_access_fixture=; Max-Age=0; Path=/"
            if (logoutFailure) { status = 503; body = "{\"error\":\"Synthetic delivery failure\"}" }
        } else if (uri.path == "/signout-with-chatgpt") {
            logouts.add("platform"); status = 302; outgoing["Location"] = "/"
        } else if (denial != 0) {
            status = denial
            body = JSONObject().put("error", "Synthetic access refusal").put("code", denialCode).toString()
        } else if (request[0] == "GET" && uri.rawQuery.orEmpty().contains("op=workspace")) {
            val gate = nextGate
            if (gate != null) {
                nextGate = null; gate.arrived.countDown()
                check(gate.release.await(15, TimeUnit.SECONDS))
                status = gate.status
                gate.redirect?.let { outgoing["Location"] = it }
                gate.cookie?.let { outgoing["Set-Cookie"] = it }
            } else if (workspaceDenial != 0) {
                status = workspaceDenial
            }
            body = if (status == 200) workspace().toString() else "{\"error\":\"Synthetic verification required\"}"
        } else if (uri.rawQuery.orEmpty().contains("op=bootstrap")) {
            body = JSONObject().put("user", identity())
                .put("pilot", JSONObject().put("organisationId", "bmsit-pilot"))
                .put("organisations", JSONArray().put(JSONObject().put("id", "bmsit-pilot"))).toString()
        }
        val bytes = body.toByteArray(Charsets.UTF_8)
        val responseHeaders = "HTTP/1.1 $status Fixture\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n" +
            outgoing.entries.joinToString("") { "${it.key}: ${it.value}\r\n" } + "\r\n"
        socket.getOutputStream().apply { write(responseHeaders.toByteArray(Charsets.US_ASCII)); write(bytes); flush() }
    }

    override fun close() {
        gates.forEach { it.release.countDown() }
        listener.close()
        sockets.forEach { runCatching { it.close() } }
        threads.shutdownNow()
    }

    class Gate(val status: Int, val redirect: String?, val cookie: String?) {
        val arrived = CountDownLatch(1)
        val release = CountDownLatch(1)
    }
}
