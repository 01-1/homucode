package expo.modules.t3launchsnapshot

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.annotation.RequiresApi
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Shows the saved picture of Home's list in a cold launch's first frame, in place of the system
 * splash, and removes it when JS says the real list is drawn.
 *
 * Android 10 is the floor: MainActivity hands React Native a null saved state, and only the
 * pre-created callback added in Android 10 still sees the real one.
 */
@RequiresApi(Build.VERSION_CODES.Q)
internal object LaunchSnapshotOverlay : Application.ActivityLifecycleCallbacks {
  private const val TAG = "T3LaunchSnapshot"

  // JS asks for the handover. This only keeps a launch that never asks from staying behind a
  // picture.
  private const val SAFETY_TIMEOUT_MS = 10_000L
  private const val FADE_MS = 120L

  // JS asks for the handover when its list is ready, but the views it committed reach the screen
  // over the next frames. The picture stays until the window has not redrawn for this many
  // frames, or until the limit when something on screen never stops animating.
  private const val REST_FRAMES = 8
  private const val REST_LIMIT_MS = 600L

  // After the handover expo-splash-screen fades the system splash out inside this window, for
  // 400 ms unless the app changes that. A copy taken before it is gone would be of the splash.
  private const val SPLASH_EXIT_MS = 1_000L

  // A capture waits for one frame. A window that is not drawing draws it on some later screen.
  private const val FRAME_WAIT_MS = 500L
  private const val BARS =
    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
      WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS

  // Async, so a decoded picture is attached even while a pending frame holds back ordinary
  // messages.
  private val main = Handler.createAsync(Looper.getMainLooper())
  private val files = Executors.newSingleThreadExecutor { Thread(it, "t3-launch-snapshot") }
  private val clears = AtomicInteger()

  // Set while the application is created, before any thread that reads it starts.
  private var store: LaunchSnapshotStore? = null
  private var launchSeen = false

  // Written on the main thread; JS reads it to learn whether a picture is up.
  @Volatile
  private var launch: Launch? = null
  private var handedOverAt = 0L

  /** expo-splash-screen lets no frame draw until this runs. Null when its manager has changed. */
  private val releaseSplashHold: (() -> Unit)? by lazy {
    try {
      val manager = Class.forName("expo.modules.splashscreen.SplashScreenManager")
      val instance = manager.getField("INSTANCE").get(null)
      val hide = manager.getMethod("hide")
      val release: () -> Unit = { hide.invoke(instance) }
      release
    } catch (error: ReflectiveOperationException) {
      Log.w(TAG, "expo-splash-screen's manager changed; no saved Home picture is shown.", error)
      null
    }
  }

  private class Launch(val activity: Activity, val header: LaunchSnapshotHeader) {
    val startedAt = SystemClock.elapsedRealtime()
    var view: View? = null
    var shown = false

    @Volatile
    var leaving = false
  }

  fun install(application: Application) {
    store = LaunchSnapshotStore(File(application.noBackupFilesDir, "launch-snapshot"))
    application.registerActivityLifecycleCallbacks(this)
  }

  /**
   * Saves a picture of the activity's window. The caller knows Home's list is what it shows, and
   * names its rows.
   */
  fun capture(activity: Activity?, rows: String) {
    main.post {
      val store = store
      if (activity == null || activity.javaClass.simpleName != "MainActivity" || store == null) return@post
      // Never a picture of the picture, of the splash, or of a window that is going away.
      if (launch != null || !splashGone() || activity.isDestroyed) return@post
      val decor = activity.window.peekDecorView()
      if (decor != null && decor.isLaidOut && !keyboardShowing(decor)) {
        copyNextFrame(activity, decor, store, rows)
      }
    }
  }

  /**
   * The rows of the picture this launch started on and the launch's age, or null without one.
   * The age counts from the activity's start: Android can have started the process long before,
   * for a notification or another background job.
   */
  fun showing(): Map<String, Any>? {
    val starting = launch?.takeUnless { it.leaving } ?: return null
    return mapOf(
      "rows" to starting.header.rows,
      "sinceLaunchStartMs" to (SystemClock.elapsedRealtime() - starting.startedAt).toDouble()
    )
  }

  /** The real screen is drawn: hand over to it. */
  fun hide() {
    main.post {
      if (handedOverAt == 0L) handedOverAt = SystemClock.uptimeMillis()
      launch?.let(::leave)
    }
  }

  /** Deletes the saved picture, and takes it off the screen when this launch started on it. */
  fun clear() {
    val store = store ?: return
    clears.incrementAndGet()
    files.execute(store::delete)
    // A picture still being decoded then finds its launch gone and is not attached.
    main.post { launch?.let(::drop) }
  }

  override fun onActivityPreCreated(activity: Activity, savedInstanceState: Bundle?) {
    // Only the process's first activity starts cold; later ones find React Native running.
    val first = !launchSeen
    launchSeen = true
    val store = store
    if (!first || store == null) return
    val header = pictureFor(activity, savedInstanceState, store) ?: return
    val starting = Launch(activity, header)
    launch = starting
    val readAt = SystemClock.elapsedRealtime()
    files.execute {
      val picture = store.decode(header)
      val readMs = SystemClock.elapsedRealtime() - readAt
      main.post { attach(starting, picture, readMs) }
    }
    main.postDelayed({ leave(starting) }, starting, SAFETY_TIMEOUT_MS)
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
    if (launch?.activity !== activity || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    // With no app-run exit animation the system removes its splash itself. expo-splash-screen's
    // own fade needs main-thread frames, which a starting app does not have. The activity
    // reports whether it has a listener when it resumes, so this cannot wait for the picture.
    activity.splashScreen.clearOnExitAnimationListener()
  }

  override fun onActivityDestroyed(activity: Activity) {
    launch?.takeIf { it.activity === activity }?.let(::drop)
  }

  /** The saved picture's header, when this launch starts on Home as the picture shows it. */
  private fun pictureFor(
    activity: Activity,
    savedInstanceState: Bundle?,
    store: LaunchSnapshotStore
  ): LaunchSnapshotHeader? {
    if (activity.javaClass.simpleName != "MainActivity") return null
    val intent = activity.intent
    val plain = isPlainLauncherStart(
      restored = savedInstanceState != null,
      action = intent.action,
      launcherCategory = intent.hasCategory(Intent.CATEGORY_LAUNCHER),
      hasData = intent.data != null,
      hasExtras = intent.extras?.isEmpty == false
    )
    val header = if (plain && releaseSplashHold != null) store.readHeader() else null
    val bounds = if (header != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      activity.windowManager.currentWindowMetrics.bounds
    } else {
      null
    }
    if (header == null || header.fits(configOf(activity), bounds?.width(), bounds?.height())) {
      return header
    }
    Log.i(TAG, "The saved Home picture was taken under other settings; deleting it.")
    files.execute(store::delete)
    return null
  }

  private fun attach(starting: Launch, picture: Bitmap?, readMs: Long) {
    // JS can finish, or the activity can go, before the picture is decoded.
    if (launch !== starting) return
    if (picture == null) {
      launch = null
      store?.let { files.execute(it::delete) }
      return
    }
    // Starts the upload to the GPU now, on the render thread, instead of inside the first frame.
    picture.prepareToDraw()
    val view = PictureView(starting.activity, picture) { fits ->
      if (fits) {
        show(starting, readMs)
      } else {
        // A fold or a rotation: the picture is of another window. Layout is running, so leave
        // after it.
        main.post { drop(starting) }
      }
    }
    starting.view = view
    (starting.activity.window.decorView as ViewGroup).addView(
      view,
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    )
  }

  private fun show(starting: Launch, readMs: Long) {
    if (starting.shown) return
    starting.shown = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bars = starting.activity.window.insetsController
      bars?.setSystemBarsAppearance(starting.header.barsAppearance, BARS)
    }
    releaseSplashHold?.invoke()
    val shownMs = sinceProcessStart()
    Log.i(TAG, "Showing the saved Home picture $shownMs ms after process start; read $readMs ms.")
  }

  private fun leave(starting: Launch) {
    if (launch !== starting || starting.leaving) return
    starting.leaving = true
    val view = starting.view
    if (view == null || !starting.shown) {
      drop(starting)
      return
    }
    val askedAt = SystemClock.uptimeMillis()
    whenWindowRests(starting, view) {
      val restMs = SystemClock.uptimeMillis() - askedAt
      val atMs = sinceProcessStart()
      Log.i(TAG, "Handing over to the real screen $atMs ms after process start; rest $restMs ms.")
      view.animate().alpha(0f).setDuration(FADE_MS).withEndAction { drop(starting) }
    }
  }

  private fun whenWindowRests(starting: Launch, view: View, action: () -> Unit) {
    val observer = view.viewTreeObserver
    var drew = false
    val onDraw = ViewTreeObserver.OnDrawListener { drew = true }
    observer.addOnDrawListener(onDraw)
    val limitAt = SystemClock.uptimeMillis() + REST_LIMIT_MS
    var quietFrames = 0

    // Counted in frames: after a busy main thread the clock has moved on but no frame has drawn.
    fun frame() {
      quietFrames = if (drew) 0 else quietFrames + 1
      drew = false
      val rested = quietFrames >= REST_FRAMES || SystemClock.uptimeMillis() >= limitAt
      if (!rested && launch === starting) {
        Choreographer.getInstance().postFrameCallback { frame() }
        return
      }
      if (observer.isAlive) observer.removeOnDrawListener(onDraw)
      if (launch === starting) action()
    }
    frame()
  }

  private fun drop(starting: Launch) {
    if (launch !== starting) return
    launch = null
    main.removeCallbacksAndMessages(starting)
    starting.view?.let { (it.parent as? ViewGroup)?.removeView(it) }
  }

  private fun splashGone(): Boolean =
    handedOverAt != 0L && SystemClock.uptimeMillis() - handedOverAt >= SPLASH_EXIT_MS

  /**
   * Copies the window after it draws its views as they are now. The frame on screen can still
   * hold a view that was removed since, such as the fading splash.
   */
  private fun copyNextFrame(
    activity: Activity,
    decor: View,
    store: LaunchSnapshotStore,
    rows: String
  ) {
    val askedAt = SystemClock.uptimeMillis()
    decor.viewTreeObserver.registerFrameCommitCallback {
      val fresh = SystemClock.uptimeMillis() - askedAt <= FRAME_WAIT_MS
      if (fresh && launch == null && !activity.isDestroyed) copy(activity, decor, store, rows)
    }
    decor.invalidate()
  }

  private fun copy(activity: Activity, decor: View, store: LaunchSnapshotStore, rows: String) {
    val window = activity.window
    val header = LaunchSnapshotHeader(
      configOf(activity),
      width = decor.width,
      height = decor.height,
      barsAppearance = barsOf(window),
      rows = rows
    )
    val picture = Bitmap.createBitmap(decor.width, decor.height, Bitmap.Config.ARGB_8888)
    val clearsBefore = clears.get()
    val save = PixelCopy.OnPixelCopyFinishedListener { result ->
      files.execute {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
        // A clear that came after the copy started must not be undone by this save.
        if (result == PixelCopy.SUCCESS && clearsBefore == clears.get()) {
          store.save(header, picture)
        }
        picture.recycle()
      }
    }
    try {
      PixelCopy.request(window, picture, save, main)
    } catch (_: IllegalArgumentException) {
      // The window has no surface left to copy, as after the activity stops.
      picture.recycle()
    }
  }

  private fun configOf(context: Context): LaunchSnapshotConfig {
    val configuration = context.resources.configuration
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return LaunchSnapshotConfig(
      densityDpi = configuration.densityDpi,
      fontScale = configuration.fontScale,
      nightMode = configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK,
      locales = configuration.locales.toLanguageTags(),
      versionCode = info.longVersionCode,
      lastUpdateTime = info.lastUpdateTime
    )
  }

  private fun keyboardShowing(decor: View): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
      decor.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) == true

  private fun barsOf(window: Window): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      (window.insetsController?.systemBarsAppearance ?: 0) and BARS
    } else {
      0
    }

  private fun sinceProcessStart(): Long =
    SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()

  override fun onActivityStarted(activity: Activity) = Unit

  override fun onActivityResumed(activity: Activity) = Unit

  override fun onActivityPaused(activity: Activity) = Unit

  override fun onActivityStopped(activity: Activity) = Unit

  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

  /** Draws the picture over the whole window and takes every touch until it is removed. */
  @SuppressLint("ViewConstructor")
  private class PictureView(
    context: Context,
    private val picture: Bitmap,
    private val onSized: (fits: Boolean) -> Unit
  ) : View(context) {
    init {
      importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
      // Above the bar backgrounds and whatever else the window adds to its decor view later.
      outlineProvider = null
      translationZ = 10_000f
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) =
      onSized(width == picture.width && height == picture.height)

    override fun onDraw(canvas: Canvas) = canvas.drawBitmap(picture, 0f, 0f, null)

    // The fade then blends the picture itself, with no offscreen layer.
    override fun hasOverlappingRendering() = false

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent) = true

    override fun onGenericMotionEvent(event: MotionEvent) = true
  }
}
