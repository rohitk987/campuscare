package com.campuscare.app

import android.content.Intent
import android.graphics.Bitmap
import android.webkit.CookieManager
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Uses native Compose semantics inside this test app; screenshots contain local fixtures only. */
@RunWith(AndroidJUnit4::class)
class MobileUiTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext

    @Test fun nativeSignInNavigationAndReportingGate() {
        context.getSharedPreferences("campuscare", 0).edit().remove("organisation").commit()
        val cleared = CountDownLatch(1)
        instrumentation.runOnMainSync { CookieManager.getInstance().removeAllCookies { cleared.countDown() } }
        check(cleared.await(5, TimeUnit.SECONDS))
        val intent = Intent(context, MainActivity::class.java).putExtra("server", "http://127.0.0.1:5173")
        ActivityScenario.launch<MainActivity>(intent).use { activity ->
            awaitText("Sign in to your workspace")
            compose.onNodeWithText("Sign in to your workspace").performScrollTo().performClick()
            awaitText("Your campus, a little better every day.", 30000)
            compose.onNodeWithText("Raise complaint").assertExists()
            screenshot("android-home")

            compose.onNodeWithContentDescription("Helpdesk", useUnmergedTree = true).performClick()
            awaitText("Search complaints")
            compose.onNodeWithText("Search complaints").performTextInput("projector")
            awaitText("Projector loses connection")
            screenshot("android-helpdesk")
            compose.onNodeWithText("Projector loses connection").performClick()
            awaitText("Complaint details")
            screenshot("android-ticket")
            activity.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            compose.onNodeWithContentDescription("Home", useUnmergedTree = true).performClick()
            awaitText("Raise complaint")
            compose.onNodeWithText("Raise complaint").performClick()
            awaitText("Let’s locate the issue")
            activity.recreate()
            awaitText("Let’s locate the issue")
            compose.onNodeWithText("Check my location").assertExists()
            screenshot("android-report-location")
            activity.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            compose.onAllNodesWithContentDescription("Updates", useUnmergedTree = true).onLast().performClick()
            awaitText("Mark all read")
            compose.onNodeWithContentDescription("Profile", useUnmergedTree = true).performClick()
            awaitText("My profile")
            screenshot("android-profile")
            compose.onNodeWithText("Locations").performScrollTo().performClick()
            awaitText("Add site")
            screenshot("android-locations")
            activity.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            compose.onNodeWithText("Sign out").performScrollTo().performClick()
            awaitText("Sign in to your workspace")
        }
    }
    private fun awaitText(text: String, timeout: Long = 15000) {
        compose.waitUntil(timeout) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }
    private fun screenshot(name: String) {
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        val output = File(context.getExternalFilesDir(null), "$name.png")
        output.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
