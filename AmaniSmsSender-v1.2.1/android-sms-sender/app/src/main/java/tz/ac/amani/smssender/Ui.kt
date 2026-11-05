package tz.ac.amani.smssender

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Calendar

/** Small helpers shared by all screens, so they look and move the same. Only greys, black and white: the motion carries the design. */
object Ui {
    const val SCHOOL = "Amani Girls Secondary School"

    val INK = 0xFF1A1A1A.toInt()
    val MUTED = 0xFF6B6B6B.toInt()
    val PAPER = 0xFFF2F2F2.toInt()
    val CARD = 0xFFFFFFFF.toInt()
    val FIELD = 0xFFF2F2F2.toInt()
    val LINE = 0xFFE0E0E0.toInt()
    private val RIPPLE = 0x22000000

    fun dp(c: Context, v: Int) = (v * c.resources.displayMetrics.density).toInt()

    fun text(c: Context, s: String, sp: Float, bold: Boolean = false) = TextView(c).apply {
        text = s
        textSize = sp
        setTextColor(INK)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(c, 6), 0, dp(c, 6))
    }

    fun muted(c: Context, s: String, sp: Float) = text(c, s, sp).apply { setTextColor(MUTED) }

    fun rounded(c: Context, fill: Int, radiusDp: Int, strokeColor: Int = 0, strokeDp: Int = 0) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(c, radiusDp).toFloat()
        if (strokeDp > 0) setStroke(dp(c, strokeDp), strokeColor)
    }

    fun ripple(c: Context, base: GradientDrawable, radiusDp: Int): RippleDrawable {
        val mask = GradientDrawable().apply { setColor(0xFF000000.toInt()); cornerRadius = dp(c, radiusDp).toFloat() }
        return RippleDrawable(ColorStateList.valueOf(RIPPLE), base, mask)
    }

    /** A white rounded surface that lifts slightly off the page. Add it with [cardParams]. */
    fun card(c: Context) = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(c, CARD, 16)
        elevation = dp(c, 2).toFloat()
        setPadding(dp(c, 16), dp(c, 14), dp(c, 16), dp(c, 16))
    }

    fun cardParams(c: Context) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        .apply { setMargins(0, 0, 0, dp(c, 14)) }

    /** Dark button for the main action, light one for the rest. Presses in slightly and springs back. */
    fun button(c: Context, label: String, primary: Boolean = false, onClick: () -> Unit) = Button(c).apply {
        text = label
        transformationMethod = null  // normal letters; TextView.setAllCaps() only exists from Android 9, this app supports Android 8
        textSize = 15f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(if (primary) CARD else INK)
        stateListAnimator = null
        minHeight = dp(c, 48)
        minimumHeight = dp(c, 48)
        background = ripple(c, rounded(c, if (primary) INK else FIELD, 12), 12)
        setOnClickListener { onClick() }
        pressable(this)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            .apply { setMargins(0, dp(c, 8), 0, 0) }
    }

    /** A quiet text-only action, used for small things such as "Lock now". */
    fun textButton(c: Context, label: String, onClick: () -> Unit) = TextView(c).apply {
        text = label
        textSize = 14f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(INK)
        paintFlags = paintFlags or Paint.UNDERLINE_TEXT_FLAG
        setPadding(dp(c, 4), dp(c, 12), dp(c, 14), dp(c, 12))
        setOnClickListener { onClick() }
        pressable(this)
    }

    /** Scales a view down a little while it is pressed. The touch is not consumed, so clicks still work. */
    @Suppress("ClickableViewAccessibility")
    fun pressable(v: View, scale: Float = 0.97f) {
        v.setOnTouchListener { view, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> view.animate().scaleX(scale).scaleY(scale).setDuration(90).start()
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                    view.animate().scaleX(1f).scaleY(1f).setDuration(220).setInterpolator(OvershootInterpolator(2f)).start()
            }
            false
        }
    }

    /** Fades and lifts the views in one after another. */
    fun reveal(views: List<View>, baseDelay: Long = 0L) {
        views.forEachIndexed { i, v ->
            v.alpha = 0f
            v.translationY = v.resources.displayMetrics.density * 18f
            v.animate().alpha(1f).translationY(0f).setStartDelay(baseDelay + i * 70L).setDuration(420)
                .setInterpolator(DecelerateInterpolator(2f)).start()
        }
    }

    /** Changes a label with a short cross-fade, only when the text really changed. */
    fun setTextAnimated(tv: TextView, s: String) {
        if (tv.text.toString() == s) return
        if (!tv.isAttachedToWindow) { tv.text = s; return }
        tv.animate().cancel()
        tv.animate().alpha(0f).setDuration(110).withEndAction {
            tv.text = s
            tv.animate().alpha(1f).setDuration(180).start()
        }.start()
    }

    private fun targetHeight(v: View): Int {
        val p = v.parent as View
        val w = p.width - p.paddingLeft - p.paddingRight
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
        return v.measuredHeight
    }

    /** Smoothly opens or closes a collapsible block (its height and its opacity). Safe to call again mid-animation. */
    fun setExpanded(v: View, expand: Boolean) {
        (v.tag as? ValueAnimator)?.let { it.removeAllListeners(); it.cancel() }
        val lp = v.layoutParams
        val from = if (v.visibility == View.VISIBLE) v.height else 0
        val to = if (expand) targetHeight(v) else 0
        v.visibility = View.VISIBLE
        val a = ValueAnimator.ofInt(from, to).apply {
            duration = if (expand) 300 else 220
            interpolator = DecelerateInterpolator(1.6f)
            addUpdateListener {
                lp.height = it.animatedValue as Int
                v.layoutParams = lp
                v.alpha = if (to == 0) (lp.height.toFloat() / from.coerceAtLeast(1)).coerceIn(0f, 1f) else (lp.height.toFloat() / to).coerceIn(0f, 1f)
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    lp.height = if (expand) ViewGroup.LayoutParams.WRAP_CONTENT else 0
                    v.layoutParams = lp
                    v.alpha = 1f
                    if (!expand) v.visibility = View.GONE
                    v.tag = null
                }
            })
        }
        v.tag = a
        a.start()
    }

    /** A short side-to-side shake, used when a PIN is wrong. */
    fun shake(v: View) {
        val d = v.resources.displayMetrics.density
        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 380
            addUpdateListener {
                val t = it.animatedFraction
                v.translationX = (Math.sin(t * Math.PI * 6) * (1 - t) * 10 * d).toFloat()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) { v.translationX = 0f }
            })
        }.start()
    }

    /** The copyright line shown at the bottom of every screen. The year follows the phone's clock. */
    fun copyright(): String = "© ${Calendar.getInstance().get(Calendar.YEAR)} $SCHOOL. All rights reserved."

    /** Footer pinned under the scrolling content. `aboutLink` adds the way to the About screen. */
    fun footer(a: Activity, aboutLink: Boolean): View = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(a, 12), dp(a, 4), dp(a, 12), dp(a, 8))
        setBackgroundColor(0xFFF2F2F2.toInt())
        if (aboutLink) {
            addView(TextView(a).apply {
                text = "About this app and the developer"
                textSize = 14f
                setTextColor(0xFF1565C0.toInt())
                paintFlags = paintFlags or Paint.UNDERLINE_TEXT_FLAG
                gravity = Gravity.CENTER
                setPadding(dp(a, 8), dp(a, 10), dp(a, 8), dp(a, 6))
                setOnClickListener {
                    a.startActivity(Intent(a, AboutActivity::class.java))
                    a.overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
                }
            }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        addView(TextView(a).apply {
            text = copyright()
            textSize = 12f
            setTextColor(0xFF555555.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(a, 4), 0, dp(a, 4))
        }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }
}
