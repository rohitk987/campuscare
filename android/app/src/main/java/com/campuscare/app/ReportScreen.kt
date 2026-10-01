package com.campuscare.app

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ReportScreen(state: AppState, onBack: () -> Unit, onCreated: (String) -> Unit, onFollow: (JSONObject) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); val device = remember { DeviceEvidence(context) }
    var step by rememberSaveable { mutableIntStateOf(1) }
    var site by rememberSaveable { mutableStateOf(state.workspace.arr("sites").objects().firstOrNull()?.string("id").orEmpty()) }
    var session by rememberSaveable { mutableStateOf("") }; var candidatesJson by rememberSaveable { mutableStateOf("[]") }
    val candidates = remember(candidatesJson) { JSONArray(candidatesJson).objects() }
    var building by rememberSaveable { mutableStateOf("") }; var floor by rememberSaveable { mutableStateOf("") }; var location by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(categories[0]) }; var item by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }; var description by rememberSaveable { mutableStateOf("") }; var visibility by rememberSaveable { mutableStateOf(if (state.organisation.string("type") == "School") "private" else "shared") }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    var photoPath by rememberSaveable { mutableStateOf("") }; var receivedAt by rememberSaveable { mutableLongStateOf(0L) }; var accuracy by rememberSaveable { mutableDoubleStateOf(0.0) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val locations = state.workspace.arr("locations").objects()
    val floors = locations.filter { it.string("building_id") == building }.map { it.string("floor") }.distinct()
    val rooms = locations.filter { it.string("building_id") == building && it.string("floor") == floor }
    fun locate() { scope.launch { busy = true; error = ""; try {
        val position = device.position()
        val result = state.action("start_report", jsonObject("siteId" to site, "position" to position.toJson()))
        session = result.string("sessionId"); candidatesJson = result.arr("candidates").toString()
        building = result.arr("candidates").objects().singleOrNull()?.string("id").orEmpty(); floor = ""; location = ""; receivedAt = 0; step = 2
    } catch (e: Exception) { error = e.message.orEmpty() } finally { busy = false } } }
    val locationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants -> if (grants[Manifest.permission.ACCESS_FINE_LOCATION] == true) locate() else error = "Precise location is required for a new complaint. Tracking existing complaints remains available." }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        if (success) scope.launch { busy = true; error = ""; receivedAt = 0
            try {
                val position = device.position()
                val jpeg = device.preparePhoto(File(photoPath), position)
                val result = state.api.uploadPhoto(state.orgId, session, location, position, jpeg)
                receivedAt = result.long("receivedAt"); accuracy = result.double("accuracy")
            } catch (e: Exception) { error = e.message.orEmpty() } finally { busy = false }
        } else { error = "No photo was captured. Open the camera to try again."; receivedAt = 0 }
    }
    fun openCamera() {
        error = ""; receivedAt = 0
        if (photoPath.isNotEmpty()) File(photoPath).delete()
        val folder = File(context.cacheDir, "report_photos").apply { mkdirs() }
        val file = File.createTempFile("report-", ".jpg", folder); photoPath = file.path
        try { takePhoto.launch(FileProvider.getUriForFile(context, context.packageName + ".photos", file)) }
        catch (e: Exception) { error = "A camera app could not open. Check camera availability and retry." }
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed -> if (allowed) openCamera() else error = "Camera permission is required for a new complaint photo." }
    LaunchedEffect(receivedAt) { if (receivedAt > 0) while (true) { now = System.currentTimeMillis(); delay(1000) } }
    val photoFresh = receivedAt > 0 && now - receivedAt < 115000
    fun back() { if (!busy) { if (photoPath.isNotEmpty()) File(photoPath).delete(); onBack() } }
    BackHandler { if (!busy && step > 1) { step--; receivedAt = 0 } else back() }
    Scaffold(topBar = { TopAppBar(title = { Text("Raise complaint") }, navigationIcon = { IconButton({ back() }, enabled = !busy) { Icon(Icons.Outlined.ArrowBack, "Back to complaints") } }) }, containerColor = Canvas) { padding ->
        Column(Modifier.padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { listOf("Location", "Details", "Photo").forEachIndexed { index, label ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { Surface(color = if (step >= index + 1) Teal else Line, shape = MaterialTheme.shapes.extraLarge) { Text((index + 1).toString(), Modifier.padding(horizontal = 10.dp, vertical = 5.dp), color = if (step >= index + 1) Color.White else Muted, fontSize = 12.sp) }; Text(label, fontSize = 13.sp, color = if (step >= index + 1) Teal else Muted) }
            } }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error.isNotEmpty()) Notice(error, true)
            when (step) {
                1 -> {
                    Panel {
                        Icon(Icons.Outlined.MyLocation, null, Modifier.size(42.dp), tint = Teal)
                        Text("Let’s locate the issue", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        Text("We check your location only for a new report. You can follow complaints from anywhere.", color = Muted)
                        Picker("Site", site, state.workspace.arr("sites").objects().map { it.string("id") to it.string("name") }, { site = it })
                        if (state.workspace.arr("sites").length() == 0) Notice("Your administrator must add a site, building and area first.")
                        PrimaryButton(if (busy) "Checking location…" else "Check my location", !busy && site.isNotEmpty()) {
                            if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) locate()
                            else locationPermission.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
                        }
                    }
                    Notice("Need urgent help? ${state.organisation.string("emergency_contact", "Contact your campus administrator.")}\nDo not approach a hazard to take a photo.")
                    TextButton({ back() }) { Text("Back to my complaints") }
                }
                2 -> {
                    Notice("Site location check passed. Confirm the building, then select the floor and area. GPS cannot identify the floor.")
                    Panel {
                        Picker("Building or zone", building, candidates.map { it.string("id") to (it.string("name") + if (it.bool("confident")) " · suggested" else "") }, { building = it; floor = ""; location = "" })
                        Picker("Floor", floor, floors.map { it to it }, { floor = it; location = "" })
                        Picker("Room or area", location, rooms.map { it.string("id") to it.string("name") }, { location = it })
                        Picker("Category", category, categories.map { it to it }, { category = it })
                        FormField("Which item?", item, { item = it.take(200) })
                        FormField("Issue title", title, { title = it.take(160) })
                        FormField("What happened?", description, { description = it.take(3000) }, multiline = true)
                        if (state.organisation.string("type") != "School" && rooms.find { it.string("id") == location }?.bool("private") != true) Picker("Visibility", visibility, listOf("shared" to "Shared summary", "private" to "Private issue"), { visibility = it })
                        else Text("This area’s complaints are private to you and authorised staff.", color = Muted, fontSize = 13.sp)
                    }
                    val similar = state.tickets.filter { it.string("location_id") == location && it.string("category") == category && it.string("status") !in listOf("resolved", "closed") && it.string("verification") != "duplicate" }.take(3)
                    if (similar.isNotEmpty()) Panel { Text("Already reported?", fontWeight = FontWeight.Bold); Text("Follow an existing issue if it is the same fault.", color = Muted, fontSize = 14.sp); similar.forEach { ticket -> Text(ticket.string("title")); OutlinedButton({ onFollow(ticket) }) { Text("Follow this complaint") } } }
                    PrimaryButton("Continue to photo", !busy) {
                        if (location.isEmpty() || item.isBlank() || title.trim().length < 8 || description.trim().length < 15) error = "Choose the area, name the item, add a title of at least 8 characters and a description of at least 15 characters."
                        else { error = ""; step = 3; receivedAt = 0 }
                    }
                    TextButton({ step = 1; error = "" }) { Text("Recheck location") }
                }
                3 -> {
                    Panel {
                        Text(title, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                        Text("${candidates.find { it.string("id") == building }?.string("name")} · $floor · ${rooms.find { it.string("id") == location }?.string("name")}", color = Muted, fontSize = 14.sp)
                        Text("Photograph the faulty item and its surroundings. Avoid including people.", color = Muted, fontSize = 14.sp)
                        val bitmap = remember(photoPath, receivedAt) { if (receivedAt > 0) BitmapFactory.decodeFile(photoPath) else null }
                        if (bitmap != null) Image(bitmap.asImageBitmap(), "Captured issue photo", Modifier.fillMaxWidth().height(220.dp), contentScale = ContentScale.Crop)
                        else EmptyState("Photo evidence is required", "Use your camera to capture the issue now.", Icons.Outlined.PhotoCamera)
                        OutlinedButton({ if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) openCamera() else cameraPermission.launch(Manifest.permission.CAMERA) }, Modifier.fillMaxWidth(), enabled = !busy) { Icon(Icons.Outlined.PhotoCamera, null); Spacer(Modifier.width(8.dp)); Text(if (receivedAt > 0) "Retake photo" else "Open camera") }
                        if (receivedAt > 0) Notice(if (photoFresh) "Photo and location received · ±${accuracy.toInt()} m\nSubmit within ${((115000 - (now - receivedAt)) / 1000).coerceAtLeast(0)} seconds." else "The photo evidence expired. Please take a fresh photo.", !photoFresh)
                    }
                    PrimaryButton(if (busy) "Please wait…" else "Submit for verification", !busy && photoFresh) {
                        scope.launch { busy = true; error = ""; try {
                            val result = state.action("submit", jsonObject("sessionId" to session, "locationId" to location, "title" to title.trim(), "description" to description.trim(), "item" to item.trim(), "category" to category, "visibility" to visibility))
                            if (photoPath.isNotEmpty()) File(photoPath).delete()
                            onCreated(result.string("id"))
                        } catch (e: Exception) { error = e.message.orEmpty() } finally { busy = false } }
                    }
                    TextButton({ step = 2; receivedAt = 0; error = "" }, enabled = !busy) { Text("Edit details") }
                    Text("Location and photo evidence support staff verification. They do not automatically verify the reported fault.", fontSize = 12.sp, color = Muted)
                }
            }
        }
    }
}
