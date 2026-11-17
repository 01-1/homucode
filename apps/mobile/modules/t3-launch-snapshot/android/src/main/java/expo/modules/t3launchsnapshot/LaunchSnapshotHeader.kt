package expo.modules.t3launchsnapshot

import android.content.Intent
import java.io.DataInputStream
import java.io.DataOutputStream

/** Everything outside the window's size that changes how the same list is drawn. */
internal data class LaunchSnapshotConfig(
  val densityDpi: Int,
  val fontScale: Float,
  val nightMode: Int,
  val locales: String,
  val versionCode: Long,
  // Two installs can share a version code; a reinstall can still change what is drawn.
  val lastUpdateTime: Long
)

/** What a saved picture was taken under. It leads the picture's file. */
internal data class LaunchSnapshotHeader(
  val config: LaunchSnapshotConfig,
  val width: Int,
  val height: Int,
  /** The status and navigation bar icon colors that went with the picture. */
  val barsAppearance: Int,
  /** JS's name for the list rows in the picture; the launch waits for the real list to match. */
  val rows: String
) {
  /** A launch shows the picture only in the window it was taken in. Null: size not known yet. */
  fun fits(current: LaunchSnapshotConfig, windowWidth: Int?, windowHeight: Int?): Boolean =
    config == current &&
      (windowWidth == null || windowWidth == width) &&
      (windowHeight == null || windowHeight == height)

  fun write(output: DataOutputStream) {
    output.writeInt(FORMAT)
    output.writeInt(config.densityDpi)
    output.writeFloat(config.fontScale)
    output.writeInt(config.nightMode)
    output.writeUTF(config.locales)
    output.writeLong(config.versionCode)
    output.writeLong(config.lastUpdateTime)
    output.writeInt(width)
    output.writeInt(height)
    output.writeInt(barsAppearance)
    output.writeUTF(rows)
  }

  companion object {
    private const val FORMAT = 0x54334C32

    fun read(input: DataInputStream): LaunchSnapshotHeader? {
      if (input.readInt() != FORMAT) return null
      val config = LaunchSnapshotConfig(
        densityDpi = input.readInt(),
        fontScale = input.readFloat(),
        nightMode = input.readInt(),
        locales = input.readUTF(),
        versionCode = input.readLong(),
        lastUpdateTime = input.readLong()
      )
      return LaunchSnapshotHeader(
        config,
        width = input.readInt(),
        height = input.readInt(),
        barsAppearance = input.readInt(),
        rows = input.readUTF()
      )
    }
  }
}

/**
 * Whether an activity is starting cold from the launcher icon. A restored activity, a link, a
 * notification or a shortcut can open another screen, so none of them gets the Home picture.
 */
internal fun isPlainLauncherStart(
  restored: Boolean,
  action: String?,
  launcherCategory: Boolean,
  hasData: Boolean,
  hasExtras: Boolean
): Boolean = !restored && action == Intent.ACTION_MAIN && launcherCategory && !hasData && !hasExtras
