package com.campuscare.app

import org.json.JSONArray
import org.json.JSONObject

/** Location timestamps use epoch milliseconds, matching the existing REST contract. */
data class Position(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double,
    val timestamp: Long,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("latitude", latitude)
        .put("longitude", longitude)
        .put("accuracy", accuracy)
        .put("timestamp", timestamp)
}

fun JSONObject.string(key: String, fallback: String = ""): String =
    if (!has(key) || isNull(key)) fallback else optString(key, fallback)

fun JSONObject.int(key: String, fallback: Int = 0): Int =
    if (isNull(key)) fallback else optInt(key, fallback)

fun JSONObject.long(key: String, fallback: Long = 0L): Long =
    if (isNull(key)) fallback else optLong(key, fallback)

fun JSONObject.double(key: String, fallback: Double = 0.0): Double =
    if (isNull(key)) fallback else optDouble(key, fallback)

/** D1 rows use integer flags; response-derived fields may use JSON booleans. */
fun JSONObject.bool(key: String, fallback: Boolean = false): Boolean = when (val value = opt(key)) {
    is Boolean -> value
    is Number -> value.toInt() != 0
    is String -> when (value.lowercase()) {
        "true", "1" -> true
        "false", "0" -> false
        else -> fallback
    }
    else -> fallback
}

fun JSONObject.obj(key: String): JSONObject = optJSONObject(key) ?: JSONObject()
fun JSONObject.arr(key: String): JSONArray = optJSONArray(key) ?: JSONArray()
fun JSONObject.objects(key: String): List<JSONObject> = arr(key).objects()
fun JSONObject.strings(key: String): List<String> = arr(key).strings()
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONArray.strings(): List<String> = (0 until length()).mapNotNull {
    if (isNull(it)) null else opt(it) as? String
}

fun jsonObject(vararg entries: Pair<String, Any?>): JSONObject = JSONObject().apply {
    entries.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
}

/** A display helper only. The server exclusively authorises status transitions. */
fun JSONObject.ticketStatusLabel(): String = when {
    string("reopen") == "pending" -> "Reopening requested"
    string("verification") == "pending" -> "Pending verification"
    string("verification") == "needs_info" -> "Needs information"
    string("verification") == "not_confirmed" -> "Not confirmed"
    string("verification") == "duplicate" -> "Duplicate"
    else -> when (string("status")) {
        "awaiting_assignment" -> "Awaiting assignment"
        "assigned" -> "Assigned"
        "in_progress" -> "In progress"
        "on_hold" -> "On hold"
        "resolved" -> "Resolved"
        "closed" -> "Closed"
        else -> "Submitted"
    }
}
