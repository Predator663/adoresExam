package tz.ac.amani.smssender

import android.Manifest
import android.animation.ObjectAnimator
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.widget.doAfterTextChanged

/**
 * One screen made of four cards: connection (server address and pairing code, lockable with a PIN), a checklist of what the phone
 * still needs, Start / Stop, and an animated log whose lines open for details.
 */
class MainActivity : Activity() {
    private companion object {
        const val IDLE_LOCK_MS = 3 * 60_000L   // locks again after 3 minutes without typing
        const val AWAY_LOCK_MS = 60_000L       // ...or when the app was away for more than a minute
    }

    private lateinit var server: EditText
    private lateinit var token: EditText
    private lateinit var serverShield: View
    private lateinit var tokenShield: View
    private lateinit var lockIcon: LockIcon
    private lateinit var lockLabel: TextView
    private lateinit var lockActions: LinearLayout
    private lateinit var saveBtn: Button
    private lateinit var checkRows: List<TextView>
    private lateinit var progressFill: View
    private lateinit var progressText: TextView
    private lateinit var statusDot: TextView
    private lateinit var status: TextView
    private lateinit var toggle: Button
    private lateinit var netLine: TextView
    private lateinit var logList: LogListView
    private lateinit var logEmpty: TextView
    private lateinit var logCount: TextView

    private var startAfterPermission = false
    private var unlocked = false
    private var lastActive = 0L
    private var stoppedAt = 0L
    private var lastLogVersion = -1L
    private var lastProgress = -1
    private var pulse: ObjectAnimator? = null
    private var pulsingNow = false

    private val ui = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            refresh()
            ui.postDelayed(this, 1000)
        }
    }

    private fun dp(v: Int) = Ui.dp(this, v)

    private fun open(intent: Intent, fallback: Intent? = null) {
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            try { if (fallback != null) startActivity(fallback) else startActivity(Readiness.appSettings(this)) } catch (ignored: Exception) { }
        }
    }

    private fun editableNow() = unlocked || !Lock.hasPin(this)

    // ------------------------------------------------------------------ building the screen

    private fun fieldLabel(s: String) = Ui.muted(this, s, 12f).apply {
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(dp(2), dp(10), 0, dp(4))
    }

    private fun field(hint: String, inputType: Int, value: String) = EditText(this).apply {
        this.hint = hint
        this.inputType = inputType
        setText(value)
        textSize = 15f
        setTextColor(Ui.INK)
        setHintTextColor(Ui.MUTED)
        background = Ui.rounded(this@MainActivity, Ui.FIELD, 12)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }

    /** A field with an invisible cover on top. While the field is locked the cover takes every touch, so the field cannot be edited, focused or copied. */
    private fun shielded(f: EditText, shield: View): FrameLayout = FrameLayout(this).apply {
        addView(f, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(shield, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun sectionHeader(title: String, trailing: View? = null) = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        addView(Ui.text(this@MainActivity, title, 17f, true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (trailing != null) addView(trailing)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        unlocked = !Lock.hasPin(this)

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(22), dp(16), dp(10))
        }
        val reveals = ArrayList<View>()

        // --- heading
        val heading = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(4), 0, dp(4), dp(14)) }
        heading.addView(Ui.text(this, "Amani SMS Sender", 26f, true).apply { setPadding(0, 0, 0, dp(2)) })
        heading.addView(Ui.muted(this, "Sends parents' login messages from this phone's SIM card. Keep this phone charged, with airtime or an SMS bundle, and a signal.", 13f))
        col.addView(heading); reveals.add(heading)

        // --- connection card
        lockIcon = LockIcon(this)
        lockLabel = TextView(this).apply { textSize = 12f; setTextColor(Ui.INK); setTypeface(typeface, android.graphics.Typeface.BOLD); setPadding(dp(8), 0, 0, 0) }
        val chip = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.ripple(this@MainActivity, Ui.rounded(this@MainActivity, Ui.FIELD, 18), 18)
            setPadding(dp(12), dp(7), dp(14), dp(7))
            addView(lockIcon, LinearLayout.LayoutParams(dp(18), dp(18)))
            addView(lockLabel)
            setOnClickListener {
                when {
                    !Lock.hasPin(this@MainActivity) -> createPin()
                    unlocked -> lockNow()
                    else -> askUnlock()
                }
            }
            Ui.pressable(this)
        }
        server = field("Server address, e.g. https://amani-exams.co.tz", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI, Store.serverUrl(this))
        token = field("Pairing code (from the website: Parents > Phone)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, Store.token(this))
        serverShield = View(this).apply { setOnClickListener { askUnlock() } }
        tokenShield = View(this).apply { setOnClickListener { askUnlock() } }
        server.doAfterTextChanged { lastActive = System.currentTimeMillis() }
        token.doAfterTextChanged { lastActive = System.currentTimeMillis() }
        lockActions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        saveBtn = Ui.button(this, "Save and check the connection") { saveAndPing() }

        val connection = Ui.card(this)
        connection.addView(sectionHeader("Connection", chip))
        connection.addView(fieldLabel("Server address"))
        connection.addView(shielded(server, serverShield))
        connection.addView(fieldLabel("Pairing code"))
        connection.addView(shielded(token, tokenShield))
        connection.addView(lockActions)
        connection.addView(saveBtn)
        col.addView(connection, Ui.cardParams(this)); reveals.add(connection)

        // --- readiness card
        progressText = Ui.muted(this, "", 12f)
        val ready = Ui.card(this)
        ready.addView(sectionHeader("Is this phone ready?", progressText))
        val track = FrameLayout(this).apply { background = Ui.rounded(this@MainActivity, Ui.LINE, 3) }
        progressFill = View(this).apply {
            background = Ui.rounded(this@MainActivity, Ui.INK, 3)
            pivotX = 0f
            scaleX = 0f
        }
        track.addView(progressFill, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        ready.addView(track, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(6)).apply { setMargins(0, dp(6), 0, dp(8)) })
        checkRows = (0 until 5).map { Ui.text(this, "", 14f).apply { setPadding(0, dp(5), 0, dp(5)) }.also { ready.addView(it) } }
        ready.addView(Ui.button(this, "Fix the first problem") { fixNext() })
        col.addView(ready, Ui.cardParams(this)); reveals.add(ready)

        // --- sending card
        statusDot = TextView(this).apply { textSize = 16f; setTextColor(Ui.INK); setPadding(0, 0, dp(10), 0) }
        status = Ui.text(this, "", 16f, true)
        val statusRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; addView(statusDot); addView(status) }
        toggle = Ui.button(this, "Start sending", primary = true) { if (SenderService.running) stopSending() else start() }
        netLine = Ui.muted(this, "", 12f).apply { setPadding(dp(26), 0, 0, dp(2)) }
        val sending = Ui.card(this)
        sending.addView(statusRow)
        sending.addView(netLine)
        sending.addView(toggle)
        col.addView(sending, Ui.cardParams(this)); reveals.add(sending)

        // --- log card
        logCount = Ui.muted(this, "", 12f).apply { setPadding(0, 0, dp(6), 0) }
        val logActions = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(logCount)
            addView(Ui.textButton(this@MainActivity, "Copy all") { copyLog() })
            addView(Ui.textButton(this@MainActivity, "Clear") { AppLog.clear() })
        }
        logList = LogListView(this)
        logEmpty = Ui.muted(this, "Nothing yet. Lines appear here as the app works. Tap a line to open it.", 13f)
        val logCard = Ui.card(this)
        logCard.addView(sectionHeader("Log", logActions))
        logCard.addView(logEmpty)
        logCard.addView(logList, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(6), 0, 0) })
        col.addView(logCard, Ui.cardParams(this)); reveals.add(logCard)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Ui.PAPER) }
        root.addView(ScrollView(this).apply { clipToPadding = false; addView(col) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(Ui.footer(this, aboutLink = true), ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(root)

        applyLockState(animate = false)
        lastActive = System.currentTimeMillis()
        Ui.reveal(reveals)
    }

    override fun onResume() {
        super.onResume()
        val now = System.currentTimeMillis()
        if (Lock.hasPin(this) && unlocked && stoppedAt > 0 && now - stoppedAt > AWAY_LOCK_MS) autoLock()
        lastActive = now
        ui.post(tick)  // also re-reads the checklist after coming back from a system settings screen
    }

    override fun onPause() {
        ui.removeCallbacks(tick)
        pulse?.cancel()
        pulse = null
        pulsingNow = false
        super.onPause()
    }

    override fun onStop() {
        stoppedAt = System.currentTimeMillis()
        super.onStop()
    }

    /** Runs every second: log, checklist and status. Only what changed is touched, so the animations are not interrupted. */
    private fun refresh() {
        if (Lock.hasPin(this) && unlocked && System.currentTimeMillis() - lastActive > IDLE_LOCK_MS) autoLock()

        val v = AppLog.version
        if (v != lastLogVersion) {
            lastLogVersion = v
            logList.sync(AppLog.entries())
            val n = logList.count
            logCount.text = if (n == 0) "" else if (n == 1) "1 line" else "$n lines"
            logEmpty.animate().cancel()
            if (n == 0) { logEmpty.visibility = View.VISIBLE; logEmpty.animate().alpha(1f).setDuration(250).start() }
            else logEmpty.animate().alpha(0f).setDuration(150).withEndAction { if (logList.count > 0) logEmpty.visibility = View.GONE }.start()
        }

        val rows = checklistRows()
        rows.forEachIndexed { i, r -> Ui.setTextAnimated(checkRows[i], r.second) }
        val okCount = rows.count { it.first }
        if (okCount != lastProgress) {
            lastProgress = okCount
            progressFill.animate().scaleX(okCount / rows.size.toFloat()).setDuration(550).setInterpolator(DecelerateInterpolator(2f)).start()
            Ui.setTextAnimated(progressText, "$okCount of ${rows.size} ready")
        }

        val on = SenderService.running
        Ui.setTextAnimated(toggle, if (on) "Stop sending" else "Start sending")
        Ui.setTextAnimated(status, if (on) "Running: asking the website for messages" else "Stopped")
        Ui.setTextAnimated(netLine, if (on) Net.summary() else "")
        if (on != pulsingNow || (on && pulse == null)) {
            pulsingNow = on
            pulse?.cancel()
            statusDot.text = if (on) "●" else "○"
            if (on) {
                pulse = ObjectAnimator.ofFloat(statusDot, View.ALPHA, 1f, 0.2f).apply {
                    duration = 900
                    repeatMode = android.animation.ValueAnimator.REVERSE
                    repeatCount = android.animation.ValueAnimator.INFINITE
                    start()
                }
            } else {
                pulse = null
                statusDot.alpha = 1f
            }
        }
    }

    private fun copyLog() {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Log", AppLog.text()))
        Toast.makeText(this, "Log copied", Toast.LENGTH_SHORT).show()
    }

    // ------------------------------------------------------------------ the lock

    private fun setEditable(e: EditText, shield: View, editable: Boolean) {
        e.isFocusable = editable
        e.isFocusableInTouchMode = editable
        e.isCursorVisible = editable
        if (!editable) e.clearFocus()
        shield.visibility = if (editable) View.GONE else View.VISIBLE
        e.animate().alpha(if (editable) 1f else 0.55f).setDuration(260).start()
    }

    /** Shows the lock in its current state: padlock, label, which buttons are offered, and whether the fields can be edited. */
    private fun applyLockState(animate: Boolean) {
        val hasPin = Lock.hasPin(this)
        val editable = editableNow()
        setEditable(server, serverShield, editable)
        setEditable(token, tokenShield, editable)
        token.transformationMethod = if (editable) null else PasswordTransformationMethod.getInstance()
        if (!editable) hideKeyboard()
        lockIcon.setOpen(editable, animate)
        val label = if (!hasPin) "Not protected" else if (editable) "Unlocked" else "Locked"
        if (animate) Ui.setTextAnimated(lockLabel, label) else lockLabel.text = label
        Ui.setTextAnimated(saveBtn, if (editable) "Save and check the connection" else "Check the connection")

        lockActions.removeAllViews()
        when {
            !hasPin -> lockActions.addView(Ui.button(this, "Set a PIN to lock these fields") { createPin() })
            !editable -> lockActions.addView(Ui.button(this, "Unlock to edit") { askUnlock() })
            else -> lockActions.addView(LinearLayout(this).apply {
                addView(Ui.textButton(this@MainActivity, "Lock now") { lockNow() })
                addView(Ui.textButton(this@MainActivity, "Change PIN") { changePin() })
                addView(Ui.textButton(this@MainActivity, "Remove PIN") { removePin() })
            })
        }
        if (animate) {
            lockActions.alpha = 0f
            lockActions.animate().alpha(1f).setDuration(260).start()
        }
    }

    private fun hideKeyboard() {
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(server.windowToken, 0)
    }

    /** Asks for the PIN and runs [onOk] when it is right. Wrong tries shake the dots; too many make the person wait. */
    private fun verifyPin(title: String, subtitle: String, onOk: () -> Unit) {
        PinDialog(this, title, subtitle, showForgot = true) { pin, dlg ->
            when (Lock.verify(this@MainActivity, pin)) {
                Lock.Result.OK -> { dlg.dismiss(); onOk() }
                Lock.Result.WRONG ->
                    if (Lock.waitSeconds(this@MainActivity) > 0) dlg.fail("Too many tries. Wait ${Lock.waitSeconds(this@MainActivity)} s.")
                    else dlg.fail("Wrong PIN. Try again.")
                Lock.Result.WAIT -> dlg.fail("Too many tries. Wait ${Lock.waitSeconds(this@MainActivity)} s.")
            }
        }.show()
    }

    private fun askUnlock() {
        if (!Lock.hasPin(this)) { createPin(); return }
        verifyPin("Enter PIN", "Unlock to edit the server address and the pairing code.") {
            unlocked = true
            lastActive = System.currentTimeMillis()
            applyLockState(animate = true)
        }
    }

    private fun createPin() {
        var first: String? = null
        PinDialog(this, "Create a PIN", "Choose ${Lock.MIN_LEN} to ${Lock.MAX_LEN} digits. You will need it to change the server address or the pairing code.") { pin, dlg ->
            val f = first
            if (f == null) {
                first = pin
                dlg.reset("Repeat the PIN", "Type the same PIN once more.")
            } else if (f == pin) {
                Lock.setPin(this@MainActivity, pin)
                dlg.dismiss()
                Toast.makeText(this@MainActivity, "PIN saved", Toast.LENGTH_SHORT).show()
                lockNow()
            } else {
                first = null
                dlg.reset("Create a PIN", "Choose ${Lock.MIN_LEN} to ${Lock.MAX_LEN} digits.")
                dlg.fail("The two PINs were different. Start again.")
            }
        }.show()
    }

    private fun changePin() = verifyPin("Current PIN", "Enter your current PIN to change it.") { createPin() }

    private fun removePin() {
        AlertDialog.Builder(this).setTitle("Remove the PIN?")
            .setMessage("The server address and the pairing code will no longer be protected from changes.")
            .setPositiveButton("Remove") { _, _ ->
                Lock.clearPin(this)
                unlocked = true
                applyLockState(animate = true)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /** Saves what was typed, then locks. Stays unlocked (and says why) if the address is not acceptable. */
    private fun lockNow() {
        if (!Lock.hasPin(this)) return
        if (editableNow() && !saveFields(true)) return
        unlocked = false
        applyLockState(animate = true)
    }

    /** Locks without any question (idle or away). Saves a good address, drops edits that cannot be saved. */
    private fun autoLock() {
        if (!saveFields(false)) {
            server.setText(Store.serverUrl(this))
            token.setText(Store.token(this))
        }
        unlocked = false
        applyLockState(animate = true)
    }

    // ------------------------------------------------------------------ readiness checklist

    private fun line(ok: Boolean, good: String, bad: String) = ok to (if (ok) "✓  $good" else "✗  $bad")

    private fun checklistRows(): List<Pair<Boolean, String>> {
        val sim = Readiness.sim(this)
        return listOf(
            line(Readiness.smsGranted(this), "Permission to send SMS: allowed", "Permission to send SMS: NOT allowed"),
            line(sim != Readiness.Sim.ABSENT, if (sim == Readiness.Sim.READY) "SIM card ready" else "SIM card: state not known (check it is inserted)", "No SIM card found"),
            line(Readiness.keepsPermissions(this), "Permissions kept even if the app is not opened for months",
                "Android may REMOVE the SMS permission when the app is not opened for some months"),
            line(Readiness.batteryUnrestricted(this), "Battery: unrestricted", "Battery: Android may stop the app in the background"),
            line(Readiness.notificationsGranted(this), "Notifications allowed", "Notifications off (sending works, but you will not see warnings)"),
        )
    }

    /** One button that walks through the problems in order of importance. */
    private fun fixNext() {
        when {
            !Readiness.smsGranted(this) -> askSms(startAfter = false)
            Readiness.sim(this) == Readiness.Sim.ABSENT -> info("No SIM card", "Insert the SIM card that has the SMS bundle, switch the phone's mobile network on, then come back.")
            !Readiness.keepsPermissions(this) -> info("Keep the SMS permission",
                "On the next screen switch OFF \"Remove permissions if app isn't used\" (it may be called \"Pause app activity if unused\"). Without this, Android quietly takes the SMS permission away.") {
                open(Readiness.autoRevoke(this), Readiness.appSettings(this))
            }
            !Readiness.batteryUnrestricted(this) -> open(Readiness.batteryRequest(this), Readiness.batteryList())
            !Readiness.notificationsGranted(this) -> if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
            else -> info("All good", "Everything this phone needs is in place. On Tecno, Infinix, itel, Xiaomi or Samsung phones also allow Autostart for this app (see About).")
        }
    }

    private fun info(title: String, message: String, then: (() -> Unit)? = null) {
        AlertDialog.Builder(this).setTitle(title).setMessage(message)
            .setPositiveButton(if (then != null) "Continue" else "OK") { _, _ -> then?.invoke() }
            .apply { if (then != null) setNegativeButton("Cancel", null) }
            .show()
    }

    // ------------------------------------------------------------------ SMS permission

    /** Explains why, then asks. If Android will no longer show its question, sends the person to the app settings instead. */
    private fun askSms(startAfter: Boolean) {
        startAfterPermission = startAfter
        val blockedForever = Store.askedSms(this) && !shouldShowRequestPermissionRationale(Manifest.permission.SEND_SMS)
        if (blockedForever) {
            info("Allow SMS in the settings", "Android will not ask again. On the next screen tap Permissions, then SMS, and choose Allow.") {
                open(Readiness.appSettings(this))
            }
            return
        }
        info("Permission to send SMS", "This app sends parents' login messages as normal SMS from this phone's SIM card. Android will now ask you to allow it. Please choose Allow.") {
            Store.setAskedSms(this)
            val need = ArrayList<String>()
            need.add(Manifest.permission.SEND_SMS)
            if (Build.VERSION.SDK_INT >= 33 && !Readiness.notificationsGranted(this)) need.add(Manifest.permission.POST_NOTIFICATIONS)
            requestPermissions(need.toTypedArray(), 1)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 1) return
        if (Readiness.smsGranted(this)) {
            if (startAfterPermission) launch()
        } else {
            AppLog.add("Permission to send SMS was refused. Press \"Fix the first problem\" to allow it.")
        }
        startAfterPermission = false
    }

    // ------------------------------------------------------------------ actions

    /** Cleans and checks the address, saves both fields, returns false (and says why) if the address is not acceptable. While locked there is nothing to save. */
    private fun saveFields(showProblem: Boolean): Boolean {
        if (!editableNow()) return true
        val (address, problem) = Store.cleanServer(server.text.toString())
        if (problem != null) {
            if (showProblem) {
                AppLog.add(problem)
                info("Server address", problem)
            }
            return false
        }
        server.setText(address)
        Store.save(this, address, token.text.toString())
        return true
    }

    private fun saveAndPing() {
        if (!saveFields(true)) return
        val s = Store.serverUrl(this)
        val t = Store.token(this)
        Thread {
            try {
                AppLog.add(Api(s, t).ping())
            } catch (e: Exception) {
                AppLog.add("Connection failed: ${Net.explain(e)}", "Technical reason: ${e.javaClass.simpleName}: ${e.message}")
            }
        }.start()
    }

    private fun start() {
        if (!saveFields(true)) return
        if (!Readiness.smsGranted(this)) {
            askSms(startAfter = true)
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && !Readiness.notificationsGranted(this)) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)  // not required: sending starts either way
        }
        launch()
    }

    private fun launch() = ContextCompat.startForegroundService(this, Intent(this, SenderService::class.java))

    private fun stopSending() {
        startService(Intent(this, SenderService::class.java).setAction(SenderService.ACTION_STOP))
    }
}
