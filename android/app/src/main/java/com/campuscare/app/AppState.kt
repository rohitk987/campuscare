package com.campuscare.app

import androidx.compose.runtime.*
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

class AppState(val api: ApiClient) {
    private val requestEpoch = AtomicLong(0)
    init { api.onAccessLost = { failure -> clearAccess(); error = failure.message } }
    var bootstrap by mutableStateOf<JSONObject?>(null)
    var workspace by mutableStateOf(JSONObject())
    var orgId by mutableStateOf("")
    var loading by mutableStateOf(false)
    var error by mutableStateOf("")
    var detail by mutableStateOf<JSONObject?>(null)
    var authenticated by mutableStateOf(false)
    val organisations get() = bootstrap?.arr("organisations")?.objects().orEmpty()
    val organisation get() = organisations.find { it.string("id") == orgId } ?: JSONObject()
    val user get() = bootstrap?.obj("user") ?: JSONObject()
    val isPilot get() = bootstrap?.obj("pilot")?.string("organisationId") == "bmsit-pilot"
    val member get() = workspace.obj("member")
    val tickets get() = workspace.arr("tickets").objects()
    val isAdmin get() = member.string("role") == "admin"
    val canReview get() = member.string("role") in listOf("admin", "verifier")
    private fun sameIdentity(first: JSONObject, second: JSONObject) =
        first.string("id") == second.string("id") && first.string("email").trim().equals(second.string("email").trim(), true)
    fun clearAccess() {
        requestEpoch.incrementAndGet(); api.cancelPendingRequests()
        bootstrap = null; workspace = JSONObject(); detail = null; orgId = ""; authenticated = false
    }
    suspend fun connect() {
        val generation = requestEpoch.incrementAndGet()
        api.cancelPendingRequests()
        api.initialise()
        if (generation != requestEpoch.get()) return
        val result = api.bootstrap()
        if (generation != requestEpoch.get()) return
        val available = result.arr("organisations").objects()
        val selected = available.find { it.string("id") == orgId } ?: available.firstOrNull()
            ?: throw ApiException(403, "Your BMSIT workspace is unavailable.", true).also { api.onAccessLost?.invoke(it) }
        val id = selected.string("id")
        val nextWorkspace = api.workspace(id)
        if (generation != requestEpoch.get()) return
        val nextUser = result.obj("user")
        val bound = nextWorkspace.obj("accessIdentity")
        if (!sameIdentity(bound, nextUser)) {
            clearAccess(); throw ApiException(401, "Your account changed. Verify your BMSIT email again.", true)
        }
        if (!sameIdentity(user, nextUser)) detail = null
        bootstrap = result
        orgId = id
        workspace = nextWorkspace
        authenticated = true
    }
    suspend fun refresh() {
        if (orgId.isEmpty()) return
        val generation = requestEpoch.get(); val next = api.workspace(orgId)
        if (generation != requestEpoch.get()) return
        if (!sameIdentity(next.obj("accessIdentity"), user)) {
            clearAccess(); throw ApiException(401, "Your account changed. Verify your BMSIT email again.", true)
        }
        workspace = next
    }
    suspend fun selectOrg(id: String) { orgId = id; detail = null; workspace = JSONObject(); refresh() }
    suspend fun openTicket(id: String) { val generation = requestEpoch.get(); val next = api.detail(orgId, id); if (generation == requestEpoch.get()) detail = next }
    suspend fun action(name: String, values: JSONObject = JSONObject()) = api.request(name, values.put("orgId", orgId))
}

fun ticketStatus(t: JSONObject): String = when {
    t.string("reopen") == "pending" -> "Reopening requested"
    t.string("verification") == "pending" -> "Pending verification"
    t.string("verification") == "needs_info" -> "Needs information"
    t.string("verification") == "not_confirmed" -> "Not confirmed"
    t.string("verification") == "duplicate" -> "Duplicate"
    else -> mapOf("awaiting_assignment" to "Awaiting assignment", "assigned" to "Assigned", "in_progress" to "In progress", "on_hold" to "On hold", "resolved" to "Resolved", "closed" to "Closed")[t.string("status")] ?: "Submitted"
}

fun availableActions(t: JSONObject, member: JSONObject, own: Boolean): List<Pair<String,String>> {
    val admin = member.string("role") == "admin"
    val reviewer = admin || member.string("role") == "verifier"
    val worker = admin || member.string("role") == "technician" && t.string("assignee_id") == member.string("id")
    val verified = t.string("verification") == "verified"
    val status = t.string("status")
    return buildList {
        if (reviewer && t.string("verification") in listOf("pending", "needs_info")) {
            add("verify" to "Verify issue"); add("needs_info" to "Request information")
            add("not_confirmed" to "Mark not confirmed"); add("duplicate" to "Link duplicate")
        }
        if (admin && verified && status in listOf("awaiting_assignment", "assigned", "on_hold")) add("assign" to "Assign maintenance")
        if (worker && verified && status in listOf("assigned", "on_hold")) add("start" to if (status == "on_hold") "Resume repair" else "Start repair")
        if (worker && status in listOf("assigned", "in_progress")) add("hold" to "Put on hold")
        if (worker && verified && status in listOf("assigned", "in_progress", "on_hold")) add("resolve" to "Mark resolved")
        if ((own || admin) && status == "resolved" && t.string("reopen") != "pending") add("close" to "Confirm resolution")
        if (own && status in listOf("resolved", "closed") && t.string("reopen") != "pending") add("request_reopen" to "Request reopening")
        if (reviewer && t.string("reopen") == "pending") { add("approve_reopen" to "Accept reopening"); add("decline_reopen" to "Decline reopening") }
        if (own && t.string("verification") in listOf("needs_info", "not_confirmed")) add("clarify" to "Provide information")
        if (own || reviewer || worker) add("comment" to "Add an update")
    }
}
