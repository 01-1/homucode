package expo.modules.t3launchsnapshot

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.AtomicFile
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException

/** The one saved picture of Home's list: a header, then a PNG of the whole window. */
internal class LaunchSnapshotStore(private val directory: File) {
  private val file = AtomicFile(File(directory, "home"))

  fun readHeader(): LaunchSnapshotHeader? {
    if (!file.baseFile.isFile) return null
    return try {
      DataInputStream(file.openRead()).use(LaunchSnapshotHeader::read)
    } catch (_: IOException) {
      null
    }
  }

  /** The picture, when it is still the one `expected` describes. */
  fun decode(expected: LaunchSnapshotHeader): Bitmap? = try {
    DataInputStream(file.openRead().buffered()).use { input ->
      if (LaunchSnapshotHeader.read(input) != expected) return null
      BitmapFactory.decodeStream(input)?.takeIf {
        it.width == expected.width && it.height == expected.height
      }
    }
  } catch (_: IOException) {
    null
  }

  fun save(header: LaunchSnapshotHeader, picture: Bitmap) {
    directory.mkdirs()
    val stream = try {
      file.startWrite()
    } catch (_: IOException) {
      return
    }
    try {
      val output = DataOutputStream(stream.buffered())
      header.write(output)
      if (!picture.compress(Bitmap.CompressFormat.PNG, 100, output)) {
        throw IOException("PNG encoding failed")
      }
      output.flush()
      file.finishWrite(stream)
    } catch (_: IOException) {
      file.failWrite(stream)
    }
  }

  fun delete() = file.delete()
}
