package com.campuscare.app

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.net.URI

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable fun AuthScreen(api: ApiClient, onBack: () -> Unit, onSuccess: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    var web by remember { mutableStateOf<WebView?>(null) }
    fun checkSession() {
        if (checking) return
        checking = true
        scope.launch {
            try { val boot = api.bootstrap(); if (boot.obj("user").string("id").isNotEmpty()) onSuccess() }
            catch (e: Exception) { if (e !is ApiException || !e.signInRequired) error = e.message.orEmpty() }
            finally { checking = false }
        }
    }
    Scaffold(topBar = { TopAppBar(title = { Text("Sign in to CampusCare") }, navigationIcon = { IconButton(onBack) { Icon(Icons.Outlined.ArrowBack, "Back") } }, actions = { IconButton({ checkSession() }) { Icon(Icons.Outlined.Refresh, "Check sign-in") } }) }, containerColor = Color.White) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (busy || checking) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error.isNotEmpty()) Box(Modifier.padding(12.dp)) { Notice(error, true) }
            AndroidView(modifier = Modifier.weight(1f), factory = { context ->
                WebView(context).apply {
                    web = this
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.setSupportMultipleWindows(false)
                    CookieManager.getInstance().setAcceptCookie(true)
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val target = request.url
                            val allowed = target.scheme == "https" || BuildConfig.DEBUG && target.scheme == "http" && target.host in listOf("localhost", "127.0.0.1", "10.0.2.2")
                            if (!allowed) error = "This sign-in link cannot open here. Use a supported HTTPS sign-in method."
                            return !allowed
                        }
                        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) { busy = true }
                        override fun onPageFinished(view: WebView, url: String) {
                            busy = false
                            val base = Uri.parse(api.baseUrl); val current = Uri.parse(url)
                            if (current.scheme == base.scheme && current.host == base.host && current.port == base.port) checkSession()
                        }
                        override fun onReceivedError(view: WebView, request: WebResourceRequest, e: WebResourceError) { if (request.isForMainFrame) { error = "The sign-in page could not load. Check your connection and retry."; busy = false } }
                    }
                    loadUrl(api.baseUrl + "/signin-with-chatgpt?return_to=%2F")
                }
            })
            Text("Sign-in is complete only when the CampusCare server confirms your account. Third-party sign-in availability depends on your provider.", Modifier.padding(14.dp), style = MaterialTheme.typography.bodySmall, color = Muted)
        }
    }
    DisposableEffect(Unit) { onDispose { web?.stopLoading(); web?.destroy(); web = null } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ServerScreen(initial: String, onBack: () -> Unit, onSave: (String) -> Unit) {
    var url by remember { mutableStateOf(initial) }; var error by remember { mutableStateOf("") }
    Scaffold(topBar = { TopAppBar(title = { Text("Connection settings") }, navigationIcon = { IconButton(onBack) { Icon(Icons.Outlined.ArrowBack, "Back") } }) }) { padding ->
        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Notice("Use the trusted CampusCare portal address provided by your administrator. Changing it signs you out of this app.")
            FormField("CampusCare server URL", url, { url = it })
            if (error.isNotEmpty()) Notice(error, true)
            PrimaryButton("Save connection") { try { onSave(ApiClient.normaliseBaseUrl(url)) } catch (e: Exception) { error = e.message.orEmpty() } }
            TextButton({ url = DEFAULT_BASE_URL }) { Text("Use CampusCare preview") }
            if (BuildConfig.DEBUG) Text("Developer build: local testing supports http://127.0.0.1:5173 with adb reverse, or the emulator host at 10.0.2.2. Customer servers require HTTPS.", color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
