package com.hefesoft.savia.companion.preview

import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    private val segmentExecutor = Executors.newSingleThreadExecutor()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "savia.companion/audio_segments",
        ).setMethodCallHandler { call, result ->
            if (call.method != "segmentAacFile") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            val sourcePath = call.argument<String>("sourcePath")
            val outputDirectory = call.argument<String>("outputDirectory")
            val artifactId = call.argument<String>("artifactId")
            val segmentSeconds = call.argument<Int>("segmentSeconds") ?: 30
            val maxSegments = call.argument<Int>("maxSegments") ?: 120
            if (sourcePath == null || outputDirectory == null || artifactId == null) {
                result.error("INVALID_ARGUMENT", "Audio source is unavailable.", null)
                return@setMethodCallHandler
            }
            segmentExecutor.execute {
                try {
                    val segments = segmentAacFile(
                        sourcePath,
                        outputDirectory,
                        artifactId,
                        segmentSeconds,
                        maxSegments,
                    )
                    runOnUiThread { result.success(segments) }
                } catch (error: Exception) {
                    runOnUiThread {
                        result.error("SEGMENTATION_FAILED", "Could not segment the recording.", null)
                    }
                }
            }
        }
    }

    private fun segmentAacFile(
        sourcePath: String,
        outputDirectory: String,
        artifactId: String,
        segmentSeconds: Int,
        maxSegments: Int,
    ): List<Map<String, Any>> {
        val source = File(sourcePath)
        val output = File(outputDirectory)
        require(source.isFile && source.length() in 1..50_000_000)
        require(output.isDirectory || output.mkdirs())
        require(artifactId.matches(Regex("[0-9a-fA-F-]{36}")))
        require(segmentSeconds == 30 && maxSegments == 120)

        val probe = MediaExtractor()
        val audioTrack: Int
        val format: MediaFormat
        val durationUs: Long
        try {
            probe.setDataSource(source.absolutePath)
            audioTrack = (0 until probe.trackCount).firstOrNull { index ->
                probe.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw IllegalArgumentException("Audio track not found")
            format = probe.getTrackFormat(audioTrack)
            require(format.getString(MediaFormat.KEY_MIME) == "audio/mp4a-latm")
            durationUs = format.getLong(MediaFormat.KEY_DURATION)
        } finally {
            probe.release()
        }
        val maxDurationUs = 3_600_000_000L
        require(durationUs > 0)
        val acceptedDurationUs = minOf(durationUs, maxDurationUs)
        val segmentUs = segmentSeconds * 1_000_000L
        val count = ((acceptedDurationUs + segmentUs - 1) / segmentUs).toInt()
        require(count in 1..maxSegments)
        val sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE).coerceAtLeast(1)
        val frameDurationUs = ((1024L * 1_000_000L + sampleRate - 1) / sampleRate).coerceAtLeast(1)
        val completed = mutableListOf<Map<String, Any>>()

        try {
            for (sequence in 0 until count) {
                val startUs = sequence * segmentUs
                val endUs = minOf(startUs + segmentUs, acceptedDurationUs)
                val extractor = MediaExtractor()
                var muxer: MediaMuxer? = null
                val file = File(output, "$artifactId-segment-${sequence.toString().padStart(3, '0')}.m4a")
                try {
                    if (file.exists()) file.delete()
                    extractor.setDataSource(source.absolutePath)
                    extractor.selectTrack(audioTrack)
                    extractor.seekTo(startUs, MediaExtractor.SEEK_TO_NEXT_SYNC)
                    muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                    val muxTrack = muxer.addTrack(format)
                    muxer.start()
                    val buffer = ByteBuffer.allocate(256 * 1024)
                    val info = MediaCodecInfoBuffer()
                    var firstUs = -1L
                    var lastUs = -1L
                    while (true) {
                        val sampleTrack = extractor.sampleTrackIndex
                        val sampleTime = extractor.sampleTime
                        if (sampleTrack < 0 || sampleTime < 0) break
                        if (sampleTime >= endUs) break
                        if (sampleTrack == audioTrack) {
                            buffer.clear()
                            val size = extractor.readSampleData(buffer, 0)
                            if (size < 0) break
                            if (firstUs < 0) firstUs = sampleTime
                            lastUs = sampleTime
                            info.offset = 0
                            info.size = size
                            info.presentationTimeUs = (sampleTime - startUs).coerceAtLeast(0)
                            info.flags = extractor.sampleFlags
                            muxer.writeSampleData(muxTrack, buffer, info.toAndroid())
                        }
                        if (!extractor.advance()) break
                    }
                    muxer.stop()
                    require(firstUs >= 0 && lastUs >= firstUs && file.length() > 0)
                    val duration = ((lastUs - firstUs + frameDurationUs)
                        .coerceAtMost(endUs - startUs)
                        .toDouble() / 1_000_000.0)
                    require(duration > 0 && duration <= segmentSeconds + 0.1)
                    completed.add(
                        mapOf(
                            "path" to file.absolutePath,
                            "startSeconds" to (startUs.toDouble() / 1_000_000.0),
                            "durationSeconds" to duration,
                            "bytes" to file.length().toInt(),
                        ),
                    )
                } catch (error: Exception) {
                    file.delete()
                    throw error
                } finally {
                    try { muxer?.release() } catch (_: Exception) { }
                    extractor.release()
                }
            }
            return completed
        } catch (error: Exception) {
            completed.forEach { item -> (item["path"] as? String)?.let { File(it).delete() } }
            throw error
        }
    }

    private class MediaCodecInfoBuffer {
        var offset: Int = 0
        var size: Int = 0
        var presentationTimeUs: Long = 0
        var flags: Int = 0

        fun toAndroid(): android.media.MediaCodec.BufferInfo = android.media.MediaCodec.BufferInfo().apply {
            set(offset, size, presentationTimeUs, flags)
        }
    }
}
