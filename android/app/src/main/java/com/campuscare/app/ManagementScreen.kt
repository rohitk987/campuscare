package com.campuscare.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

private data class ManagementEditor(
    val kind: String,
    val record: JSONObject = JSONObject(),
    val siteId: String = "",
    val buildingId: String = "",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManagementScreen(state: AppState, page: String, onBack: () -> Unit, onChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember(page, state.orgId) { mutableStateOf("") }
    var success by remember(page, state.orgId) { mutableStateOf("") }
    var editor by remember(page, state.orgId) { mutableStateOf<ManagementEditor?>(null) }
    var deactivate by remember(page, state.orgId) { mutableStateOf<JSONObject?>(null) }
    val perform: (String, suspend () -> Unit) -> Unit = { message, work ->
        if (!busy) scope.launch {
            busy = true; error = ""; success = ""
            try {
                work()
                editor = null; deactivate = null
                success = message
                onChanged()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                error = failure.message ?: "We could not save this change. Please retry."
            } finally { busy = false }
        }
    }
    val edit: (ManagementEditor) -> Unit = { error = ""; success = ""; editor = it }

    Scaffold(
        containerColor = Canvas,
        topBar = {
            TopAppBar(title = { Text(page, fontWeight = FontWeight.SemiBold) }, navigationIcon = {
                IconButton(onClick = onBack, enabled = !busy) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                }
            }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Canvas))
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (page != "Create workspace") Text(state.organisation.string("name"), color = Muted, fontSize = 14.sp)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Teal)
            if (error.isNotBlank() && editor == null && deactivate == null) Notice(error, error = true)
            if (success.isNotBlank()) Notice(success)
            when (page) {
                "Locations" -> LocationManagement(state, busy, edit)
                "People" -> PeopleManagement(state, busy, edit) { member -> error = ""; deactivate = member }
                "Settings" -> WorkspaceSettings(state, busy) { payload ->
                    perform("Workspace settings saved.") {
                        state.action("save_settings", payload)
                        state.bootstrap = state.api.bootstrap()
                        state.refresh()
                    }
                }
                "Create workspace" -> CreateWorkspaceForm(busy) { payload ->
                    perform("Workspace created. Add your sites, locations and members to get started.") {
                        val result = state.api.request("create_org", payload)
                        state.bootstrap = state.api.bootstrap()
                        state.selectOrg(result.string("orgId"))
                    }
                }
                else -> Notice("This management page is unavailable.", error = true)
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    editor?.let { current ->
        ManagementFormDialog(state, current, busy, error, onDismiss = { if (!busy) { editor = null; error = "" } }) { action, payload ->
            perform(if (action == "invite_member") "Member access added. They can sign in with their approved email." else "Location saved.") {
                state.action(action, payload)
                state.refresh()
            }
        }
    }
    deactivate?.let { person ->
        AlertDialog(onDismissRequest = { if (!busy) deactivate = null }, title = { Text("Deactivate member?") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${person.string("name")} will lose access to this workspace. Existing complaint history is retained.")
                if (error.isNotBlank()) Notice(error, error = true)
            } }, confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    perform("Member access deactivated.") {
                        state.action("deactivate_member", jsonObject("memberId" to person.string("id")))
                        state.refresh()
                    }
                }) { Text(if (busy) "Saving…" else "Deactivate", color = Coral) }
            }, dismissButton = { TextButton(onClick = { deactivate = null }, enabled = !busy) { Text("Cancel") } })
    }
}

@Composable
private fun LocationManagement(state: AppState, busy: Boolean, edit: (ManagementEditor) -> Unit) {
    val sites = state.workspace.objects("sites")
    val buildings = state.workspace.objects("buildings")
    val locations = state.workspace.objects("locations")
    Notice("Locations identify where a fault is reported. Device location suggests a building; the reporter selects the floor and room.")
    if (state.isAdmin) PrimaryButton("Add site", enabled = !busy) { edit(ManagementEditor("site")) }
    if (sites.isEmpty()) EmptyState("No sites yet", if (state.isAdmin) "Add a site, its buildings and reporting areas." else "Your administrator has not assigned any sites to your account.")
    sites.forEach { site ->
        val siteId = site.string("id")
        Panel {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(site.string("name"), fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    Text(if (site.bool("enabled")) "Reporting enabled" else "Reporting disabled", color = Muted, fontSize = 13.sp)
                }
                if (state.isAdmin) IconButton(enabled = !busy, onClick = { edit(ManagementEditor("site", site)) }) {
                    Icon(Icons.Outlined.Edit, contentDescription = "Edit ${site.string("name")}", tint = Teal)
                }
            }
            if (state.isAdmin) {
                Text("Boundary: ${coordinateText(site)} · ${site.int("radius")} m radius", color = Muted, fontSize = 12.sp)
                TextButton(enabled = !busy, onClick = { edit(ManagementEditor("building", siteId = siteId)) }) {
                    Icon(Icons.Outlined.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Add building or zone")
                }
            }
            val siteBuildings = buildings.filter { it.string("site_id") == siteId }
            if (siteBuildings.isEmpty()) Text("No buildings or zones configured.", color = Muted)
            siteBuildings.forEach { building ->
                HorizontalDivider(color = Line)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(building.string("name"), Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    if (state.isAdmin) IconButton(enabled = !busy, onClick = {
                        edit(ManagementEditor("building", building, siteId))
                    }) { Icon(Icons.Outlined.Edit, "Edit ${building.string("name")}", Modifier.size(20.dp), tint = Teal) }
                }
                val rooms = locations.filter { it.string("building_id") == building.string("id") }
                rooms.groupBy { it.string("floor") }.forEach { (floor, floorRooms) ->
                    Text(floor, color = Teal, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    floorRooms.forEach { room ->
                        Row(Modifier.fillMaxWidth().padding(start = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(room.string("name"), Modifier.weight(1f), fontSize = 14.sp)
                            if (room.bool("private")) Text("Private", fontSize = 12.sp, color = Muted)
                        }
                    }
                }
                if (rooms.isEmpty()) Text("No reporting areas yet.", color = Muted, fontSize = 13.sp)
                if (state.isAdmin) TextButton(enabled = !busy, onClick = {
                    edit(ManagementEditor("area", siteId = siteId, buildingId = building.string("id")))
                }) { Text("Add room or area") }
            }
        }
    }
}

@Composable
private fun PeopleManagement(state: AppState, busy: Boolean, edit: (ManagementEditor) -> Unit, deactivate: (JSONObject) -> Unit) {
    if (!state.isAdmin) {
        Notice("Only workspace administrators can view and manage member access.")
        return
    }
    val sites = state.workspace.objects("sites")
    Notice("Approve a member’s email and role. They must sign in using that email; this prototype does not send invitation emails.")
    PrimaryButton("Add member", enabled = !busy) { edit(ManagementEditor("member")) }
    val people = state.workspace.objects("members")
    if (people.isEmpty()) EmptyState("No members", "Add the people who report, verify and repair facility issues.")
    people.forEach { person ->
        Panel {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(person.string("name"), Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                if (!person.bool("active")) Text("Inactive", color = Muted, fontSize = 12.sp)
                else if (person.string("id") == state.member.string("id")) Text("You", color = Teal, fontSize = 12.sp)
            }
            Text(person.string("email"), color = Muted, fontSize = 14.sp)
            Text(roleLabel(person.string("role")), fontSize = 14.sp, fontWeight = FontWeight.Medium)
            val scope = person.string("site_scope")
            Text(if (person.string("role") == "admin" || scope == "*") "All sites" else {
                scope.split(',').map { id -> sites.find { it.string("id") == id }?.string("name") ?: "Unavailable site" }.joinToString(", ")
            }, color = Muted, fontSize = 13.sp)
            if (person.string("user_id").isBlank() && person.bool("active")) Text("Awaiting first sign-in", color = Muted, fontSize = 12.sp)
            if (person.bool("active") && person.string("id") != state.member.string("id")) {
                TextButton(onClick = { deactivate(person) }, enabled = !busy) { Text("Deactivate access", color = Coral) }
            }
        }
    }
}

@Composable
private fun WorkspaceSettings(state: AppState, busy: Boolean, save: (JSONObject) -> Unit) {
    val org = state.organisation
    Panel {
        Text("Emergency contacts", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(org.string("emergency_contact", "Contact your site administrator for emergency assistance."))
        Notice("For immediate danger, contact site security or the emergency contact directly. Do not approach a hazard to take a photo or wait for a complaint to be reviewed.")
    }
    if (!state.isAdmin) return
    var name by remember(state.orgId, org.string("name")) { mutableStateOf(org.string("name")) }
    var color by remember(state.orgId, org.string("color")) { mutableStateOf(org.string("color", "#164E50")) }
    var accuracy by remember(state.orgId, org.string("max_accuracy")) { mutableStateOf(org.string("max_accuracy", "50")) }
    var hours by remember(state.orgId, org.string("response_hours")) { mutableStateOf(org.string("response_hours", "24")) }
    var emergency by remember(state.orgId, org.string("emergency_contact")) { mutableStateOf(org.string("emergency_contact")) }
    var identifier by remember(state.orgId, org.string("identifier_label")) { mutableStateOf(org.string("identifier_label", "Member ID")) }
    val valid = validText(name) && color.matches(Regex("^#[0-9a-fA-F]{6}$")) &&
        boundedNumber(accuracy, 5.0, 100.0) != null && boundedNumber(hours, 1.0, 720.0) != null &&
        validText(emergency) && validText(identifier)
    Panel {
        Text("Workspace settings", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        FormField("Workspace name", name, { name = it })
        FormField("Brand colour (#RRGGBB)", color, { color = it })
        FormField("Maximum location uncertainty (5–100 m)", accuracy, { accuracy = it })
        Text("Lower values require more accurate readings. Test the setting at your sites before changing it.", color = Muted, fontSize = 12.sp)
        FormField("Response target (1–720 hours)", hours, { hours = it })
        FormField("Emergency contact / instructions", emergency, { emergency = it }, multiline = true)
        FormField("Member identifier label", identifier, { identifier = it })
        PrimaryButton(if (busy) "Saving…" else "Save settings", enabled = !busy && valid) {
            save(jsonObject("name" to name.trim(), "color" to color, "max_accuracy" to accuracy.toDouble(),
                "response_hours" to hours.toDouble(), "emergency_contact" to emergency.trim(), "identifier_label" to identifier.trim()))
        }
    }
}

@Composable
private fun CreateWorkspaceForm(busy: Boolean, save: (JSONObject) -> Unit) {
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("College") }
    Notice("Create a separate workspace with its own members, sites, complaint records and maintenance teams.")
    Panel {
        FormField("Workspace name", name, { name = it })
        Picker("Organisation type", type, listOf("College", "School", "Office", "Residential", "Other").map { it to it }, { type = it }, enabled = !busy)
        if (type == "School") Text("School complaints are private to the reporter and authorised staff.", color = Muted, fontSize = 13.sp)
        PrimaryButton(if (busy) "Creating…" else "Create workspace", enabled = !busy && validText(name)) {
            save(jsonObject("name" to name.trim(), "type" to type))
        }
    }
}

@Composable
private fun ManagementFormDialog(
    state: AppState, editor: ManagementEditor, busy: Boolean, error: String,
    onDismiss: () -> Unit, save: (String, JSONObject) -> Unit,
) {
    val title = when (editor.kind) {
        "site" -> if (editor.record.string("id").isEmpty()) "Add site" else "Edit site"
        "building" -> if (editor.record.string("id").isEmpty()) "Add building or zone" else "Edit building or zone"
        "area" -> "Add room or area"
        else -> "Add member"
    }
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxWidth().heightIn(max = 680.dp).imePadding()
                .verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, Modifier.weight(1f), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    IconButton(onClick = onDismiss, enabled = !busy) { Icon(Icons.Outlined.Close, "Close form") }
                }
                if (error.isNotBlank()) Notice(error, error = true)
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                when (editor.kind) {
                    "site", "building" -> BoundaryForm(state, editor, busy, save)
                    "area" -> AreaForm(state, editor, busy, save)
                    "member" -> MemberForm(state, busy, save)
                }
            }
        }
    }
}

@Composable
private fun BoundaryForm(state: AppState, editor: ManagementEditor, busy: Boolean, save: (String, JSONObject) -> Unit) {
    val record = editor.record
    val isSite = editor.kind == "site"
    val existing = record.string("id").isNotEmpty()
    val sites = state.workspace.objects("sites")
    var siteId by remember { mutableStateOf(editor.siteId) }
    var name by remember { mutableStateOf(record.string("name")) }
    var latitude by remember { mutableStateOf(record.string("latitude")) }
    var longitude by remember { mutableStateOf(record.string("longitude")) }
    var radius by remember { mutableStateOf(record.string("radius", if (isSite) "250" else "40")) }
    var enabled by remember { mutableStateOf(record.bool("enabled")) }
    if (!isSite) Picker("Parent site", siteId, sites.map { it.string("id") to it.string("name") }, { siteId = it }, enabled = !busy && !existing)
    FormField(if (isSite) "Site name" else "Building / zone name", name, { name = it })
    Notice("This prototype uses a circular boundary. Enter its centre coordinates and radius after checking the actual site map.")
    FormField("Centre latitude (−90 to 90)", latitude, { latitude = it })
    FormField("Centre longitude (−180 to 180)", longitude, { longitude = it })
    FormField(if (isSite) "Radius (10–5000 m)" else "Radius (5–1000 m)", radius, { radius = it })
    if (isSite) Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text("Enable new reports", fontWeight = FontWeight.Medium); Text("Requires a configured building and room.", color = Muted, fontSize = 12.sp) }
        Switch(checked = enabled, onCheckedChange = { enabled = it }, enabled = !busy)
    }
    val lat = boundedNumber(latitude, -90.0, 90.0)
    val lng = boundedNumber(longitude, -180.0, 180.0)
    val rad = boundedNumber(radius, if (isSite) 10.0 else 5.0, if (isSite) 5000.0 else 1000.0)
    val valid = validText(name) && lat != null && lng != null && rad != null &&
        (isSite || sites.any { it.string("id") == siteId })
    PrimaryButton(if (busy) "Saving…" else "Save ${if (isSite) "site" else "building"}", enabled = !busy && valid) {
        val payload = jsonObject("name" to name.trim(), "latitude" to lat, "longitude" to lng, "radius" to rad)
        if (existing) payload.put("id", record.string("id"))
        if (isSite) payload.put("enabled", enabled) else payload.put("siteId", siteId)
        save(if (isSite) "save_site" else "save_building", payload)
    }
}

@Composable
private fun AreaForm(state: AppState, editor: ManagementEditor, busy: Boolean, save: (String, JSONObject) -> Unit) {
    val sites = state.workspace.objects("sites")
    val buildings = state.workspace.objects("buildings")
    var siteId by remember { mutableStateOf(editor.siteId) }
    var buildingId by remember { mutableStateOf(editor.buildingId) }
    var floor by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var privateArea by remember { mutableStateOf(false) }
    val choices = buildings.filter { it.string("site_id") == siteId }
    Picker("Parent site", siteId, sites.map { it.string("id") to it.string("name") }, { siteId = it; buildingId = ""; floor = "" }, enabled = !busy)
    Picker("Building or zone", buildingId, choices.map { it.string("id") to it.string("name") }, { buildingId = it; floor = "" }, enabled = !busy)
    val existingFloors = state.workspace.objects("locations").filter { it.string("building_id") == buildingId }
        .map { it.string("floor") }.distinct()
    if (existingFloors.isNotEmpty()) Picker("Use an existing floor", floor, existingFloors.map { it to it }, { floor = it }, enabled = !busy)
    FormField("Floor / level", floor, { floor = it })
    Text("Use a consistent label such as Ground floor, Second floor or Outdoor.", color = Muted, fontSize = 12.sp)
    FormField("Room / area name", name, { name = it })
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text("Private area", fontWeight = FontWeight.Medium); Text("Complaints are restricted to authorised people.", color = Muted, fontSize = 12.sp) }
        Switch(checked = privateArea, onCheckedChange = { privateArea = it }, enabled = !busy)
    }
    PrimaryButton(if (busy) "Saving…" else "Add area", enabled = !busy && choices.any { it.string("id") == buildingId } && validText(floor) && validText(name)) {
        save("add_location", jsonObject("buildingId" to buildingId, "floor" to floor.trim(), "name" to name.trim(), "private" to privateArea))
    }
}

@Composable
private fun MemberForm(state: AppState, busy: Boolean, save: (String, JSONObject) -> Unit) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("reporter") }
    var allSites by remember { mutableStateOf(true) }
    var selectedSites by remember { mutableStateOf(setOf<String>()) }
    val sites = state.workspace.objects("sites")
    FormField("Full name", name, { name = it })
    FormField("Approved sign-in email", email, { email = it })
    Picker("Role", role, listOf("reporter", "verifier", "technician", "admin").map { it to roleLabel(it) }, { role = it }, enabled = !busy)
    if (role == "admin") Notice("Administrators manage the full workspace and have access to every site.")
    else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = allSites, onCheckedChange = { allSites = it }, enabled = !busy)
            Text("Access all current and future sites")
        }
        if (!allSites) {
            if (sites.isEmpty()) Notice("Add a site before assigning restricted site access.")
            sites.forEach { site ->
                val id = site.string("id")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = id in selectedSites, onCheckedChange = { checked ->
                        selectedSites = if (checked) selectedSites + id else selectedSites - id
                    }, enabled = !busy)
                    Text(site.string("name"))
                }
            }
        }
    }
    val scope = if (role == "admin" || allSites) "*" else selectedSites.sorted().joinToString(",")
    val validEmail = email.trim().length <= 200 && android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()
    PrimaryButton(if (busy) "Saving…" else "Add member access", enabled = !busy && validText(name) && validEmail && scope.isNotBlank() && scope.length <= 200) {
        save("invite_member", jsonObject("name" to name.trim(), "email" to email.trim(), "role" to role, "site_scope" to scope))
    }
}

private fun validText(value: String) = value.trim().length in 1..200
private fun boundedNumber(value: String, minimum: Double, maximum: Double): Double? =
    value.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it in minimum..maximum }
private fun coordinateText(record: JSONObject): String =
    if (record.isNull("latitude") || record.isNull("longitude")) "not configured"
    else "${record.string("latitude")}, ${record.string("longitude")}"
private fun roleLabel(role: String) = when (role) {
    "admin" -> "Administrator"
    "verifier" -> "Verifier"
    "technician" -> "Maintenance staff"
    else -> "Reporter"
}
