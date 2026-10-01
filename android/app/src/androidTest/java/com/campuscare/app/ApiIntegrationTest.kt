package com.campuscare.app

import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.exifinterface.media.ExifInterface
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Requires the actual local Sites development server with migrated D1 storage and:
 *   adb reverse tcp:5173 tcp:5173
 * Uses its normal WebView sign-in route. Never injects identity headers or auth cookies.
 * All synthetic location/configuration fixtures are confined to the named test workspace.
 */
@RunWith(AndroidJUnit4::class)
class ApiIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val api = ApiClient("http://127.0.0.1:5173")
    private val fixtureName = "Android integration checks"

    @Test
    fun authenticatedClientHonoursTenantAndReportingGates() = runBlocking<Unit> {
        clearCookies()
        expectApiError(401) { api.bootstrap() }.also { assertTrue(it.signInRequired) }
        val webView = signInUsingWebView()
        try {
            val signedIn = awaitBootstrap()
            assertTrue("The real local sign-in should identify a user", signedIn.obj("user").string("id").isNotBlank())
            api.initialise(demo = true)

            var organisations = api.bootstrap().objects("organisations")
            val demo = organisations.firstOrNull { it.bool("demo") }
                ?: throw AssertionError("A seeded demo workspace is required. Use a fresh local database or retain its sample workspaces.")
            val demoId = demo.string("id")
            val demoWorkspace = api.workspace(demoId)
            val pendingSample = demoWorkspace.objects("tickets").firstOrNull {
                it.bool("demo") && it.string("verification") == "pending"
            } ?: throw AssertionError("The local demo must retain at least one pending sample ticket.")

            val fixtureId = organisations.firstOrNull { it.string("name") == fixtureName }?.string("id")
                ?: api.request("create_org", jsonObject("name" to fixtureName, "type" to "Office")).string("orgId")
            assertNotEquals(demoId, fixtureId)
            organisations = api.bootstrap().objects("organisations")
            assertTrue(organisations.any { it.string("id") == fixtureId })
            assertTrue(organisations.any { it.string("id") == demoId })

            val fixtureWorkspace = api.workspace(fixtureId)
            assertEquals(fixtureId, fixtureWorkspace.obj("member").string("org_id"))
            listOf("sites", "buildings", "locations", "tickets").forEach { key ->
                fixtureWorkspace.objects(key).forEach { row -> assertEquals(fixtureId, row.string("org_id")) }
            }
            assertFalse(fixtureWorkspace.objects("tickets").any { it.string("id") == pendingSample.string("id") })

            // Both tenant selectors and resource identifiers must be checked server-side.
            expectApiError(404) { api.detail(fixtureId, pendingSample.string("id")) }
            expectApiError(404) { api.photo(fixtureId, pendingSample.string("id")) }
            expectApiError(403) { api.workspace(UUID.randomUUID().toString()) }
            val details = api.detail(demoId, pendingSample.string("id"))
            assertEquals(pendingSample.string("id"), details.obj("ticket").string("id"))
            assertTrue(details.objects("events").isNotEmpty())

            // Even an administrator cannot start repair on an unverified complaint.
            expectApiError(403) {
                api.request("ticket_action", jsonObject(
                    "orgId" to demoId, "ticketId" to pendingSample.string("id"),
                    "event" to "start", "note" to "Android negative transition check",
                    "version" to pendingSample.int("version"),
                ))
            }
            assertEquals("pending", api.detail(demoId, pendingSample.string("id")).obj("ticket").string("verification"))

            val fixture = ensureLocationFixture(fixtureId)
            val siteId = fixture.first
            val locationId = fixture.second
            expectApiError(422) {
                api.request("start_report", jsonObject("orgId" to fixtureId, "siteId" to siteId,
                    "position" to Position(0.0, 0.0, 5.0, System.currentTimeMillis()).toJson()))
            }.also { assertTrue(it.message.contains("outside", ignoreCase = true)) }

            expectApiError(422) {
                api.request("start_report", jsonObject("orgId" to fixtureId, "siteId" to siteId,
                    "position" to Position(TEST_LATITUDE, TEST_LONGITUDE, 5.0, System.currentTimeMillis() - 60_000).toJson()))
            }
            val session = api.request("start_report", jsonObject("orgId" to fixtureId, "siteId" to siteId,
                "position" to Position(TEST_LATITUDE, TEST_LONGITUDE, 5.0, System.currentTimeMillis()).toJson()))
            assertTrue(session.string("sessionId").isNotBlank())
            assertTrue(session.objects("candidates").isNotEmpty())
            expectApiError(422) {
                api.request("submit", jsonObject(
                    "orgId" to fixtureId, "sessionId" to session.string("sessionId"),
                    "locationId" to locationId, "title" to "Android mandatory photo check",
                    "description" to "Synthetic integration attempt; must fail without freshly captured evidence.",
                    "item" to "Test fixture", "category" to "Other", "visibility" to "private",
                ))
            }.also { assertTrue(it.message.contains("photo", ignoreCase = true)) }
            assertFalse(api.workspace(fixtureId).objects("tickets").any {
                it.string("session_id") == session.string("sessionId")
            })

            // Synthetic image is confined to this local test workspace; never represents a real fault.
            val photo = File.createTempFile("android-test-", ".jpg", instrumentation.targetContext.cacheDir)
            try {
                val bitmap = Bitmap.createBitmap(480, 320, Bitmap.Config.ARGB_8888)
                Canvas(bitmap).apply { drawColor(Color.LTGRAY); drawText("ANDROID TEST FIXTURE", 25f, 160f, Paint().apply { color = Color.BLACK; textSize = 28f }) }
                photo.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }; bitmap.recycle()
                val position = Position(TEST_LATITUDE, TEST_LONGITUDE, 5.0, System.currentTimeMillis())
                val jpeg = DeviceEvidence(instrumentation.targetContext).preparePhoto(photo, position)
                val geotag = ExifInterface(photo).latLong!!
                assertEquals(TEST_LATITUDE, geotag[0], .00001)
                assertEquals(TEST_LONGITUDE, geotag[1], .00001)
                val uploaded = api.uploadPhoto(fixtureId, session.string("sessionId"), locationId, position, jpeg)
                assertTrue(uploaded.bool("saved"))
                val submission = jsonObject("orgId" to fixtureId, "sessionId" to session.string("sessionId"),
                    "locationId" to locationId, "title" to "Android synthetic photo workflow",
                    "description" to "Local automated test record. This does not report a real facility fault.",
                    "item" to "Test image fixture", "category" to "Other", "visibility" to "private")
                val id = api.request("submit", submission).string("id")
                assertEquals(id, api.request("submit", submission).string("id"))
                assertTrue(api.detail(fixtureId, id).obj("evidence").bool("available"))
                assertTrue(api.photo(fixtureId, id).contentEquals(jpeg))
                var current = api.detail(fixtureId, id).obj("ticket")
                for (event in listOf("verify", "assign", "start", "hold", "start", "resolve", "close", "request_reopen", "approve_reopen")) {
                    api.request("ticket_action", jsonObject("orgId" to fixtureId, "ticketId" to id,
                        "event" to event, "note" to "Android automated workflow: $event",
                        "assigneeId" to fixtureWorkspace.obj("member").string("id"), "version" to current.int("version")))
                    current = api.detail(fixtureId, id).obj("ticket")
                }
                assertEquals("assigned", current.string("status"))
                assertEquals("none", current.string("reopen"))
            } finally { photo.delete() }

            api.signOut()
            // A Set-Cookie deletion from the logout response must update the WebView cookie jar.
            expectApiError(401) { api.bootstrap() }
        } finally {
            instrumentation.runOnMainSync { webView.stopLoading(); webView.destroy() }
            clearCookies()
        }
    }

    private suspend fun ensureLocationFixture(orgId: String): Pair<String, String> {
        var workspace = api.workspace(orgId)
        val existingSite = workspace.objects("sites").firstOrNull { it.string("name") == "Android test site" }
        val site = jsonObject("orgId" to orgId, "name" to "Android test site", "latitude" to TEST_LATITUDE,
            "longitude" to TEST_LONGITUDE, "radius" to 500, "enabled" to true)
        existingSite?.let { site.put("id", it.string("id")) }
        api.request("save_site", site)
        workspace = api.workspace(orgId)
        val siteId = workspace.objects("sites").first { it.string("name") == "Android test site" }.string("id")
        val existingBuilding = workspace.objects("buildings").firstOrNull {
            it.string("site_id") == siteId && it.string("name") == "Android test building"
        }
        val building = jsonObject("orgId" to orgId, "siteId" to siteId, "name" to "Android test building",
            "latitude" to TEST_LATITUDE, "longitude" to TEST_LONGITUDE, "radius" to 100)
        existingBuilding?.let { building.put("id", it.string("id")) }
        api.request("save_building", building)
        workspace = api.workspace(orgId)
        val buildingId = workspace.objects("buildings").first {
            it.string("site_id") == siteId && it.string("name") == "Android test building"
        }.string("id")
        if (workspace.objects("locations").none { it.string("building_id") == buildingId && it.string("name") == "Test room" }) {
            api.request("add_location", jsonObject("orgId" to orgId, "buildingId" to buildingId,
                "floor" to "Ground floor", "name" to "Test room", "private" to true))
            workspace = api.workspace(orgId)
        }
        val locationId = workspace.objects("locations").first {
            it.string("building_id") == buildingId && it.string("name") == "Test room"
        }.string("id")
        return siteId to locationId
    }

    private fun signInUsingWebView(): WebView {
        lateinit var webView: WebView
        instrumentation.runOnMainSync {
            webView = WebView(instrumentation.targetContext)
            webView.webViewClient = WebViewClient()
            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
            CookieManager.getInstance().setAcceptCookie(true)
            webView.loadUrl("${api.baseUrl}/signin-with-chatgpt?return_to=%2F")
        }
        return webView
    }

    private suspend fun awaitBootstrap(): JSONObject {
        var lastError: Exception? = null
        repeat(30) {
            try { return api.bootstrap() } catch (error: ApiException) {
                if (!error.signInRequired) throw error
                lastError = error
            }
            delay(500)
        }
        throw AssertionError("WebView development sign-in did not establish a session. Check adb reverse and the Sites dev server.", lastError)
    }

    private fun clearCookies() {
        val cleared = CountDownLatch(1)
        instrumentation.runOnMainSync { CookieManager.getInstance().removeAllCookies { cleared.countDown() } }
        assertTrue("Cookie cleanup timed out", cleared.await(5, TimeUnit.SECONDS))
        CookieManager.getInstance().flush()
    }

    private suspend fun expectApiError(status: Int, action: suspend () -> Any?): ApiException {
        try {
            action()
            throw AssertionError("Expected HTTP $status but request succeeded")
        } catch (error: ApiException) {
            assertEquals(error.message, status, error.statusCode)
            return error
        }
    }

    companion object {
        // Synthetic fixture only; no GPS provider, campus map, or production data is changed.
        private const val TEST_LATITUDE = 12.9716
        private const val TEST_LONGITUDE = 77.5946
    }
}
