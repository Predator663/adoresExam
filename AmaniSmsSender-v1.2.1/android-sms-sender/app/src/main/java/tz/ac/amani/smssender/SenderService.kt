package tz.ac.amani.smssender

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.random.Random

/**
 * Asks the website for waiting messages and sends each one as a normal SMS from this phone's SIM card,
 * slowly (a pause between messages, and a longer rest every so often), then tells the website what happened.
 */
class SenderService : Service() {

    companion object {
        const val ACTION_STOP = "tz.ac.amani.smssender.STOP"
        private const val ACTION_SENT = "tz.ac.amani.smssender.SENT"
        private const val ACTION_DELIVERED = "tz.ac.amani.smssender.DELIVERED"
        private const val EXTRA_JOB = "job"
        private const val CHANNEL = "sender"
        private const val ALERT_CHANNEL = "problems"
        private val NUMBER = Regex("^\\+255[67]\\d{8}$")

        @Volatile
        var running = false
    }

    /** Android took the SMS permission away while we were running. Not the message's fault, so nothing is reported as failed. */
    private class PermissionLost : Exception()

    private class JobState(var sentLeft: Int, var deliveredLeft: Int, var failure: String? = null)

    private val states = ConcurrentHashMap<Long, JobState>()
    private val net = Executors.newSingleThreadExecutor()
    private var worker: Thread? = null
    private var wake: PowerManager.WakeLock? = null
    private lateinit var api: Api
    private var receiverOn = false

    /** Android tells us here, part by part, whether the SIM sent the message and whether the phone received it. */
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val id = intent.getLongExtra(EXTRA_JOB, -1L)
            val st = states[id] ?: return
            val ok = resultCode == Activity.RESULT_OK
            if (intent.action == ACTION_SENT) {
                if (!ok && st.failure == null) st.failure = reason(resultCode)
                st.sentLeft -= 1
                if (st.sentLeft == 0) {
                    val failure = st.failure
                    if (failure != null) {
                        AppLog.add("FAILED (job $id): $failure", "Job: $id\nReason: $failure\nThe website is being told this message failed.")
                        report(id, "failed", failure)
                        states.remove(id)
                    } else {
                        Store.markSent(this@SenderService, id)
                        AppLog.add("Sent (job $id)", "Job: $id\nAll parts of the message were accepted by the SIM card. The website is being told.")
                        report(id, "sent")
                    }
                }
            } else if (intent.action == ACTION_DELIVERED && ok) {
                st.deliveredLeft -= 1
                if (st.deliveredLeft == 0 && st.failure == null) {
                    AppLog.add("Delivered (job $id)", "Job: $id\nThe parent's phone confirmed it received the message.")
                    report(id, "delivered")
                    states.remove(id)
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopWork()
            return START_NOT_STICKY
        }
        // Always become a foreground service first: Android requires it within seconds of startForegroundService(), even if we then stop.
        try {
            startAsForeground()
        } catch (e: Exception) {  // e.g. Android 12+ refuses to restart a service from the background
            AppLog.add("Could not start in the background (${e.javaClass.simpleName}). Open the app and press Start sending.")
            stopSelf()
            return START_NOT_STICKY
        }
        if (running) return START_STICKY
        val server = Store.serverUrl(this)
        val token = Store.token(this)
        if (server.isEmpty() || token.isEmpty()) {
            AppLog.add("Enter the server address and the pairing code first.")
            stopWork()
            return START_NOT_STICKY
        }
        if (!Readiness.smsGranted(this)) {  // also the case when Android restarts us after the permission was removed
            alertUser("The SMS permission is missing. Open the app and press \"Fix the first problem\".")
            stopWork()
            return START_NOT_STICKY
        }
        api = Api(server, token)
        val filter = IntentFilter().apply {
            addAction(ACTION_SENT)
            addAction(ACTION_DELIVERED)
            addDataScheme("amani") // our PendingIntents carry an amani:// address so every message part is unique
        }
        ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiverOn = true
        wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "amani:sender").apply { acquire(12 * 60 * 60 * 1000L) }
        running = true
        worker = Thread { loop() }.also { it.start() }
        return START_STICKY
    }

    private fun loop() {
        var sinceRest = 0
        Net.reset()
        Net.state = "Connecting..."
        AppLog.add("Started. Asking the website for messages...")
        while (running) {
            try {
                if (!Readiness.smsGranted(this)) throw PermissionLost()
                if (Readiness.sim(this) == Readiness.Sim.ABSENT) {  // nothing is pulled, so nothing is lost or marked failed
                    AppLog.add("No SIM card found. Waiting...")
                    nap(30)
                    continue
                }
                if (!Net.online(this)) {  // no internet: wait quietly (one log line), and carry on the moment it is back
                    if (Net.state != "No internet on this phone") {
                        Net.state = "No internet on this phone"
                        AppLog.add("No internet on this phone. Waiting for it to come back...", "Sending is paused. Waiting messages stay safe on the website. Check mobile data or Wi-Fi.")
                    }
                    nap(3)
                    continue
                }
                flushReports()
                val (jobs, pacing) = api.pull(10)
                markOnline()
                if (jobs.isEmpty()) {
                    nap(10)
                    continue
                }
                AppLog.add("${jobs.size} message(s) to send")
                for (job in jobs) {
                    if (!running) break
                    if (Store.wasSent(this, job.id)) { // the website asked again because it never heard back: do not text twice
                        report(job.id, "sent")
                        continue
                    }
                    sendOne(job)
                    sinceRest++
                    if (pacing.pauseEvery > 0 && sinceRest >= pacing.pauseEvery) {
                        AppLog.add("Resting ${pacing.pauseSeconds} s so the network does not block the SIM")
                        nap(pacing.pauseSeconds)
                        sinceRest = 0
                    } else {
                        nap(pacing.secondsBetween + Random.nextInt(0, 3))
                    }
                }
            } catch (e: AuthException) {
                alertUser(e.message ?: "The pairing code was rejected.")
                break
            } catch (e: PermissionLost) {
                alertUser("Sending stopped: Android removed the SMS permission. Open the app and press \"Fix the first problem\". Waiting messages are safe in the queue.")
                break
            } catch (e: IOException) {
                Net.failures++
                val wait = Net.backoffSeconds(Net.failures)
                Net.state = "Server not reachable, retrying in $wait s"
                if (Net.failures == 1 || Net.failures % 5 == 0) {  // not every try, so the log is not flooded
                    AppLog.add("No connection (${Net.explain(e)}). Trying again in $wait s.", "Attempt ${Net.failures} in a row.\nTechnical reason: ${e.javaClass.simpleName}: ${e.message}\nThe wait grows from 5 s up to 2 minutes and starts again after one success.")
                }
                nap(wait, wakeWhenOnline = true)
            } catch (e: Exception) {
                AppLog.add("Problem: ${e.javaClass.simpleName} ${e.message}")
                nap(30)
            }
        }
        stopWork()
    }

    private fun sendOne(job: Job) {
        if (!NUMBER.matches(job.to)) {
            AppLog.add("Skipped a bad phone number")
            report(job.id, "failed", "Bad phone number")
            return
        }
        if (!Readiness.smsGranted(this)) throw PermissionLost()  // before anything is reported, so the website just asks again later
        try {
            val sms = smsManager()
            val parts = sms.divideMessage(job.body)
            val sent = ArrayList<PendingIntent>()
            val delivered = ArrayList<PendingIntent>()
            for (i in parts.indices) {
                sent.add(pending(ACTION_SENT, job.id, i))
                delivered.add(pending(ACTION_DELIVERED, job.id, i))
            }
            states[job.id] = JobState(parts.size, parts.size)
            sms.sendMultipartTextMessage(job.to, null, parts, sent, delivered)
            AppLog.add("Sending to ${job.to.take(4)}*****${job.to.takeLast(3)} (${parts.size} part(s))", "Job: ${job.id}\nParts: ${parts.size}\nLength: ${job.body.length} characters\n(The number and the text are not stored in the log.)")
        } catch (e: SecurityException) {  // permission removed between the check and the call
            states.remove(job.id)
            throw PermissionLost()
        } catch (e: Exception) {
            val why = "${e.javaClass.simpleName}: ${e.message ?: ""}"
            AppLog.add("FAILED: $why")
            report(job.id, "failed", why)
        }
    }

    private fun pending(action: String, id: Long, part: Int): PendingIntent {
        val intent = Intent(action)
            .setPackage(packageName)
            .setData(Uri.parse("amani://sms/${action.substringAfterLast('.')}/$id/$part"))
            .putExtra(EXTRA_JOB, id)
        return PendingIntent.getBroadcast(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun smsManager(): SmsManager =
        if (Build.VERSION.SDK_INT >= 31) getSystemService(SmsManager::class.java)
        else @Suppress("DEPRECATION") SmsManager.getDefault()

    private fun reason(code: Int): String = when (code) {
        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "Could not send (check airtime or the SMS bundle)"
        SmsManager.RESULT_ERROR_NO_SERVICE -> "No network signal"
        SmsManager.RESULT_ERROR_NULL_PDU -> "The message was not valid"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "Airplane mode is on"
        else -> "Android error $code"
    }

    private var reportWarned = false

    /** Tell the website. The result is saved on the phone first and removed only when the website confirms, so a dropped connection loses nothing. */
    private fun report(id: Long, status: String, error: String = "") {
        Store.pendingAdd(this, id, status, error)
        net.execute { flushReports() }
    }

    /** Sends every saved result, oldest first. Stops at the first failure and keeps the rest for the next round. */
    @Synchronized
    private fun flushReports() {
        for ((id, status, error) in Store.pendingAll(this)) {
            try {
                api.report(id, status, error)
                Store.pendingRemove(this, id, status)
                reportWarned = false
            } catch (e: AuthException) {
                return  // the main loop sees the same rejection on its next pull and stops with a clear message
            } catch (e: Exception) {
                if (!reportWarned) {
                    reportWarned = true
                    AppLog.add("Could not tell the website yet (${if (e is IOException) Net.explain(e) else e.message}). The result is saved and will be sent when the connection works.",
                        "Job: $id\nResult waiting: $status")
                }
                return
            }
        }
    }

    /** Waits, in half-second steps so Stop works at once. With `wakeWhenOnline` it also ends early when the internet comes back. */
    private fun nap(seconds: Int, wakeWhenOnline: Boolean = false) {
        var left = seconds * 1000L
        val wasOnline = !wakeWhenOnline || Net.online(this)
        var step = 0
        while (running && left > 0) {
            Thread.sleep(500)
            left -= 500
            if (!wasOnline && ++step % 4 == 0 && Net.online(this)) break
        }
    }

    /** Called after a successful answer from the website. */
    private fun markOnline() {
        if (Net.failures > 0 || Net.state == "No internet on this phone") {
            AppLog.add("Connected again to the website.", if (Net.failures > 0) "The connection came back after ${Net.failures} failed attempt(s)." else "The phone's internet came back.")
        }
        Net.failures = 0
        Net.state = "Online"
        Net.lastOkMillis = System.currentTimeMillis()
    }

    /** Writes to the log and, if notifications are allowed, shows a notification, so a stopped phone is noticed. */
    private fun alertUser(text: String) {
        AppLog.add(text)
        try {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(ALERT_CHANNEL, "Problems", NotificationManager.IMPORTANCE_HIGH))
            val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            nm.notify(2, NotificationCompat.Builder(this, ALERT_CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Amani SMS Sender stopped")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build())
        } catch (ignored: Exception) { }
    }

    private fun startAsForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Sending messages", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(
            this, 1, Intent(this, SenderService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE
        )
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("Amani SMS Sender is running")
            .setContentText("Sending parents' login messages")
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(1, n)
    }

    private fun stopWork() {
        running = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        if (receiverOn) {
            try { unregisterReceiver(receiver) } catch (ignored: Exception) { }
            receiverOn = false
        }
        try { wake?.takeIf { it.isHeld }?.release() } catch (ignored: Exception) { }
        Net.reset()
        AppLog.add("Stopped.")
        super.onDestroy()
    }
}
