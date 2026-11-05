package tz.ac.amani.smssender

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.telephony.TelephonyManager

/**
 * Everything that must be true for messages to go out reliably, in one place. The screen shows it as a checklist, and the
 * sending service checks the important parts again before every message, because Android can take a permission away
 * while the app is running (for example "Remove permissions if app isn't used", which is switched on by default).
 */
object Readiness {
    enum class Sim { READY, ABSENT, UNKNOWN }

    fun smsGranted(c: Context) = c.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED

    fun notificationsGranted(c: Context) =
        Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun batteryUnrestricted(c: Context): Boolean =
        (c.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(c.packageName)

    /** False when Android may remove the SMS permission after months without opening the app. */
    fun keepsPermissions(c: Context): Boolean =
        Build.VERSION.SDK_INT < 30 || c.packageManager.isAutoRevokeWhitelisted()

    /** READY: a SIM works. ABSENT: every slot is empty. UNKNOWN: locked, loading or not reported (never blocks sending by itself). */
    fun sim(c: Context): Sim {
        val tm = c.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return Sim.UNKNOWN
        return try {
            val slots = (0 until maxOf(1, tm.phoneCount)).map { tm.getSimState(it) }
            when {
                slots.any { it == TelephonyManager.SIM_STATE_READY } -> Sim.READY
                slots.all { it == TelephonyManager.SIM_STATE_ABSENT } -> Sim.ABSENT
                else -> Sim.UNKNOWN
            }
        } catch (e: Exception) {
            Sim.UNKNOWN
        }
    }

    private fun pkg(c: Context) = Uri.parse("package:${c.packageName}")

    fun appSettings(c: Context) = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg(c))

    /** Asks directly to exempt this app from battery optimisation (one tap), instead of a long list of apps. */
    fun batteryRequest(c: Context) = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg(c))

    fun batteryList() = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)

    /** The screen that holds the "Remove permissions if app isn't used" switch. */
    fun autoRevoke(c: Context): Intent =
        if (Build.VERSION.SDK_INT >= 30) Intent(Intent.ACTION_AUTO_REVOKE_PERMISSIONS, pkg(c)) else appSettings(c)
}
