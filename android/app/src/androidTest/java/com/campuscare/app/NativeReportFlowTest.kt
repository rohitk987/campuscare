package com.campuscare.app

import android.Manifest
import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import android.provider.MediaStore
import android.webkit.CookieManager
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Real emulator GPS + real native report UI. Only the external camera result is a test fixture. */
@RunWith(AndroidJUnit4::class)
class NativeReportFlowTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val api = ApiClient("http://127.0.0.1:5173")

    @Test fun reportUsesCameraLocationAndStaffVerification() {
        context.getSharedPreferences("campuscare", 0).edit().remove("organisation").commit()
        val cleared = CountDownLatch(1)
        instrumentation.runOnMainSync { CookieManager.getInstance().removeAllCookies { cleared.countDown() } }
        check(cleared.await(5, TimeUnit.SECONDS))
        listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.CAMERA).forEach {
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, it)
        }
        val cameraRequested = AtomicBoolean(false)
        val camera = object : Instrumentation.ActivityMonitor() {
            @Suppress("DEPRECATION")
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                if (intent.action != MediaStore.ACTION_IMAGE_CAPTURE) return null
                cameraRequested.set(true)
                val destination = intent.getParcelableExtra<Uri>(MediaStore.EXTRA_OUTPUT)!!
                val bitmap = Bitmap.createBitmap(960, 640, Bitmap.Config.ARGB_8888)
                Canvas(bitmap).apply { drawColor(Color.LTGRAY); drawText("SIMULATED CAMERA · LOCAL TEST", 40f, 320f, Paint().apply { color = Color.BLACK; textSize = 34f }) }
                context.contentResolver.openOutputStream(destination)!!.use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }; bitmap.recycle()
                return Instrumentation.ActivityResult(Activity.RESULT_OK, Intent())
            }
        }
        instrumentation.addMonitor(camera)
        try {
            ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java).putExtra("server", api.baseUrl)).use { activity ->
                awaitText("Sign in to your workspace")
                compose.onNodeWithText("Sign in to your workspace").performScrollTo().performClick()
                awaitText("Your campus, a little better every day.", 30000)
                val orgId = runBlocking { ensureFixture() }
                compose.onNodeWithContentDescription("Refresh", useUnmergedTree = true).performClick()
                compose.onNodeWithContentDescription("Switch workspace", useUnmergedTree = true).performClick()
                awaitText("Android integration checks")
                compose.onNodeWithText("Android integration checks").performClick()
                compose.waitUntil(15000) { runCatching { compose.onNodeWithText("Raise complaint").assertIsEnabled() }.isSuccess }
                compose.onNodeWithText("Raise complaint").performClick()
                awaitText("Check my location")
                compose.onNodeWithText("Check my location").performScrollTo().performClick()
                awaitText("Site location check passed.", 40000, true)
                compose.onNodeWithText("Select floor").performScrollTo().performClick()
                compose.onNodeWithText("Ground floor").performClick()
                compose.onNodeWithText("Select room or area").performScrollTo().performClick()
                compose.onNodeWithText("Test room").performClick()
                compose.onNodeWithText("Which item?").performScrollTo().performTextInput("Test ceiling fixture")
                compose.onNodeWithText("Issue title").performScrollTo().performTextInput("Android native camera workflow")
                compose.onNodeWithText("What happened?").performScrollTo().performTextInput("Synthetic emulator report to verify the native camera and reporting workflow.")
                compose.onNodeWithText("Continue to photo").performScrollTo().performClick()
                compose.onNodeWithText("Submit for verification").performScrollTo().assertIsNotEnabled()
                compose.onNodeWithText("Open camera").performScrollTo().performClick()
                awaitText("Photo and location received", 40000, true)
                assertTrue("Native ACTION_IMAGE_CAPTURE must be requested", cameraRequested.get())
                screenshot("android-report-photo")
                compose.onNodeWithText("Submit for verification").performScrollTo().performClick()
                awaitText("Complaint details")
                val saved = runBlocking { api.workspace(orgId).objects("tickets").first { it.string("title") == "Android native camera workflow" } }
                assertEquals("pending", saved.string("verification"))
                assertTrue(runBlocking { api.detail(orgId, saved.string("id")).obj("evidence").bool("available") })
                compose.onNodeWithText("Select action").performScrollTo().performClick()
                compose.onNodeWithText("Verify issue").performClick()
                compose.onNodeWithText("Note or reason").performScrollTo().performTextInput("Verified by the Android UI test")
                compose.onNodeWithText("Save update").performScrollTo().performClick()
                awaitText("Awaiting assignment")
                assertEquals("verified", runBlocking { api.detail(orgId, saved.string("id")).obj("ticket").string("verification") })
                activity.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            }
        } finally { instrumentation.removeMonitor(camera) }
    }
    private suspend fun ensureFixture(): String {
        val organisations = api.bootstrap().objects("organisations")
        val orgId = organisations.find { it.string("name") == "Android integration checks" }?.string("id")
            ?: api.request("create_org", jsonObject("name" to "Android integration checks", "type" to "Office")).string("orgId")
        var ws = api.workspace(orgId)
        val sitePayload = jsonObject("orgId" to orgId, "name" to "Android test site", "latitude" to 12.9716, "longitude" to 77.5946, "radius" to 500, "enabled" to true)
        ws.objects("sites").firstOrNull { it.string("name") == "Android test site" }?.let { sitePayload.put("id", it.string("id")) }
        api.request("save_site", sitePayload)
        ws = api.workspace(orgId); val site = ws.objects("sites").first().string("id")
        val buildingPayload = jsonObject("orgId" to orgId, "siteId" to site, "name" to "Android test building", "latitude" to 12.9716, "longitude" to 77.5946, "radius" to 100)
        ws.objects("buildings").firstOrNull { it.string("site_id") == site && it.string("name") == "Android test building" }?.let { buildingPayload.put("id", it.string("id")) }
        api.request("save_building", buildingPayload)
        ws = api.workspace(orgId); val building = ws.objects("buildings").first().string("id")
        if (ws.objects("locations").isEmpty()) api.request("add_location", jsonObject("orgId" to orgId, "buildingId" to building, "floor" to "Ground floor", "name" to "Test room", "private" to true))
        return orgId
    }
    private fun awaitText(text: String, timeout: Long = 15000, substring: Boolean = false) {
        try { compose.waitUntil(timeout) { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() } }
        catch (e: Throwable) { screenshot("android-native-failure"); throw AssertionError("Expected: $text\n" + compose.onRoot().printToString(), e) }
    }
    private fun screenshot(name: String) {
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        File(context.getExternalFilesDir(null), "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
