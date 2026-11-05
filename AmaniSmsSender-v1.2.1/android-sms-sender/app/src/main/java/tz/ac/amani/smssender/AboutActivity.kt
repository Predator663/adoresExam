package tz.ac.amani.smssender

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast

/** About the app and who built it. The phone and e-mail open the dialler and the mail app (no extra permission needed). */
class AboutActivity : Activity() {
    companion object {
        const val DEV_NAME = "Kratos"
        const val DEV_PHONE = "0693696717"
        const val DEV_EMAIL = "predatora186@gmail.com"
    }

    private fun open(intent: Intent) {
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "No app on this phone can do that.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val version = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (e: Exception) { "" }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(Ui.dp(this@AboutActivity, 16), Ui.dp(this@AboutActivity, 16), Ui.dp(this@AboutActivity, 16), Ui.dp(this@AboutActivity, 10))
        }
        val reveals = ArrayList<View>()
        fun heading(s: String) = Ui.text(this, s, 17f, true)

        val back = Ui.button(this, "← Back") { finish() }
        col.addView(back); reveals.add(back)

        val app = Ui.card(this)
        app.addView(Ui.text(this, "About", 24f, true))
        app.addView(heading("Amani SMS Sender"))
        if (version.isNotEmpty()) app.addView(Ui.muted(this, "Version $version", 13f))
        app.addView(Ui.text(this, "Made for ${Ui.SCHOOL}. It sends parents' login messages from this phone's SIM card, one by one, for the Amani online examination system.", 14f))
        col.addView(app, Ui.cardParams(this).apply { topMargin = Ui.dp(this@AboutActivity, 14) }); reveals.add(app)

        val dev = Ui.card(this)
        dev.addView(heading("Developer"))
        dev.addView(Ui.text(this, "Name: $DEV_NAME", 16f))
        dev.addView(Ui.text(this, "Phone: $DEV_PHONE", 16f))
        dev.addView(Ui.button(this, "Call $DEV_NAME") { open(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$DEV_PHONE"))) })
        dev.addView(Ui.text(this, "Email: $DEV_EMAIL", 16f))
        dev.addView(Ui.button(this, "Send an email") {
            open(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$DEV_EMAIL")).putExtra(Intent.EXTRA_SUBJECT, "Amani SMS Sender"))
        })
        col.addView(dev, Ui.cardParams(this)); reveals.add(dev)

        val help = Ui.card(this)
        help.addView(heading("If sending stops"))
        help.addView(Ui.text(this,
            "Open the app and press \"Fix the first problem\" until every line has a tick. On Tecno, Infinix, itel, Xiaomi, Samsung and Huawei phones " +
            "also allow Autostart / \"Run in background\" for this app, lock it in the recent-apps list, and under the app's SMS permission choose " +
            "Allow (not \"Ask every time\").", 14f))
        help.addView(Ui.text(this,
            "The server address and pairing code are protected by the PIN you set on the main screen. If you forget it, clear this app's storage in " +
            "Android Settings and enter the address and a new pairing code again.", 14f))
        col.addView(help, Ui.cardParams(this)); reveals.add(help)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Ui.PAPER) }
        root.addView(ScrollView(this).apply { clipToPadding = false; addView(col) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(Ui.footer(this, aboutLink = false), ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(root)
        Ui.reveal(reveals)
    }

    override fun finish() {
        super.finish()
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }
}
