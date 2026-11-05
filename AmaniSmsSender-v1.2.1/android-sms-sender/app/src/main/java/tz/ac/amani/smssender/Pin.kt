package tz.ac.amani.smssender

import android.animation.ValueAnimator
import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.LinearLayout
import android.widget.TextView

/** A small padlock drawn with the canvas. `setOpen` swings the shackle open or shut. */
class LockIcon(c: Context) : View(c) {
    private val body = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Ui.INK }
    private val hole = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Ui.CARD }
    private val shackle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Ui.INK; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private var open = 0f
    private var anim: ValueAnimator? = null

    fun setOpen(target: Boolean, animate: Boolean) {
        anim?.cancel()
        val to = if (target) 1f else 0f
        if (!animate) { open = to; invalidate(); return }
        anim = ValueAnimator.ofFloat(open, to).apply {
            duration = 420
            interpolator = OvershootInterpolator(2.2f)
            addUpdateListener { open = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    override fun onDetachedFromWindow() {
        anim?.cancel()
        super.onDetachedFromWindow()
    }

    override fun onDraw(cv: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val bodyTop = h * 0.46f
        shackle.strokeWidth = w * 0.11f
        val cx = w / 2f
        val r = w * 0.2f
        val footY = bodyTop + h * 0.02f

        cv.save()
        cv.translate(0f, -open * h * 0.09f)
        cv.rotate(open * 26f, cx + r, bodyTop)
        val p = Path().apply {
            moveTo(cx - r, footY)
            lineTo(cx - r, h * 0.30f)
            arcTo(RectF(cx - r, h * 0.30f - r, cx + r, h * 0.30f + r), 180f, 180f)
            lineTo(cx + r, footY)
        }
        cv.drawPath(p, shackle)
        cv.restore()

        cv.drawRoundRect(w * 0.14f, bodyTop, w * 0.86f, h * 0.94f, w * 0.12f, w * 0.12f, body)
        cv.drawCircle(cx, h * 0.68f, w * 0.07f, hole)
    }
}

/**
 * A PIN pad with dots that fill as digits are typed. The caller decides what happens with the PIN in [onSubmit]:
 * call [fail] (shakes), [reset] (next step, e.g. "repeat the PIN") or [dismiss].
 */
class PinDialog(
    private val a: Activity,
    private val title0: String,
    private val sub0: String,
    private val showForgot: Boolean = false,
    private val onSubmit: (pin: String, dialog: PinDialog) -> Unit,
) {
    private val dialog = Dialog(a)
    private val pin = StringBuilder()
    private val dotViews = ArrayList<View>()
    private lateinit var dotRow: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var subView: TextView
    private lateinit var msgView: TextView
    private lateinit var go: TextView
    private lateinit var card: LinearLayout

    private fun dp(v: Int) = Ui.dp(a, v)

    private fun dotBackground(filled: Boolean) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(if (filled) Ui.INK else Ui.CARD)
        setStroke(dp(2), Ui.INK)
    }

    private fun newDot(filled: Boolean) = View(a).apply {
        background = dotBackground(filled)
        layoutParams = LinearLayout.LayoutParams(dp(14), dp(14)).apply { setMargins(dp(6), 0, dp(6), 0) }
    }

    fun show() {
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        card = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = Ui.rounded(a, Ui.CARD, 20)
            setPadding(dp(20), dp(22), dp(20), dp(16))
        }
        val icon = LockIcon(a).apply { layoutParams = LinearLayout.LayoutParams(dp(34), dp(34)) }
        card.addView(icon)
        titleView = Ui.text(a, title0, 20f, true).apply { gravity = Gravity.CENTER; setPadding(0, dp(10), 0, dp(2)) }
        subView = Ui.muted(a, sub0, 13f).apply { gravity = Gravity.CENTER; setPadding(dp(6), 0, dp(6), dp(10)) }
        card.addView(titleView)
        card.addView(subView)

        dotRow = LinearLayout(a).apply { gravity = Gravity.CENTER; minimumHeight = dp(30) }
        repeat(Lock.MIN_LEN) { val d = newDot(false); dotViews.add(d); dotRow.addView(d) }
        card.addView(dotRow, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(30)))

        msgView = Ui.muted(a, "", 13f).apply { gravity = Gravity.CENTER; setTextColor(Ui.INK); setPadding(0, dp(4), 0, dp(6)); minHeight = dp(28) }
        card.addView(msgView)

        val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("⌫", "0", "✓"))
        for (r in rows) {
            val row = LinearLayout(a)
            for (k in r) row.addView(key(k), LinearLayout.LayoutParams(0, dp(54), 1f).apply { setMargins(dp(4), dp(4), dp(4), dp(4)) })
            card.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        if (showForgot) {
            card.addView(Ui.textButton(a, "Forgot the PIN?") {
                AlertDialog.Builder(a).setTitle("Forgot the PIN?").setMessage(
                    "The PIN cannot be recovered. To start again, open Android Settings > Apps > Amani SMS Sender > Storage and choose Clear data. " +
                        "This also erases the saved server address and pairing code, so create a new pairing code on the website."
                ).setPositiveButton("OK", null).show()
            })
        }
        refreshGo(false)

        dialog.setContentView(card)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            val width = minOf((a.resources.displayMetrics.widthPixels * 0.9f).toInt(), dp(360))
            setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        card.alpha = 0f
        card.scaleX = 0.9f
        card.scaleY = 0.9f
        dialog.show()
        card.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(OvershootInterpolator(1.4f)).start()
    }

    private fun key(label: String): TextView = TextView(a).apply {
        text = label
        textSize = 22f
        gravity = Gravity.CENTER
        val primary = label == "✓"
        setTextColor(if (primary) Ui.CARD else Ui.INK)
        if (primary) setTypeface(typeface, Typeface.BOLD)
        background = Ui.ripple(a, Ui.rounded(a, if (primary) Ui.INK else Ui.FIELD, 14), 14)
        isClickable = true
        Ui.pressable(this, 0.92f)
        setOnClickListener {
            it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            when (label) {
                "⌫" -> backspace()
                "✓" -> submit()
                else -> type(label)
            }
        }
        if (primary) go = this
    }

    private fun type(d: String) {
        if (pin.length >= Lock.MAX_LEN) return
        msgView.text = ""
        val i = pin.length
        pin.append(d)
        val dot: View
        if (i < dotViews.size) {
            dot = dotViews[i]
            dot.background = dotBackground(true)
        } else {
            dot = newDot(true)
            dotViews.add(dot)
            dotRow.addView(dot)
        }
        dot.scaleX = 0.5f
        dot.scaleY = 0.5f
        dot.animate().scaleX(1f).scaleY(1f).setDuration(220).setInterpolator(OvershootInterpolator(3f)).start()
        refreshGo(true)
    }

    private fun backspace() {
        if (pin.isEmpty()) return
        pin.deleteCharAt(pin.length - 1)
        val i = pin.length
        if (i >= Lock.MIN_LEN) {
            val dot = dotViews.removeAt(i)
            dot.animate().scaleX(0f).scaleY(0f).setDuration(140).withEndAction { dotRow.removeView(dot) }.start()
        } else {
            dotViews[i].background = dotBackground(false)
        }
        refreshGo(true)
    }

    private fun refreshGo(animate: Boolean) {
        val ready = pin.length >= Lock.MIN_LEN
        go.isEnabled = ready
        val a1 = if (ready) 1f else 0.3f
        if (animate) go.animate().alpha(a1).setDuration(160).start() else go.alpha = a1
    }

    private fun submit() {
        if (pin.length < Lock.MIN_LEN) return
        onSubmit(pin.toString(), this)
    }

    /** Clears the digits without any message (new step or after a failure). */
    private fun clearDigits() {
        pin.setLength(0)
        while (dotViews.size > Lock.MIN_LEN) { val d = dotViews.removeAt(dotViews.size - 1); dotRow.removeView(d) }
        dotViews.forEach { it.background = dotBackground(false) }
        refreshGo(true)
    }

    fun fail(message: String) {
        clearDigits()
        msgView.text = message
        Ui.shake(dotRow)
        Ui.shake(msgView)
    }

    fun reset(title: String, subtitle: String) {
        clearDigits()
        msgView.text = ""
        Ui.setTextAnimated(titleView, title)
        Ui.setTextAnimated(subView, subtitle)
    }

    fun dismiss() {
        card.animate().alpha(0f).scaleX(0.94f).scaleY(0.94f).setDuration(140).withEndAction {
            try { dialog.dismiss() } catch (ignored: Exception) { }
        }.start()
    }
}
