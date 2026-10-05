package com.campuscare.app

import android.webkit.CookieManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

const val DEFAULT_BASE_URL = "https://campuscare.signaltradehq.workers.dev"

/** A deliberately small native client for the existing authenticated CampusCare API. */
class ApiClient(serverUrl: String = DEFAULT_BASE_URL) {
    val baseUrl: String = normaliseBaseUrl(serverUrl)
    private val origin = URI(baseUrl)
    private val apiUrl = "$baseUrl/api/campuscare"
    private val requestEpoch = AtomicLong(0)
    var onAccessLost: ((ApiException) -> Unit)? = null
    fun cancelPendingRequests() { requestEpoch.incrementAndGet() }

    suspend fun bootstrap(): JSONObject = get(mapOf("op" to "bootstrap"))

    suspend fun initialise(demo: Boolean = false): JSONObject =
        request("initialise", JSONObject().put("demo", demo))

    /** Revoke the CampusCare mailbox session. UI clears local state in finally. */
    suspend fun signOut() {
        parseJson(exchange("POST", URL("$baseUrl/api/access"),
            "{\"action\":\"logout\"}".toByteArray(Charsets.UTF_8), "application/json; charset=utf-8"))
    }

    suspend fun workspace(orgId: String): JSONObject =
        get(mapOf("op" to "workspace", "org" to orgId))

    suspend fun detail(orgId: String, ticketId: String): JSONObject =
        get(mapOf("op" to "detail", "org" to orgId, "id" to ticketId))

    /** Payload is copied; caller-owned state is not modified. */
    suspend fun request(action: String, payload: JSONObject = JSONObject()): JSONObject {
        val body = JSONObject(payload.toString()).put("action", action)
        return parseJson(exchange("POST", URL(apiUrl), body.toString().toByteArray(Charsets.UTF_8),
            "application/json; charset=utf-8"))
    }

    suspend fun get(query: Map<String, String> = emptyMap()): JSONObject =
        parseJson(exchange("GET", endpoint(query)))

    /** Upload JPEG bytes captured by the native camera, with a fresh location reading. */
    suspend fun uploadPhoto(
        orgId: String,
        sessionId: String,
        locationId: String,
        position: JSONObject,
        jpeg: ByteArray,
    ): JSONObject {
        if (jpeg.size !in 100..(5 * 1024 * 1024)) {
            throw ApiException(400, "Capture a JPEG photo smaller than 5 MB.")
        }
        val boundary = "CampusCare-${UUID.randomUUID()}"
        val body = ByteArrayOutputStream(jpeg.size + 2048).apply {
            fun line(value: String) = write((value + "\r\n").toByteArray(Charsets.UTF_8))
            fun field(name: String, value: String) {
                line("--$boundary")
                line("Content-Disposition: form-data; name=\"$name\"")
                line("")
                line(value)
            }
            field("orgId", orgId)
            field("sessionId", sessionId)
            field("locationId", locationId)
            field("position", position.toString())
            line("--$boundary")
            line("Content-Disposition: form-data; name=\"photo\"; filename=\"capture.jpg\"")
            line("Content-Type: image/jpeg")
            line("")
            write(jpeg)
            line("")
            line("--$boundary--")
        }.toByteArray()
        return parseJson(exchange("POST", endpoint(mapOf("op" to "photo")), body,
            "multipart/form-data; boundary=$boundary"))
    }

    suspend fun uploadPhoto(
        orgId: String, sessionId: String, locationId: String, position: Position, jpeg: ByteArray,
    ): JSONObject = uploadPhoto(orgId, sessionId, locationId, position.toJson(), jpeg)

    /** Evidence stays authenticated; the UI should never use a public image URL. */
    suspend fun photo(orgId: String, ticketId: String): ByteArray {
        val response = exchange("GET", endpoint(mapOf("op" to "photo", "org" to orgId, "id" to ticketId)))
        checkResponse(response)
        if (!response.contentType.startsWith("image/jpeg", ignoreCase = true) ||
            response.bytes.size < 3 || response.bytes[0] != 0xff.toByte() ||
            response.bytes[1] != 0xd8.toByte()) {
            throw ApiException(response.status, "The evidence photo could not be opened. Please retry.")
        }
        return response.bytes
    }

    private fun endpoint(query: Map<String, String>): URL {
        val encoded = query.entries.joinToString("&") {
            "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}"
        }
        return URL(if (encoded.isEmpty()) apiUrl else "$apiUrl?$encoded")
    }

    private suspend fun exchange(
        method: String,
        initialUrl: URL,
        body: ByteArray? = null,
        contentType: String? = null,
        followRedirects: Boolean = true,
    ): ApiResponse {
        val generation = requestEpoch.get()
        return withContext(Dispatchers.IO) {
        try {
            var url = initialUrl
            var redirectCount = 0
            while (true) {
                currentCoroutineContext().ensureActive()
                if (generation != requestEpoch.get()) throw CancellationException("A previous session request was discarded.")
                if (!sameOrigin(url)) {
                    throw ApiException(0, "The server redirected to sign-in. Sign in again to continue.", true)
                }
                val connection = url.openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = method
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = 20_000
                    connection.readTimeout = 45_000
                    connection.useCaches = false
                    connection.setRequestProperty("Accept", "application/json, image/jpeg")
                    connection.setRequestProperty("Cache-Control", "no-cache")
                    // Obtain cookies from the same WebView store used during sign-in.
                    val sessionCookie = withContext(Dispatchers.Main.immediate) {
                        if (generation != requestEpoch.get()) throw CancellationException("A previous session request was discarded.")
                        CookieManager.getInstance().getCookie(url.toString())
                    }
                    sessionCookie?.takeIf { it.isNotBlank() }?.let {
                        connection.setRequestProperty("Cookie", it)
                    }
                    if (method == "POST") {
                        connection.setRequestProperty("X-Campuscare-Request", "1")
                        connection.setRequestProperty("Origin", baseUrl)
                    }
                    if (body != null) {
                        connection.doOutput = true
                        connection.setRequestProperty("Content-Type", contentType)
                        connection.setFixedLengthStreamingMode(body.size)
                        connection.outputStream.use { it.write(body) }
                    }
                    val status = connection.responseCode
                    withContext(Dispatchers.Main.immediate) {
                        if (generation != requestEpoch.get()) throw CancellationException("A previous session request was discarded.")
                        rememberCookies(url, connection)
                    }
                    if (status in listOf(301, 302, 303, 307, 308)) {
                        if (!followRedirects) return@withContext ApiResponse(status,
                            connection.contentType.orEmpty(), ByteArray(0), generation)
                        val location = connection.getHeaderField("Location")
                            ?: throw ApiException(status, "The server returned an incomplete redirect. Please retry.")
                        val target = URL(url, location)
                        // Never attach the session cookie, or replay a POST, on another origin.
                        if (!sameOrigin(target)) {
                            throw ApiException(status, "Sign in again to access your workspace.", true)
                        }
                        if (++redirectCount > 3) {
                            throw ApiException(status, "Sign-in could not be completed. Please sign in again.", true)
                        }
                        if (method != "GET" && status !in listOf(307, 308)) {
                            throw ApiException(status, "Sign in again before making this change.", true)
                        }
                        url = target
                        continue
                    }
                    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                    val bytes = stream?.use { input ->
                        val buffer = ByteArray(16 * 1024)
                        val output = ByteArrayOutputStream()
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            if (output.size() + count > MAX_RESPONSE_BYTES) {
                                throw ApiException(status, "This server response is too large to open on the device.")
                            }
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    } ?: ByteArray(0)
                    return@withContext ApiResponse(status, connection.contentType.orEmpty(), bytes, generation)
                } finally {
                    connection.disconnect()
                }
            }
            @Suppress("UNREACHABLE_CODE")
            throw ApiException(0, "The request could not be completed.")
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiException) {
            if (generation != requestEpoch.get()) throw CancellationException("A previous session request was discarded.")
            if (error.signInRequired) withContext(Dispatchers.Main.immediate) {
                if (generation == requestEpoch.get()) onAccessLost?.invoke(error)
            }
            throw error
        } catch (error: SocketTimeoutException) {
            if (generation != requestEpoch.get()) throw CancellationException("A previous session request was discarded.")
            throw ApiException(0, "The server took too long to respond. Check your connection and retry.", cause = error)
        } catch (error: IOException) {
            if (generation != requestEpoch.get()) throw CancellationException("A previous session request was discarded.")
            throw ApiException(0, "Could not connect to CampusCare. Check your connection and server address.", cause = error)
        }
    }
    }

    private fun rememberCookies(url: URL, connection: HttpURLConnection) {
        val manager = CookieManager.getInstance()
        var changed = false
        connection.headerFields.forEach { (key, values) ->
            if (key.equals("Set-Cookie", ignoreCase = true)) {
                values.orEmpty().forEach { cookie ->
                    manager.setCookie(url.toString(), cookie)
                    changed = true
                }
            }
        }
        if (changed) manager.flush()
    }

    private fun sameOrigin(url: URL): Boolean {
        if (url.userInfo != null) return false
        val expectedPort = if (origin.port >= 0) origin.port else if (origin.scheme == "https") 443 else 80
        val actualPort = if (url.port >= 0) url.port else url.defaultPort
        return url.protocol.equals(origin.scheme, ignoreCase = true) &&
            url.host.equals(origin.host, ignoreCase = true) && actualPort == expectedPort
    }

    private fun parseJson(response: ApiResponse): JSONObject {
        checkResponse(response)
        return try {
            JSONObject(response.bytes.toString(Charsets.UTF_8))
        } catch (error: Exception) {
            throw ApiException(response.status, "The server returned an unexpected response. Please retry.", cause = error)
        }
    }

    private fun checkResponse(response: ApiResponse) {
        if (response.generation != requestEpoch.get()) throw CancellationException("A previous session request was discarded.")
        val prefix = response.bytes.copyOfRange(0, minOf(response.bytes.size, 512))
            .toString(Charsets.UTF_8).trimStart()
        val isHtml = response.contentType.contains("text/html", ignoreCase = true) ||
            prefix.startsWith("<!doctype html", ignoreCase = true) ||
            prefix.startsWith("<html", ignoreCase = true)
        val serverError = if (response.status !in 200..299) runCatching {
            JSONObject(response.bytes.toString(Charsets.UTF_8))
        }.getOrNull() else null
        val serverMessage = serverError?.optString("error")?.takeIf { it.isNotBlank() }
        if (AccessPolicy.needsSignIn(response.status, isHtml, serverError?.optString("code"))) {
            val error = ApiException(response.status, serverMessage ?: if (response.status == 428)
                "Verify your BMSIT email to continue." else "Sign in again to access your workspace.", true)
            onAccessLost?.invoke(error)
            throw error
        }
        if (response.status !in 200..299) {
            val fallback = when (response.status) {
                403 -> "You do not have permission to perform this action."
                404 -> "This item is unavailable or you do not have access to it."
                409 -> "This record changed. Refresh and try again."
                413 -> "The photo is too large. Please capture a smaller photo."
                429 -> "Too many requests. Please wait before trying again."
                in 500..599 -> "CampusCare is temporarily unavailable. Please retry shortly."
                else -> "The request could not be completed. Please retry."
            }
            throw ApiException(response.status, serverMessage ?: fallback)
        }
    }

    companion object {
        private const val MAX_RESPONSE_BYTES = 12 * 1024 * 1024

        /** Reject credentials, paths, and insecure non-local origins before loading a WebView. */
        fun normaliseBaseUrl(value: String): String {
            val uri = try { URI(value.trim()) } catch (error: Exception) {
                throw IllegalArgumentException("Enter a valid CampusCare HTTPS server address.", error)
            }
            val scheme = uri.scheme?.lowercase()
            val host = uri.host?.lowercase()
            val local = host in setOf("localhost", "127.0.0.1", "[::1]", "::1", "10.0.2.2")
            require(scheme == "https" || (BuildConfig.DEBUG && scheme == "http" && local)) {
                "Use HTTPS for CampusCare. HTTP is allowed only for local debug servers."
            }
            require(!host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null &&
                (uri.path.isNullOrEmpty() || uri.path == "/") && (uri.port == -1 || uri.port in 1..65535)) {
                "Enter only the server origin, such as https://your-campuscare.example."
            }
            val port = if (uri.port == -1 || (scheme == "https" && uri.port == 443) ||
                (scheme == "http" && uri.port == 80)) "" else ":${uri.port}"
            return "$scheme://$host$port"
        }
    }
}

class ApiException(
    val statusCode: Int,
    override val message: String,
    val signInRequired: Boolean = false,
    cause: Throwable? = null,
) : IOException(message, cause)

private data class ApiResponse(val status: Int, val contentType: String, val bytes: ByteArray, val generation: Long)
