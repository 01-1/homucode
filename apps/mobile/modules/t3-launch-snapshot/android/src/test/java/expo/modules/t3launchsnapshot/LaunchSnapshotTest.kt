package expo.modules.t3launchsnapshot

import android.content.Intent
import android.graphics.Bitmap
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 36], manifest = Config.NONE)
class LaunchSnapshotTest {
  @get:Rule
  val folder = TemporaryFolder()

  private val config = LaunchSnapshotConfig(
    densityDpi = 420,
    fontScale = 1f,
    nightMode = 32,
    locales = "en-US",
    versionCode = 26111700,
    lastUpdateTime = 1_000
  )
  private val header = LaunchSnapshotHeader(
    config,
    width = 8,
    height = 16,
    barsAppearance = 8,
    rows = "thread-1\nv2-settled-shelf:935:false"
  )

  private fun launcherStart(
    restored: Boolean = false,
    action: String? = Intent.ACTION_MAIN,
    launcherCategory: Boolean = true,
    hasData: Boolean = false,
    hasExtras: Boolean = false
  ) = isPlainLauncherStart(restored, action, launcherCategory, hasData, hasExtras)

  @Test
  fun onlyAColdStartFromTheLauncherIconGetsThePicture() {
    assertTrue(launcherStart())
    assertFalse(launcherStart(restored = true))
    assertFalse(launcherStart(action = Intent.ACTION_VIEW))
    assertFalse(launcherStart(action = null))
    assertFalse(launcherStart(launcherCategory = false))
    assertFalse(launcherStart(hasData = true))
    assertFalse(launcherStart(hasExtras = true))
  }

  @Test
  fun thePictureFitsOnlyTheWindowAndSettingsItWasTakenUnder() {
    assertTrue(header.fits(config, 8, 16))
    assertTrue(header.fits(config, null, null))
    assertFalse(header.fits(config, 16, 8))
    assertFalse(header.fits(config.copy(densityDpi = 480), 8, 16))
    assertFalse(header.fits(config.copy(fontScale = 1.3f), 8, 16))
    assertFalse(header.fits(config.copy(nightMode = 16), 8, 16))
    assertFalse(header.fits(config.copy(locales = "de-DE"), 8, 16))
    assertFalse(header.fits(config.copy(versionCode = 26111701), 8, 16))
    assertFalse(header.fits(config.copy(lastUpdateTime = 2_000), 8, 16))
  }

  @Test
  fun aSavedPictureKeepsItsHeaderAndClearingDeletesItsFile() {
    val directory = File(folder.root, "launch-snapshot")
    val store = LaunchSnapshotStore(directory)
    assertNull(store.readHeader())

    store.save(header, Bitmap.createBitmap(8, 16, Bitmap.Config.ARGB_8888))
    assertEquals(header, store.readHeader())
    assertEquals(listOf("home"), directory.list()?.toList())

    store.delete()
    assertNull(store.readHeader())
    assertEquals(emptyList<String>(), directory.list()?.toList())
  }

  @Test
  fun aPictureSavedUnderOtherSettingsIsNotDecoded() {
    val store = LaunchSnapshotStore(File(folder.root, "launch-snapshot"))
    store.save(header, Bitmap.createBitmap(8, 16, Bitmap.Config.ARGB_8888))

    assertNull(store.decode(header.copy(config = config.copy(fontScale = 1.3f))))
  }
}
