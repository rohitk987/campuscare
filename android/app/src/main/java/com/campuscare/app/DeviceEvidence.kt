package com.campuscare.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class DeviceEvidence(private val context: Context) {
    @Suppress("MissingPermission", "DEPRECATION")
    suspend fun position(): Position = withContext(Dispatchers.Main) {
        check(ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { "Allow precise location to report this issue. You can still track complaints without it." }
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { manager.isProviderEnabled(it) }
        check(providers.isNotEmpty()) { "Turn on your phone’s location and retry." }
        try {
            withTimeout(30000) {
                suspendCancellableCoroutine { continuation ->
                    lateinit var listener: LocationListener
                    listener = object : LocationListener {
                        override fun onLocationChanged(location: Location) {
                            if (!continuation.isActive || System.currentTimeMillis() - location.time > 25000 || !location.hasAccuracy()) return
                            manager.removeUpdates(this)
                            if (location.isFromMockProvider) continuation.resumeWithException(IllegalStateException("A mock location was detected. Use the phone’s real location to report."))
                            else continuation.resume(Position(location.latitude, location.longitude, location.accuracy.toDouble(), location.time))
                        }
                        override fun onProviderEnabled(provider: String) {}
                        override fun onProviderDisabled(provider: String) {}
                        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                    }
                    continuation.invokeOnCancellation { manager.removeUpdates(listener) }
                    providers.forEach { manager.requestLocationUpdates(it, 0L, 0f, listener, Looper.getMainLooper()) }
                }
            }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) { throw IllegalStateException("A fresh location could not be obtained. Move to a clearer area and retry.") }
    }
    suspend fun preparePhoto(file: File, position: Position): ByteArray = withContext(Dispatchers.IO) {
        check(file.exists() && file.length() > 0) { "The camera did not save a photo. Please retake it." }
        val orientation = ExifInterface(file).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(file.path, bounds)
        check(bounds.outWidth > 0 && bounds.outHeight > 0) { "The captured photo could not be read." }
        val options = BitmapFactory.Options().apply { inSampleSize = 1; while (maxOf(bounds.outWidth, bounds.outHeight) / inSampleSize > 2400) inSampleSize *= 2 }
        val original = BitmapFactory.decodeFile(file.path, options) ?: error("Unable to read the captured photo.")
        val matrix = Matrix().apply { when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
        } }
        val rotated = Bitmap.createBitmap(original, 0, 0, original.width, original.height, matrix, true)
        val scale = minOf(1.0, 1600.0 / maxOf(rotated.width, rotated.height))
        val result = Bitmap.createScaledBitmap(rotated, (rotated.width * scale).toInt(), (rotated.height * scale).toInt(), true)
        file.outputStream().use { result.compress(Bitmap.CompressFormat.JPEG, 84, it) }
        ExifInterface(file).apply { setLatLong(position.latitude, position.longitude); setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString()); saveAttributes() }
        val bytes = file.readBytes()
        if (result !== rotated) result.recycle(); if (rotated !== original) rotated.recycle(); original.recycle()
        check(bytes.size <= 5 * 1024 * 1024) { "Photo is too large. Please retake it." }
        bytes
    }
}
