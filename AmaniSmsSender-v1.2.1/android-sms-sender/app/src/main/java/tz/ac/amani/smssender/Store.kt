package tz.ac.amani.smssender

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Settings, the list of messages already sent (so a message is never sent twice), and the on-screen log. */
object Store {
    private const val FILE = "sender"

    fun serverUrl(c: Context): String = c.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString("server", "") ?: ""
    private fun prefs(c: Context): SharedPreferences = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /**
     * The pairing code lets whoever holds it send SMS as the school, so it is kept encrypted with a key that lives in the phone's
     * hardware-backed Android Keystore (the key cannot be copied out, even from a rooted phone's files or a copied app folder).
     * A code saved in plain text by version 1.0 is encrypted the first time it is read.
     */
    fun token(c: Context): String {
        val p = prefs(c)
        val enc = p.getString("token_enc", "") ?: ""
        if (enc.isNotEmpty()) {
            return try { Vault.decrypt(enc) } catch (e: Exception) {
                AppLog.add("Could not unlock the saved pairing code. Please enter it again.")
                ""
            }
        }
        val plain = p.getString("token", "") ?: ""
        if (plain.isNotEmpty()) {
            try { p.edit().putString("token_enc", Vault.encrypt(plain)).remove("token").apply() } catch (ignored: Exception) { }
        }
        return plain
    }

    /** Whether the SMS permission was already asked once (tells "never asked" from "asked and Android will not ask again"). */
    fun askedSms(c: Context): Boolean = c.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean("asked_sms", false)
    fun setAskedSms(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean("asked_sms", true).apply()

    /**
     * Cleans what the person typed and checks it. Returns (address, problem or null). The pairing code grants the right to send
     * SMS as the school, so it may only travel over https; plain http is accepted only for a computer on the school's own network.
     */
    fun cleanServer(raw: String): Pair<String, String?> {
        var s = raw.trim().trimEnd('/')
        if (s.isEmpty()) return s to "Enter the server address first."
        if (!s.contains("://")) s = "https://$s"
        val uri = try { java.net.URI(s) } catch (e: Exception) { return s to "That server address is not valid." }
        val host = uri.host ?: return s to "That server address is not valid."
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return s to "The server address must start with https://"
        if (scheme == "http" && !isPrivateHost(host)) return s to "Use https:// for the school website. Plain http is only allowed for a computer on your own Wi-Fi."
        return s to null
    }

    private fun isPrivateHost(h: String): Boolean {
        val x = h.lowercase()
        if (x == "localhost" || x.endsWith(".local")) return true
        val p = x.split(".").mapNotNull { it.toIntOrNull() }
        if (p.size != 4) return false
        return p[0] == 10 || p[0] == 127 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && p[1] in 16..31)
    }

    fun save(c: Context, server: String, token: String) {
        c.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString("server", server.trim().trimEnd('/'))
            .also { e ->
                val t = token.trim()
                try {
                    e.putString("token_enc", Vault.encrypt(t)).remove("token")
                } catch (ex: Exception) {  // a few phones have a broken Keystore: keep working, in the app's private storage
                    AppLog.add("Secure storage is not available on this phone. The pairing code is kept in the app's private storage.")
                    e.putString("token", t).remove("token_enc")
                }
            }
            .apply()
    }

    @Synchronized
    fun wasSent(c: Context, id: Long): Boolean = sentIds(c).contains(id)

    @Synchronized
    fun markSent(c: Context, id: Long) {
        val ids = sentIds(c).toMutableList()
        if (!ids.contains(id)) ids.add(id)
        val keep = ids.takeLast(500)
        c.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString("sent", keep.joinToString(",")).apply()
    }

    /**
     * Results (sent / failed / delivered) that the website has not heard yet. Kept on the phone until the website confirms, so a
     * dropped connection never loses a result, even if the app is closed in between.
     */
    @Synchronized
    fun pendingAll(c: Context): List<Triple<Long, String, String>> {
        val raw = c.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString("pending", "") ?: ""
        if (raw.isEmpty()) return emptyList()
        return try {
            val a = org.json.JSONArray(raw)
            (0 until a.length()).map { val o = a.getJSONObject(it); Triple(o.getLong("id"), o.getString("status"), o.optString("error")) }
        } catch (e: Exception) { emptyList() }
    }

    @Synchronized
    fun pendingAdd(c: Context, id: Long, status: String, error: String) {
        val list = pendingAll(c).filterNot { it.first == id && it.second == status } + Triple(id, status, error)
        pendingSave(c, list.takeLast(200))
    }

    @Synchronized
    fun pendingRemove(c: Context, id: Long, status: String) {
        pendingSave(c, pendingAll(c).filterNot { it.first == id && it.second == status })
    }

    private fun pendingSave(c: Context, list: List<Triple<Long, String, String>>) {
        val a = org.json.JSONArray()
        list.forEach { a.put(org.json.JSONObject().put("id", it.first).put("status", it.second).put("error", it.third)) }
        c.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString("pending", a.toString()).apply()
    }

    private fun sentIds(c: Context): List<Long> =
        (c.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString("sent", "") ?: "")
            .split(",").mapNotNull { it.toLongOrNull() }
}

/** AES-256-GCM with a key generated inside, and never leaving, the Android Keystore. Stored as base64(iv + ciphertext). */
private object Vault {
    private const val ALIAS = "amani_sender_token"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    fun decrypt(stored: String): String {
        val b = Base64.decode(stored, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b, 0, 12))
        return String(c.doFinal(b, 12, b.size - 12), Charsets.UTF_8)
    }
}

enum class LogLevel { INFO, OK, WARN, ERROR }

/** One line of the on-screen log. `detail` is optional extra text shown when the line is opened. */
data class LogEntry(val id: Long, val millis: Long, val level: LogLevel, val message: String, val detail: String)

object AppLog {
    private const val MAX = 80
    private val lines = ArrayDeque<LogEntry>()
    private var next = 1L

    /** Goes up on every change, so the screen only redraws the log when something is new. */
    @Volatile
    var version = 0L
        private set

    @Synchronized
    fun add(msg: String, detail: String = "") {
        lines.addLast(LogEntry(next++, System.currentTimeMillis(), classify(msg), msg, detail))
        while (lines.size > MAX) lines.removeFirst()
        version++
    }

    /** Newest first. */
    @Synchronized
    fun entries(): List<LogEntry> = lines.reversed()

    @Synchronized
    fun clear() {
        lines.clear()
        version++
    }

    @Synchronized
    fun text(): String {
        val clock = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
        return lines.reversed().joinToString("\n") { "${clock.format(java.util.Date(it.millis))}  ${it.message}" }
    }

    private fun classify(m: String): LogLevel {
        val x = m.lowercase()
        return when {
            x.startsWith("could not tell") -> LogLevel.WARN
            x.contains("failed") || x.startsWith("problem") || x.contains("refused") || x.startsWith("could not") ||
                x.contains("rejected") || x.contains("not valid") -> LogLevel.ERROR
            x.startsWith("no connection") || x.startsWith("no internet") || x.startsWith("no sim") || x.startsWith("skipped") ||
                x.startsWith("resting") || x.startsWith("enter the") || x.startsWith("secure storage") -> LogLevel.WARN
            x.startsWith("sent") || x.startsWith("delivered") || x.startsWith("connected") || x.startsWith("started") -> LogLevel.OK
            else -> LogLevel.INFO
        }
    }
}
