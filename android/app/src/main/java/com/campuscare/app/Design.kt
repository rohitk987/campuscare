package com.campuscare.app

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

val Ink = Color(0xFF202932)
val Muted = Color(0xFF677580)
val Teal = Color(0xFF164E50)
val Yellow = Color(0xFFF5C842)
val Canvas = Color(0xFFF4F5F7)
val Line = Color(0xFFE5E8EB)
val Coral = Color(0xFFE95850)
val categories = listOf("Electrical", "Plumbing", "Furniture", "Classroom technology", "Drinking water", "Appliances", "Lifts", "Gym equipment", "Other")

@Composable fun CampusTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Teal, onPrimary = Color.White, primaryContainer = Color(0xFFE4EFED), onPrimaryContainer = Teal, secondary = Yellow, secondaryContainer = Color(0xFFFFF2C4), onSecondaryContainer = Ink, tertiary = Coral, background = Canvas, surface = Color.White, surfaceVariant = Canvas, onSurfaceVariant = Muted, onSurface = Ink, onBackground = Ink, outline = Line), content = content)
}
fun categoryIcon(name: String): ImageVector = when (name) {
    "Electrical" -> Icons.Outlined.Bolt
    "Plumbing", "Drinking water" -> Icons.Outlined.WaterDrop
    "Furniture" -> Icons.Outlined.Chair
    "Classroom technology" -> Icons.Outlined.Tv
    "Appliances" -> Icons.Outlined.LocalLaundryService
    "Lifts" -> Icons.Outlined.Elevator
    "Gym equipment" -> Icons.Outlined.FitnessCenter
    else -> Icons.Outlined.Build
}
@Composable fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = Color.White, border = BorderStroke(1.dp, Line)) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content) }
}
@Composable fun SectionHeading(title: String, action: String? = null, onClick: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), fontSize = 19.sp, fontWeight = FontWeight.Bold)
        if (action != null) TextButton(onClick) { Text(action, fontSize = 14.sp) }
    }
}
@Composable fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = enabled, shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.buttonColors(containerColor = Yellow, contentColor = Ink)) { Text(text, fontSize = 16.sp, fontWeight = FontWeight.Bold) }
}
@Composable fun Notice(text: String, error: Boolean = false) {
    Surface(color = if (error) Color(0xFFFFEEEE) else Color(0xFFEAF3F2), shape = RoundedCornerShape(12.dp)) {
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(if (error) Icons.Outlined.ErrorOutline else Icons.Outlined.Info, null, tint = if (error) Coral else Teal, modifier = Modifier.size(20.dp))
            Text(text, color = if (error) Color(0xFF9A312B) else Teal, fontSize = 14.sp)
        }
    }
}
@Composable fun FormField(label: String, value: String, onValueChange: (String) -> Unit, multiline: Boolean = false, modifier: Modifier = Modifier) {
    OutlinedTextField(value, onValueChange, modifier.fillMaxWidth(), label = { Text(label) }, singleLine = !multiline, minLines = if (multiline) 3 else 1, shape = RoundedCornerShape(12.dp))
}
@Composable fun Picker(label: String, value: String, options: List<Pair<String,String>>, onSelect: (String) -> Unit, enabled: Boolean = true) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label, color = Muted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 6.dp))
        Box {
            OutlinedButton({ expanded = true }, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = enabled && options.isNotEmpty(), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Line)) {
                Text(options.find { it.first == value }?.second ?: "Select ${label.lowercase()}", Modifier.weight(1f), color = if (value.isEmpty()) Muted else Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Outlined.ExpandMore, null)
            }
            DropdownMenu(expanded, { expanded = false }, modifier = Modifier.heightIn(max = 360.dp)) { options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { onSelect(id); expanded = false }) } }
        }
    }
}
@Composable fun StatusPill(label: String) {
    val color = when (label) { "Resolved", "Closed" -> Color(0xFF237452); "Pending verification", "On hold", "Needs information", "Reopening requested" -> Color(0xFF936300); "Not confirmed" -> Coral; else -> Color(0xFF356DAD) }
    Surface(color = color.copy(alpha = .09f), shape = RoundedCornerShape(6.dp)) { Text(label, Modifier.padding(horizontal = 9.dp, vertical = 5.dp), fontSize = 12.sp, color = color, fontWeight = FontWeight.Medium) }
}
@Composable fun TicketCard(t: JSONObject, onClick: () -> Unit) {
    Surface(onClick, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Line), color = Color.White, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(color = Canvas, shape = RoundedCornerShape(12.dp)) { Icon(categoryIcon(t.string("category")), null, Modifier.padding(10.dp).size(22.dp), tint = Teal) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text(t.string("category"), fontSize = 13.sp, color = Muted); Text(t.string("ticket_no"), fontSize = 12.sp, color = Muted) }
                if (t.string("priority") == "High") Text("HIGH", fontSize = 11.sp, color = Coral, fontWeight = FontWeight.Bold)
                Icon(Icons.Outlined.ChevronRight, null, tint = Muted)
            }
            Text(t.string("title"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOf(t.string("building"), t.string("floor"), t.string("room")).filter { it.isNotEmpty() }.joinToString(" · "), color = Muted, fontSize = 13.sp, maxLines = 2)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) { StatusPill(ticketStatus(t)); Text(shortDate(t.long("created_at")), color = Muted, fontSize = 12.sp) }
        }
    }
}
@Composable fun EmptyState(title: String, body: String, icon: ImageVector = Icons.Outlined.TaskAlt) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) { Icon(icon, null, Modifier.size(44.dp), tint = Teal); Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold); Text(body, color = Muted, fontSize = 14.sp) }
}
fun shortDate(time: Long): String = if (time == 0L) "" else SimpleDateFormat("d MMM, h:mm a", Locale.getDefault()).format(Date(time))
