package tz.ac.amani.smssender

import android.animation.LayoutTransition
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Typeface
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.OvershootInterpolator
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The log as a list of small cards. New lines slide in at the top and push the others down; tapping a line opens it with an
 * animated expand to show the full text, time, type, job number and a hint about what to do. Lines already on screen are kept
 * (not rebuilt), so an opened line stays open while new ones arrive.
 */
class LogListView(private val ctx: Context) : LinearLayout(ctx) {
    private class Row(val root: LinearLayout, val detail: LinearLayout, val chevron: TextView, var open: Boolean = false)

    private val rows = HashMap<Long, Row>()
    private val short = SimpleDateFormat("HH:mm:ss", Locale.US)
    private val full = SimpleDateFormat("EEE d MMM yyyy, HH:mm:ss", Locale.US)
    private var seeded = false

    init {
        orientation = VERTICAL
        layoutTransition = LayoutTransition().apply { setDuration(280) }  // fade in, fade out and slide the neighbours
    }

    val count: Int get() = rows.size

    fun sync(entries: List<LogEntry>) {
        val ids = entries.map { it.id }.toHashSet()
        for ((id, row) in rows.entries.toList()) {
            if (id !in ids) { removeView(row.root); rows.remove(id) }
        }
        var added = 0
        for (e in entries.reversed()) {  // oldest first, each one goes on top, so the newest ends up first
            if (rows.containsKey(e.id)) continue
            val row = build(e)
            rows[e.id] = row
            addView(row.root, 0)
            if (seeded && added < 4) {
                row.root.translationY = -Ui.dp(ctx, 14).toFloat()
                row.root.animate().translationY(0f).setDuration(320).setInterpolator(OvershootInterpolator(1.1f)).start()
            }
            added++
        }
        seeded = true
    }

    private fun symbol(l: LogLevel) = when (l) {
        LogLevel.OK -> "✓"
        LogLevel.ERROR -> "✕"
        LogLevel.WARN -> "!"
        LogLevel.INFO -> "•"
    }

    private fun kind(l: LogLevel) = when (l) {
        LogLevel.OK -> "Success"
        LogLevel.ERROR -> "Problem"
        LogLevel.WARN -> "Warning"
        LogLevel.INFO -> "Information"
    }

    /** A short, practical hint for messages the app itself writes. Empty when there is nothing useful to add. */
    private fun hint(e: LogEntry): String {
        val m = e.message.lowercase()
        return when {
            m.contains("pairing code was rejected") -> "Create a new pairing code on the website (Parents, then Phone) and enter it here."
            m.contains("cannot find the server") -> "Check the address for typing mistakes and that this phone has internet."
            m.contains("did not answer in time") -> "Free hosting can take up to a minute to wake up. The app keeps trying by itself."
            m.contains("secure connection failed") -> "Check that the phone's date and time are correct and the address starts with https://"
            m.startsWith("no internet") -> "Switch on mobile data or Wi-Fi. Sending continues by itself when it is back."
            m.startsWith("could not tell the website") -> "Nothing is lost: the result is saved on the phone and sent when the connection works."
            m.startsWith("no connection") -> "Check mobile data or Wi-Fi. The app tries again by itself."
            m.contains("permission to send sms") -> "Press \"Fix the first problem\" and choose Allow."
            m.startsWith("no sim") -> "Insert the SIM card that has the SMS bundle and switch the mobile network on."
            m.contains("airtime") || m.contains("bundle") -> "Check that the SIM still has airtime or an SMS bundle."
            m.startsWith("enter the") -> "Fill in the server address and the pairing code, then save."
            m.startsWith("resting") -> "A planned pause so the network does not block the SIM. Sending continues by itself."
            else -> ""
        }
    }

    private fun build(e: LogEntry): Row {
        val d = Ui.dp(ctx, 1).toFloat()
        val root = LinearLayout(ctx).apply {
            orientation = VERTICAL
            background = Ui.ripple(ctx, Ui.rounded(ctx, Ui.CARD, 12, Ui.LINE, 1), 12)
            layoutParams = LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { setMargins(0, 0, 0, Ui.dp(ctx, 8)) }
            isClickable = true
        }

        val header = LinearLayout(ctx).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(Ui.dp(ctx, 12), Ui.dp(ctx, 10), Ui.dp(ctx, 12), Ui.dp(ctx, 10))
        }
        val sym = TextView(ctx).apply {
            text = symbol(e.level)
            textSize = 16f
            setTextColor(Ui.INK)
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
            background = Ui.rounded(ctx, Ui.FIELD, 14)
        }
        header.addView(sym, LayoutParams(Ui.dp(ctx, 28), Ui.dp(ctx, 28)))

        val mid = LinearLayout(ctx).apply { orientation = VERTICAL; setPadding(Ui.dp(ctx, 10), 0, Ui.dp(ctx, 6), 0) }
        mid.addView(TextView(ctx).apply {
            text = e.message
            textSize = 13f
            setTextColor(Ui.INK)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        })
        mid.addView(TextView(ctx).apply {
            text = short.format(Date(e.millis))
            textSize = 11f
            setTextColor(Ui.MUTED)
            typeface = Typeface.MONOSPACE
        })
        header.addView(mid, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val chevron = TextView(ctx).apply { text = "▾"; textSize = 20f; setTextColor(Ui.MUTED); gravity = Gravity.CENTER }
        header.addView(chevron, LayoutParams(Ui.dp(ctx, 24), ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(header)

        val detail = LinearLayout(ctx).apply {
            orientation = VERTICAL
            setPadding(Ui.dp(ctx, 12), Ui.dp(ctx, 2), Ui.dp(ctx, 12), Ui.dp(ctx, 12))
            visibility = View.GONE
            layoutParams = LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0)
        }
        detail.addView(View(ctx).apply { setBackgroundColor(Ui.LINE) }, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, d.toInt().coerceAtLeast(1)))
        detail.addView(TextView(ctx).apply {
            text = e.message
            textSize = 13f
            setTextColor(Ui.INK)
            setTextIsSelectable(true)
            setPadding(0, Ui.dp(ctx, 10), 0, Ui.dp(ctx, 8))
        })
        val facts = StringBuilder()
        facts.append("Time:  ").append(full.format(Date(e.millis)))
        facts.append("\nType:  ").append(kind(e.level))
        Regex("job (\\d+)", RegexOption.IGNORE_CASE).find(e.message)?.let { facts.append("\nJob:   ").append(it.groupValues[1]) }
        facts.append("\nEntry: #").append(e.id)
        detail.addView(TextView(ctx).apply {
            text = facts.toString()
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setTextColor(Ui.MUTED)
        })
        if (e.detail.isNotEmpty()) {
            detail.addView(TextView(ctx).apply {
                text = e.detail
                textSize = 12f
                setTextColor(Ui.INK)
                setTextIsSelectable(true)
                setPadding(0, Ui.dp(ctx, 8), 0, 0)
            })
        }
        val h = hint(e)
        if (h.isNotEmpty()) {
            detail.addView(TextView(ctx).apply {
                text = "What to do: $h"
                textSize = 12f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Ui.INK)
                setPadding(0, Ui.dp(ctx, 8), 0, 0)
            })
        }
        detail.addView(Ui.textButton(ctx, "Copy this line") {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("Log line", "${full.format(Date(e.millis))}  ${e.message}" + if (e.detail.isNotEmpty()) "\n${e.detail}" else ""))
            Toast.makeText(ctx, "Copied", Toast.LENGTH_SHORT).show()
        })
        root.addView(detail)

        val row = Row(root, detail, chevron)
        header.setOnClickListener {
            row.open = !row.open
            Ui.setExpanded(row.detail, row.open)
            row.chevron.animate().rotation(if (row.open) 180f else 0f).setDuration(260).start()
        }
        Ui.pressable(header, 0.99f)
        return row
    }
}
