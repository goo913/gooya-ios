import UIKit

/// GOOYA's window on the Mac: no title in the title bar, Apple Calendar's toolbar in it while the calendar shows
/// (GooyaMacToolbar; not over signing in), at least 720 × 560 points, and about Calendar's size the first time it opens.
enum GooyaMacWindow {
  private static var observing = false
  /// The calendar is showing (from JavaScript): the window has its toolbar.
  static var toolbar = false

  static func start() {
    #if targetEnvironment(macCatalyst)
    for case let scene as UIWindowScene in UIApplication.shared.connectedScenes where !GooyaMacSettings.isSettings(scene) { setUp(scene) }
    guard !observing else { return }
    observing = true
    NotificationCenter.default.addObserver(forName: UIScene.willConnectNotification, object: nil, queue: .main) { note in
      if let scene = note.object as? UIWindowScene, !GooyaMacSettings.isSettings(scene) { setUp(scene) }
    }
    #endif
  }

  static func setUp(_ scene: UIWindowScene) {
    #if targetEnvironment(macCatalyst)
    scene.title = "GOOYA"
    if let titlebar = scene.titlebar {
      titlebar.titleVisibility = .hidden
      titlebar.separatorStyle = .none
      titlebar.toolbarStyle = .unified
      // GOOYA's toolbar replaces any other (a development build's launcher has its own).
      if toolbar, titlebar.toolbar?.identifier != "GOOYA" { titlebar.toolbar = GooyaMacToolbar.shared.make() }
      if !toolbar, titlebar.toolbar != nil { titlebar.toolbar = nil }
    }
    scene.sizeRestrictions?.minimumSize = CGSize(width: 720, height: 560)
    // The first time: about Apple Calendar's window, in the middle of the screen. Later the Mac remembers it.
    let key = "GooyaMacWindowSized"
    if !UserDefaults.standard.bool(forKey: key) {
      UserDefaults.standard.set(true, forKey: key)
      let screen = scene.screen.bounds
      let size = CGSize(width: min(1300, screen.width - 80), height: min(980, screen.height - 80))
      let frame = CGRect(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2, width: size.width, height: size.height)
      scene.requestGeometryUpdate(.Mac(systemFrame: frame)) { _ in }
    }
    #endif
  }

  /// Shows or hides the toolbar (the calendar shows or not).
  static func setToolbar(_ shown: Bool) {
    toolbar = shown
    start()
  }

  /// Brings GOOYA forward, opening its window again if it was closed.
  static func bringForward() {
    #if targetEnvironment(macCatalyst)
    GooyaStatusItem.activateApp()
    let hasWindow = UIApplication.shared.connectedScenes.contains { $0.activationState != .unattached && $0 is UIWindowScene && !GooyaMacSettings.isSettings($0) }
    if !hasWindow {
      UIApplication.shared.requestSceneSessionActivation(nil, userActivity: nil, options: nil, errorHandler: nil)
    }
    #endif
  }
}
