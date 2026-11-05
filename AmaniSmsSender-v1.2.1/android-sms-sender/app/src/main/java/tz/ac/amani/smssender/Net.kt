package tz.ac.amani.smssender

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.net.ssl.SSLException

/** Connection helpers: is the phone online, how long to wait before the next try, a plain-words reason for a failure, and what the screen shows. */
object Net {
    @Volatile var state = ""
    @Volatile var lastOkMillis = 0L
    @Volatile var failures = 0

    fun online(c: Context): Boolean = try {
        val cm = c.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val n = cm.activeNetwork
        val caps = if (n == null) null else cm.getNetworkCapabilities(n)
        caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    } catch (e: Exception) {
        true  // if Android will not say, just try: the call itself shows whether it works
    }

    /** 5, 10, 20, 40, 80, then 120 seconds, plus up to 3 s so many phones do not knock together. Starts again after one success. */
    fun backoffSeconds(failures: Int): Int {
        val base = minOf(120, 5 shl minOf(failures - 1, 5).coerceAtLeast(0))
        return base + kotlin.random.Random.nextInt(0, 4)
    }

    fun explain(e: Exception): String = when (e) {
        is UnknownHostException -> "Cannot find the server. Check the address and that this phone has internet"
        is SocketTimeoutException -> "The server did not answer in time (free hosting can take a minute to wake up)"
        is ConnectException -> "Could not connect to the server"
        is SSLException -> "The secure connection failed. Check the phone's date and time and that the address starts with https://"
        is SocketException -> "The connection was cut"
        else -> e.message ?: e.javaClass.simpleName
    }

    fun reset() {
        state = ""
        failures = 0
    }

    /** One line for the screen while sending runs. */
    fun summary(): String {
        if (state.isEmpty()) return ""
        val t = lastOkMillis
        return if (t > 0) "$state · last contact ${SimpleDateFormat("HH:mm:ss", Locale.US).format(Date(t))}" else state
    }
}
