package com.campuscare.app

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun TicketScreen(state: AppState, onBack: () -> Unit, onChanged: () -> Unit) {
    val data = state.detail ?: return; val ticket = data.obj("ticket"); val scope = rememberCoroutineScope()
    var image by remember(ticket.string("id")) { mutableStateOf<ByteArray?>(null) }
    var imageError by remember { mutableStateOf("") }; var error by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    var action by remember { mutableStateOf("") }; var note by remember { mutableStateOf("") }; var assignee by remember { mutableStateOf("") }; var duplicate by remember { mutableStateOf("") }; var priority by remember { mutableStateOf(ticket.string("priority", "Medium")) }
    val actions = availableActions(ticket, state.member, data.bool("own"))
    LaunchedEffect(ticket.string("id"), data.obj("evidence").bool("available")) {
        if (data.obj("evidence").bool("available")) try { image = state.api.photo(state.orgId, ticket.string("id")) } catch (e: Exception) { imageError = e.message.orEmpty() }
    }
    Scaffold(topBar = { TopAppBar(title = { Text(ticket.string("ticket_no")) }, navigationIcon = { IconButton(onBack) { Icon(Icons.Outlined.ArrowBack, "Back") } }, actions = { IconButton({ onChanged() }) { Icon(Icons.Outlined.Refresh, "Refresh complaint") } }) }, containerColor = Canvas) { padding ->
        Column(Modifier.padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            StatusPill(ticketStatus(ticket))
            Text(ticket.string("title"), fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold)
            Text("${ticket.string("building")} · ${ticket.string("floor")} · ${ticket.string("room")}", color = Muted)
            Panel {
                Text("Complaint details", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text(ticket.string("description"))
                Text("Item: ${ticket.string("item")}", fontSize = 14.sp)
                Text("${ticket.string("category")} · ${ticket.string("priority")} priority", color = Muted, fontSize = 13.sp)
                Text("Reported ${shortDate(ticket.long("created_at"))}", color = Muted, fontSize = 13.sp)
                if (ticket.string("assignee_name").isNotEmpty()) Text("Assigned to ${ticket.string("assignee_name")}", color = Teal, fontWeight = FontWeight.Medium)
                if (ticket.bool("demo")) Notice("Fictional sample complaint. No real photo or location was collected.")
            }
            Panel {
                Text("Photo & location", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                val bitmap = remember(image) { image?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }
                if (bitmap != null) Image(bitmap.asImageBitmap(), "Complaint evidence", Modifier.fillMaxWidth().height(240.dp), contentScale = ContentScale.Fit)
                if (imageError.isNotEmpty()) Notice(imageError, true)
                if (data.obj("evidence").bool("available")) {
                    val e = data.obj("evidence")
                    Text("Location check passed at capture", color = Teal, fontWeight = FontWeight.SemiBold)
                    Text("${"%.5f".format(e.double("latitude"))}, ${"%.5f".format(e.double("longitude"))} · ±${e.double("accuracy").toInt()} m\nReceived ${shortDate(e.long("received_at"))}", color = Muted, fontSize = 13.sp)
                    Text("Floor and room are reporter-selected. Staff review this supporting evidence.", fontSize = 13.sp, color = Muted)
                } else Text(if (ticket.bool("demo")) "No evidence is attached to sample records." else "Evidence is private to the reporter and authorised staff.", color = Muted, fontSize = 14.sp)
            }
            if (actions.isNotEmpty()) Panel {
                Text("Next action", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                if (error.isNotEmpty()) Notice(error, true)
                Picker("Action", action, actions, { action = it })
                if (action == "assign") Picker("Assign to", assignee, state.workspace.arr("members").objects().filter { m -> m.bool("active") && m.string("role") in listOf("admin", "technician") && (m.string("role") == "admin" || m.string("site_scope") == "*" || ticket.string("site_id") in m.string("site_scope").split(',')) }.map { it.string("id") to it.string("name") }, { assignee = it })
                if (action == "duplicate") Picker("Original complaint", duplicate, state.tickets.filter { it.string("id") != ticket.string("id") && it.string("verification") != "duplicate" }.map { it.string("id") to (it.string("ticket_no") + " · " + it.string("title")) }, { duplicate = it })
                if (action == "verify") Picker("Verified priority", priority, listOf("Low", "Medium", "High").map { it to it }, { priority = it })
                if (action.isNotEmpty()) {
                    FormField(if (action == "resolve") "Repair summary" else "Note or reason", note, { note = it.take(2000) }, multiline = true)
                    if (action == "request_reopen") Text("Reopening concerns this same fault and requires staff review. A different fault needs a new on-site report.", color = Muted, fontSize = 13.sp)
                    PrimaryButton(if (busy) "Saving…" else "Save update", !busy && note.trim().length >= 4 && (action != "assign" || assignee.isNotEmpty()) && (action != "duplicate" || duplicate.isNotEmpty())) {
                        scope.launch { busy = true; error = ""; try {
                            val values = jsonObject("ticketId" to ticket.string("id"), "event" to action, "note" to note.trim(), "version" to ticket.int("version"), "priority" to priority)
                            if (assignee.isNotEmpty()) values.put("assigneeId", assignee)
                            if (duplicate.isNotEmpty()) values.put("duplicateId", duplicate)
                            state.action("ticket_action", values); state.detail = state.api.detail(state.orgId, ticket.string("id")); state.refresh(); action = ""; note = ""
                        } catch (e: Exception) { error = e.message.orEmpty() } finally { busy = false } }
                    }
                }
            }
            Panel {
                Text("Activity timeline", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                if (data.arr("events").length() == 0) Text("Detailed updates are available to the reporter and authorised staff.", color = Muted)
                data.arr("events").objects().forEach { event ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { Icon(Icons.Outlined.CheckCircleOutline, null, tint = Teal, modifier = Modifier.size(20.dp)); Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(event.string("action").replace('_', ' ').replaceFirstChar { it.uppercase() }, fontWeight = FontWeight.SemiBold)
                        Text(event.string("note"), fontSize = 14.sp)
                        Text("${event.string("actor")} · ${shortDate(event.long("created_at"))}", color = Muted, fontSize = 12.sp)
                    } }
                    HorizontalDivider(color = Line)
                }
            }
        }
    }
}
