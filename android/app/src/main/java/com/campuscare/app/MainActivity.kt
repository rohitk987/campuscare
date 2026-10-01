package com.campuscare.app

import android.os.Bundle
import android.webkit.CookieManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.BackHandler
import androidx.activity.viewModels
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.ViewModel
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private val model by viewModels<CampusViewModel>()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val prefs = getSharedPreferences("campuscare", MODE_PRIVATE)
        if (BuildConfig.DEBUG && intent.hasExtra("server")) runCatching { ApiClient.normaliseBaseUrl(intent.getStringExtra("server")!!) }.onSuccess { prefs.edit().putString("server", it).apply() }
        setContent { CampusTheme { CampusApp(model) } }
    }
}

class CampusViewModel : ViewModel() {
    private var current: AppState? = null
    fun forServer(server: String): AppState {
        if (current?.api?.baseUrl != server) current = AppState(ApiClient(server))
        return current!!
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun CampusApp(model: CampusViewModel) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("campuscare", 0) }
    var server by remember { mutableStateOf(prefs.getString("server", DEFAULT_BASE_URL)!!) }
    val state = remember(server) { model.forServer(server).apply { if (orgId.isEmpty()) orgId = prefs.getString("organisation", "").orEmpty() } }
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableStateOf("Home") }
    var overlay by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("All") }
    var showWorkspaces by remember { mutableStateOf(false) }
    fun run(block: suspend () -> Unit) { scope.launch { state.loading = true; state.error = ""; try { block() } catch (e: Exception) { state.error = e.message ?: "Please try again."; if (e is ApiException && e.signInRequired) state.authenticated = false } finally { state.loading = false } } }
    fun openTicket(id: String) { run { state.openTicket(id); overlay = "detail" } }
    LaunchedEffect(state) { state.loading = true; try { state.connect() } catch (e: Exception) { if (e !is ApiException || !e.signInRequired) state.error = e.message.orEmpty() } finally { state.loading = false } }
    BackHandler(overlay.isNotEmpty() || tab != "Home") { if (overlay.isNotEmpty()) overlay = "" else tab = "Home" }
    if (overlay == "signin") {
        AuthScreen(state.api, onBack = { overlay = "" }, onSuccess = { run { state.connect(); overlay = "" } }); return
    }
    if (overlay == "server") {
        ServerScreen(server, onBack = { overlay = "" }, onSave = { value ->
            CookieManager.getInstance().removeAllCookies(null)
            server = value; prefs.edit().putString("server", value).apply(); overlay = ""; tab = "Home"
        }); return
    }
    if (!state.authenticated) {
        WelcomeScreen(state.loading, state.error, onSignIn = { overlay = "signin" }, onServer = { overlay = "server" }); return
    }
    if (overlay == "report") {
        ReportScreen(state, onBack = { overlay = "" }, onCreated = { id -> run { state.refresh(); state.openTicket(id); overlay = "detail" } }, onFollow = { ticket -> run { state.action("follow", jsonObject("ticketId" to ticket.string("id"))); state.refresh(); state.openTicket(ticket.string("id")); overlay = "detail" } }); return
    }
    if (overlay == "detail" && state.detail != null) {
        TicketScreen(state, onBack = { overlay = "" }, onChanged = { run { state.refresh(); state.openTicket(state.detail!!.obj("ticket").string("id")) } }); return
    }
    if (overlay in listOf("Locations", "People", "Settings", "Create workspace")) {
        ManagementScreen(state, overlay, onBack = { overlay = "" }, onChanged = { run { state.connect() } }); return
    }
    Scaffold(containerColor = Canvas, topBar = {
        Surface(color = Color.White) {
            Column(Modifier.statusBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).clickable { showWorkspaces = true }) {
                        Text("campuscare", color = Coral, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, letterSpacing = (-.4).sp)
                        Row(verticalAlignment = Alignment.CenterVertically) { Text(state.organisation.string("name", "Select workspace"), fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, false)); Icon(Icons.Outlined.ExpandMore, "Switch workspace", Modifier.size(20.dp)) }
                    }
                    IconButton({ run { state.connect() } }) { Icon(Icons.Outlined.Refresh, "Refresh") }
                    BadgedBox(badge = { if (state.workspace.arr("notifications").objects().any { it.long("read_at") == 0L }) Badge(containerColor = Coral) }) { IconButton({ tab = "Updates" }) { Icon(Icons.Outlined.NotificationsNone, "Updates") } }
                }
                if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Teal)
                HorizontalDivider(color = Line)
            }
        }
    }, bottomBar = {
        NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
            listOf("Home" to Icons.Outlined.Home, "Helpdesk" to Icons.Outlined.ConfirmationNumber, "Updates" to Icons.Outlined.NotificationsNone, "Profile" to Icons.Outlined.PersonOutline).forEach { (name, icon) ->
                NavigationBarItem(selected = tab == name, onClick = { tab = name }, icon = { Icon(icon, name) }, label = { Text(name, fontSize = 12.sp) }, colors = NavigationBarItemDefaults.colors(selectedIconColor = Teal, selectedTextColor = Teal, indicatorColor = Color(0xFFEAF3F2)))
            }
        }
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (state.error.isNotEmpty()) Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) { Box(Modifier.weight(1f)) { Notice(state.error, true) }; IconButton({ state.error = "" }) { Icon(Icons.Outlined.Close, "Dismiss error") } }
            when (tab) {
                "Home" -> HomeScreen(state, onReport = { overlay = "report" }, onHelpdesk = { value -> filter = value; tab = "Helpdesk" }, onManage = { overlay = it }, onTicket = { openTicket(it) })
                "Helpdesk" -> HelpdeskScreen(state, filter, { filter = it }, { overlay = "report" }, { openTicket(it) })
                "Updates" -> UpdatesScreen(state, onRead = { run { state.action("read_notifications"); state.refresh() } }, onTicket = { openTicket(it) })
                "Profile" -> ProfileScreen(state, onManage = { overlay = it }, onServer = { overlay = "server" }, onSignOut = {
                    scope.launch {
                        state.loading = true
                        runCatching { state.api.signOut() }
                        CookieManager.getInstance().removeAllCookies(null)
                        state.bootstrap = null; state.workspace = JSONObject(); state.detail = null; state.orgId = ""; state.authenticated = false; state.loading = false; state.error = ""; tab = "Home"
                    }
                })
            }
        }
    }
    if (showWorkspaces) ModalBottomSheet(onDismissRequest = { showWorkspaces = false }, containerColor = Color.White) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 30.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionHeading("Your workspaces")
            state.organisations.forEach { org ->
                ListItem(headlineContent = { Text(org.string("name"), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text(org.string("type")) }, leadingContent = { Icon(Icons.Outlined.Apartment, null, tint = Teal) }, trailingContent = { if (org.string("id") == state.orgId) Icon(Icons.Outlined.CheckCircle, "Selected", tint = Teal) }, modifier = Modifier.clickable { showWorkspaces = false; run { state.selectOrg(org.string("id")); prefs.edit().putString("organisation", state.orgId).apply(); tab = "Home" } })
            }
            OutlinedButton({ showWorkspaces = false; overlay = "Create workspace" }, Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Add, null); Text("Create workspace") }
        }
    }
}

@Composable private fun WelcomeScreen(loading: Boolean, error: String, onSignIn: () -> Unit, onServer: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Color.White).systemBarsPadding().verticalScroll(rememberScrollState()).padding(28.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Spacer(Modifier.height(36.dp))
        Surface(color = Teal, shape = RoundedCornerShape(24.dp)) { Icon(Icons.Outlined.Apartment, null, Modifier.padding(22.dp).size(48.dp), tint = Color.White) }
        Text("campuscare", color = Coral, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1).sp)
        Text("Good spaces.\nOne connected campus.", fontSize = 32.sp, lineHeight = 39.sp, fontWeight = FontWeight.Bold)
        Text("Report a fault. Follow the repair. Keep your shared spaces working.", color = Muted, fontSize = 17.sp, lineHeight = 25.sp)
        Panel {
            FeatureLine(Icons.Outlined.LocationOn, "Report on site", "A fresh location check and camera photo accompany every new complaint.")
            FeatureLine(Icons.Outlined.TaskAlt, "Track from anywhere", "See updates, confirm a repair, or request a review from home.")
        }
        if (error.isNotEmpty()) Notice(error, true)
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        PrimaryButton("Sign in to your workspace", !loading, onSignIn)
        Text("This preview uses your CampusCare portal’s ChatGPT sign-in. Workspace membership and portal access are required.", fontSize = 13.sp, color = Muted)
        TextButton(onServer, Modifier.align(Alignment.CenterHorizontally)) { Text("Connection settings") }
    }
}
@Composable private fun FeatureLine(icon: ImageVector, title: String, body: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { Icon(icon, null, tint = Teal, modifier = Modifier.size(24.dp)); Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { Text(title, fontWeight = FontWeight.Bold); Text(body, color = Muted, fontSize = 14.sp) } }
}
@Composable private fun HomeScreen(state: AppState, onReport: () -> Unit, onHelpdesk: (String) -> Unit, onManage: (String) -> Unit, onTicket: (String) -> Unit) {
    val open = state.tickets.count { it.string("status") !in listOf("resolved", "closed") && it.string("verification") !in listOf("duplicate", "not_confirmed") }
    val review = state.tickets.count { it.string("verification") in listOf("pending", "needs_info") || it.string("reopen") == "pending" }
    val resolved = state.tickets.count { it.string("status") in listOf("resolved", "closed") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Column { Text("Hello, ${state.user.string("name", "there").substringBefore(' ')}", fontSize = 25.sp, fontWeight = FontWeight.Bold); Text("Your campus, a little better every day.", color = Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp)) } }
        if (state.organisation.bool("demo")) item { Notice("Demo workspace · sample records. Configure real reporting boundaries before a live report.") }
        item {
            Surface(color = Color(0xFFFFF7DE), shape = RoundedCornerShape(20.dp)) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Something needs fixing?", fontSize = 21.sp, fontWeight = FontWeight.Bold); Text("Tell your facilities team in a few steps.", fontSize = 14.sp, color = Muted, modifier = Modifier.padding(top = 6.dp)) }; Icon(Icons.Outlined.Handyman, null, Modifier.size(42.dp), tint = Teal) }
                    PrimaryButton("Raise complaint", enabled = !state.loading && state.workspace.has("member"), onClick = onReport)
                }
            }
        }
        item { SectionHeading("Quick actions") }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QuickTile("My requests", Icons.Outlined.ConfirmationNumber, Modifier.weight(1f)) { onHelpdesk("Mine") }
                QuickTile(if (state.canReview) "Review queue" else "Following", if (state.canReview) Icons.Outlined.FactCheck else Icons.Outlined.Bookmarks, Modifier.weight(1f)) { onHelpdesk(if (state.canReview) "Review" else "Following") }
                QuickTile("Locations", Icons.Outlined.Apartment, Modifier.weight(1f)) { onManage("Locations") }
                QuickTile("Emergency", Icons.Outlined.SupportAgent, Modifier.weight(1f)) { onManage("Settings") }
            }
        }
        item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { Metric("Open", open, Modifier.weight(1f)); Metric("In review", review, Modifier.weight(1f)); Metric("Resolved", resolved, Modifier.weight(1f)) } }
        item { SectionHeading(if (state.canReview) "Needs your attention" else "Recent complaints", "View all") { onHelpdesk("All") } }
        if (state.tickets.isEmpty()) item { EmptyState("No complaints yet", "A new issue will appear here after submission.") }
        items(state.tickets.take(4), key = { it.string("id") }) { t -> TicketCard(t) { onTicket(t.string("id")) } }
        item { Text("Location is only requested when reporting. Your floor and room are selected by you.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp)) }
    }
}
@Composable private fun QuickTile(label: String, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.clickable(onClick = onClick), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) { Surface(color = Color.White, border = BorderStroke(1.dp, Line), shape = RoundedCornerShape(16.dp)) { Icon(icon, null, Modifier.padding(17.dp).size(24.dp), tint = Teal) }; Text(label, fontSize = 12.sp, maxLines = 2, lineHeight = 16.sp) }
}
@Composable private fun Metric(label: String, value: Int, modifier: Modifier) { Surface(modifier, color = Color.White, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, Line)) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { Text(value.toString().padStart(2, '0'), fontSize = 25.sp, fontWeight = FontWeight.Bold, color = Teal); Text(label, fontSize = 12.sp, color = Muted) } } }
@Composable private fun HelpdeskScreen(state: AppState, filter: String, onFilter: (String) -> Unit, onReport: () -> Unit, onTicket: (String) -> Unit) {
    var search by remember { mutableStateOf("") }; var category by remember { mutableStateOf("All categories") }; var status by remember { mutableStateOf("All statuses") }
    val following = state.workspace.arr("following").strings()
    val tickets = state.tickets.filter { t ->
        (filter != "Mine" || t.bool("own")) && (filter != "Following" || t.string("id") in following) && (filter != "Review" || t.string("verification") in listOf("pending", "needs_info") || t.string("reopen") == "pending") && (filter != "Assigned" || t.string("assignee_id") == state.member.string("id")) && (category == "All categories" || t.string("category") == category) && (status == "All statuses" || ticketStatus(t) == status) && (search.isBlank() || listOf("title", "ticket_no", "building", "room").any { t.string(it).contains(search, true) })
    }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item { Text("Helpdesk", fontSize = 27.sp, fontWeight = FontWeight.Bold) }
            item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) { (listOf("All", "Mine", "Following") + if (state.canReview) listOf("Review", "Assigned") else if (state.member.string("role") == "technician") listOf("Assigned") else emptyList()).forEach { name -> FilterChip(selected = filter == name, onClick = { onFilter(name) }, label = { Text(name) }) } } }
            item { OutlinedTextField(search, { search = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("Search complaints") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, shape = RoundedCornerShape(12.dp)) }
            item { Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { Box(Modifier.weight(1f)) { Picker("Category", category, (listOf("All categories") + categories).map { it to it }, { category = it }) }; Box(Modifier.weight(1f)) { Picker("Status", status, (listOf("All statuses") + state.tickets.map(::ticketStatus).distinct()).map { it to it }, { status = it }) } } }
            item { Text("${tickets.size} ${if (tickets.size == 1) "complaint" else "complaints"}", fontSize = 13.sp, color = Muted) }
            if (tickets.isEmpty()) item { EmptyState("Nothing here yet", "Try another filter, or report a new issue.") }
            items(tickets, key = { it.string("id") }) { ticket -> TicketCard(ticket) { onTicket(ticket.string("id")) } }
        }
        Surface(shadowElevation = 6.dp, color = Color.White) { Box(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) { PrimaryButton("Raise complaint", enabled = !state.loading && state.workspace.has("member"), onClick = onReport) } }
    }
}
@Composable private fun UpdatesScreen(state: AppState, onRead: () -> Unit, onTicket: (String) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { SectionHeading("Updates", "Mark all read", onRead) }
        val notifications = state.workspace.arr("notifications").objects()
        if (notifications.isEmpty()) item { EmptyState("You’re all caught up", "Updates about your complaints will appear here.", Icons.Outlined.NotificationsNone) }
        items(notifications) { n -> Surface(onClick = { onTicket(n.string("complaint_id")) }, color = Color.White, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Line)) { Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) { Icon(Icons.Outlined.NotificationsActive, null, tint = if (n.long("read_at") == 0L) Coral else Muted); Column { Text(n.string("message"), fontWeight = if (n.long("read_at") == 0L) FontWeight.SemiBold else FontWeight.Normal); Text(shortDate(n.long("created_at")), color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) } } } }
    }
}
@Composable private fun ProfileScreen(state: AppState, onManage: (String) -> Unit, onServer: () -> Unit, onSignOut: () -> Unit) {
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text("My profile", fontSize = 27.sp, fontWeight = FontWeight.Bold) }
        item { Panel { Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = RoundedCornerShape(18.dp), color = Teal) { Text(state.user.string("name", "C").take(1).uppercase(), Modifier.padding(22.dp), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold) }; Column { Text(state.user.string("name"), fontSize = 18.sp, fontWeight = FontWeight.Bold); Text(state.user.string("email"), fontSize = 13.sp, color = Muted); Text(state.member.string("role").replaceFirstChar { it.uppercase() }, color = Teal, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) } } } }
        item { Panel { FeatureLine(Icons.Outlined.Shield, "Your workspace access", "${state.organisation.string("name")} · ${state.member.string("site_scope").let { if (it == "*") "All authorised sites" else "Selected sites" }}"); FeatureLine(Icons.Outlined.LocationOn, "Location & camera", "Requested only while reporting a new issue. Progress stays available from anywhere.") } }
        item { Panel { if (state.isAdmin) { MenuRow("People & access", Icons.Outlined.Groups) { onManage("People") }; MenuRow("Workspace settings", Icons.Outlined.Settings) { onManage("Settings") } }; MenuRow("Locations", Icons.Outlined.Apartment) { onManage("Locations") }; MenuRow("Create a workspace", Icons.Outlined.AddBusiness) { onManage("Create workspace") }; MenuRow("Connection settings", Icons.Outlined.Link, onServer); MenuRow("Sign out", Icons.Outlined.Logout, onSignOut) } }
        item { Text("CampusCare · Android preview 0.1\nColleges, schools, offices and shared spaces.", color = Muted, fontSize = 12.sp) }
    }
}
@Composable fun MenuRow(text: String, icon: ImageVector, onClick: () -> Unit) { Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { Icon(icon, null, tint = Teal); Text(text, Modifier.weight(1f), fontSize = 15.sp); Icon(Icons.Outlined.ChevronRight, null, tint = Muted) } }
