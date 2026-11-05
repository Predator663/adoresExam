package tz.ac.amani.smssender

import android.content.Context
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * The PIN that protects the server address and the pairing code from being edited.
 * Only a salted PBKDF2 hash of the PIN is stored, never the PIN itself. After 5 wrong tries the app makes the person wait
 * (30 s, doubling each time, at most 5 minutes). This is a guard against casual changes on a shared phone.
 */
object Lock {
    private const val FILE = "sender"
    private const val ITERATIONS = 30_000
    const val MIN_LEN = 4
    const val MAX_LEN = 8

    enum class Result { OK, WRONG, WAIT }

    private fun prefs(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun hasPin(c: Context): Boolean = prefs(c).getString("pin_hash", "").orEmpty().isNotEmpty()

    fun setPin(c: Context, pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        prefs(c).edit()
            .putString("pin_salt", Base64.encodeToString(salt, Base64.NO_WRAP))
            .putString("pin_hash", Base64.encodeToString(hash(pin, salt), Base64.NO_WRAP))
            .putInt("pin_fails", 0)
            .putLong("pin_until", 0L)
            .apply()
    }

    fun clearPin(c: Context) {
        prefs(c).edit().remove("pin_salt").remove("pin_hash").remove("pin_fails").remove("pin_until").apply()
    }

    /** Seconds left before another try is allowed (0 = allowed now). */
    fun waitSeconds(c: Context): Int {
        val left = prefs(c).getLong("pin_until", 0L) - System.currentTimeMillis()
        return if (left <= 0) 0 else ((left + 999) / 1000).toInt()
    }

    fun verify(c: Context, pin: String): Result {
        if (waitSeconds(c) > 0) return Result.WAIT
        val p = prefs(c)
        val salt = Base64.decode(p.getString("pin_salt", "") ?: "", Base64.NO_WRAP)
        val want = Base64.decode(p.getString("pin_hash", "") ?: "", Base64.NO_WRAP)
        if (MessageDigest.isEqual(want, hash(pin, salt))) {
            p.edit().putInt("pin_fails", 0).putLong("pin_until", 0L).apply()
            return Result.OK
        }
        val fails = p.getInt("pin_fails", 0) + 1
        val e = p.edit().putInt("pin_fails", fails)
        if (fails >= 5) {
            val seconds = minOf(300L, 30L shl minOf(fails - 5, 4))
            e.putLong("pin_until", System.currentTimeMillis() + seconds * 1000)
        }
        e.apply()
        return Result.WRONG
    }

    private fun hash(pin: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, 256)).encoded
}
