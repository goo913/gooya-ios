import UIKit

#if targetEnvironment(macCatalyst)
/// GOOYA's Settings window, as Apple Calendar's: a window of its own (GOOYA → Settings… ⌘, or the gear over the
/// sidebar) with its tabs in its toolbar (General · Accounts · Alerts · Advanced), titled by the tab shown, the size
/// of the tab's content and not resizable. The content is React Native's (src/mac/settings, registered as
/// "GooyaSettings"): it gets the tab as a property and gives the window its size (`setSize`).
public enum GooyaMacSettings {
  static let activityType = "com.hybertec.gooya.settings"
  static let tabs: [(id: String, title: String, symbol: String)] = [
    ("general", "General", "gearshape"),
    ("accounts", "Accounts", "at"),
    ("alerts", "Alerts", "bell"),
    ("advanced", "Advanced", "gearshape.2"),
  ]
  /// The app delegate's React Native factory, for the window's content (plugins/withMac.js).
  public static var factory: NSObject?
  private static let tabKey = "GooyaSettingsTab"
  private static let sizesKey = "GooyaSettingsSizes"
  private static let originKey = "GooyaSettingsOrigin"
  /// The tab shown, as when Settings last closed.
  static var tab: String = {
    let saved = UserDefaults.standard.string(forKey: tabKey) ?? ""
    return tabs.contains { $0.id == saved } ? saved : "general"
  }()
  static weak var scene: UIWindowScene?
  static weak var content: UIView?
  /// When the window was last asked for, so a second ⌘, before it is there doesn't make a second window.
  private static var requested = Date.distantPast
  /// Each tab's content size, from its content, so a tab opens at its size.
  private static var sizes: [String: CGSize] = {
    let saved = UserDefaults.standard.dictionary(forKey: sizesKey) as? [String: [Double]] ?? [:]
    return saved.compactMapValues { $0.count == 2 ? CGSize(width: $0[0], height: $0[1]) : nil }
  }()

  /// Whether a scene is the Settings window's.
  public static func isSettings(_ scene: UIScene) -> Bool {
    scene.delegate is GooyaSettingsSceneDelegate || scene.session.configuration.name == "Settings"
  }

  /// GOOYA's own window (the calendar's), if it is open.
  static func mainScene() -> UIWindowScene? {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { !isSettings($0) }
  }

  /// That window itself (not a sheet's window over it).
  static func mainWindow() -> UIWindow? {
    guard let main = mainScene() else { return nil }
    if let delegate = main.delegate as? UIWindowSceneDelegate, let window = delegate.window, let window { return window }
    return main.windows.first
  }

  /// The configuration of a window about to open: the Settings window's when it is the one asked for (or one the Mac
  /// brings back from before GOOYA quit), else the app's (Info.plist's).
  public static func configuration(for session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let settings = options.userActivities.contains { $0.activityType == activityType } || (session.userInfo?["gooya"] as? String) == "settings"
    guard settings else { return UISceneConfiguration(name: "Default Configuration", sessionRole: session.role) }
    let configuration = UISceneConfiguration(name: "Settings", sessionRole: session.role)
    configuration.delegateClass = GooyaSettingsSceneDelegate.self
    return configuration
  }

  /// Opens the window, or brings it forward, at `tab` when one is given.
  public static func open(_ tab: String? = nil) {
    if let tab { select(tab) }
    if let scene, scene.activationState != .unattached {
      UIApplication.shared.activateSceneSession(for: UISceneSessionActivationRequest(session: scene.session)) { error in
        NSLog("GOOYA: Settings could not come forward: \(error.localizedDescription)")
      }
      return
    }
    guard Date().timeIntervalSince(requested) > 2 else { return }
    requested = Date()
    var request = UISceneSessionActivationRequest(role: .windowApplication)
    request.userActivity = NSUserActivity(activityType: activityType)
    let options = UIScene.ActivationRequestOptions()
    options.requestingScene = mainScene()
    request.options = options
    UIApplication.shared.activateSceneSession(for: request) { error in
      requested = .distantPast
      NSLog("GOOYA: Settings could not open: \(error.localizedDescription)")
    }
  }

  public static func close() {
    guard let scene else { return }
    UIApplication.shared.requestSceneSessionDestruction(scene.session, options: nil)
  }

  /// Brings GOOYA's window in front of Settings (after a button in Settings opened something there).
  public static func showMain() {
    guard let main = mainScene() else { return GooyaMacWindow.bringForward() }
    UIApplication.shared.activateSceneSession(for: UISceneSessionActivationRequest(session: main.session)) { _ in }
  }

  /// Shows a tab: the window's title, the toolbar's selection, the content and the window's size follow.
  static func select(_ id: String) {
    guard let entry = tabs.first(where: { $0.id == id }) else { return }
    tab = id
    UserDefaults.standard.set(id, forKey: tabKey)
    guard let scene else { return }
    scene.title = entry.title
    if let toolbar = scene.titlebar?.toolbar, toolbar.selectedItemIdentifier?.rawValue != id {
      toolbar.selectedItemIdentifier = NSToolbarItem.Identifier(id)
    }
    if let content { GooyaSurface.setProperties(["tab": id], of: content) }
    fit()
  }

  /// A tab's content size (from JavaScript, once it has laid it out).
  public static func setSize(_ size: CGSize, for id: String) {
    guard size.width > 0, size.height > 0 else { return }
    if sizes[id] != size {
      sizes[id] = size
      UserDefaults.standard.set(sizes.mapValues { [Double($0.width), Double($0.height)] }, forKey: sizesKey)
    }
    if id == tab { fit() }
  }

  /// The window takes the tab's size (below its title bar and toolbar), keeping its top left corner where it is.
  static func fit() {
    guard let scene, let window = scene.windows.first else { return }
    let content = sizes[tab] ?? CGSize(width: 540, height: 400)
    let size = CGSize(width: content.width, height: content.height + window.safeAreaInsets.top)
    scene.sizeRestrictions?.minimumSize = size
    scene.sizeRestrictions?.maximumSize = size
    let frame = scene.effectiveGeometry.systemFrame
    guard frame.size != size else { return }
    scene.requestGeometryUpdate(.Mac(systemFrame: CGRect(origin: frame.origin, size: size))) { _ in }
  }

  static func connect(_ scene: UIWindowScene, _ window: UIWindow) {
    GooyaWindowSize.install()
    self.scene = scene
    requested = .distantPast
    scene.title = tabs.first { $0.id == tab }?.title ?? "Settings"
    // Links and the widget's days are for GOOYA's window, never this one.
    scene.activationConditions.canActivateForTargetContentIdentifierPredicate = NSPredicate(value: false)
    scene.activationConditions.prefersToActivateForTargetContentIdentifierPredicate = NSPredicate(value: false)
    if let titlebar = scene.titlebar {
      titlebar.titleVisibility = .visible
      titlebar.toolbarStyle = .preference
      titlebar.toolbar = GooyaSettingsToolbar.shared.make()
    }
    scene.sizeRestrictions?.allowsFullScreen = false
    // Light or dark as GOOYA's window is (Settings → Appearance).
    if let main = mainWindow() { window.overrideUserInterfaceStyle = main.overrideUserInterfaceStyle }
    window.rootViewController = GooyaSettingsController()
    place(scene)
  }

  static func disconnect(_ scene: UIWindowScene) {
    guard scene == self.scene else { return }
    let origin = scene.effectiveGeometry.systemFrame.origin
    UserDefaults.standard.set([Double(origin.x), Double(origin.y)], forKey: originKey)
    self.scene = nil
  }

  /// Where it was last, else in the middle of the screen, a little above centre (as the Mac places Settings).
  private static func place(_ scene: UIWindowScene) {
    let content = sizes[tab] ?? CGSize(width: 540, height: 400)
    let size = CGSize(width: content.width, height: content.height + 80)
    let screen = scene.screen.bounds
    var origin = CGPoint(x: screen.midX - size.width / 2, y: screen.minY + max(40, (screen.height - size.height) / 3))
    if let saved = UserDefaults.standard.array(forKey: originKey) as? [Double], saved.count == 2 {
      origin = CGPoint(x: saved[0], y: saved[1])
    }
    scene.sizeRestrictions?.minimumSize = size
    scene.sizeRestrictions?.maximumSize = size
    scene.requestGeometryUpdate(.Mac(systemFrame: CGRect(origin: origin, size: size))) { _ in }
  }
}

/// React Native gives JavaScript one window size (`Dimensions`), the key window's: with Settings in front, GOOYA's
/// calendar would be laid out for the Settings window (an iPhone's screens). On the Mac it is always GOOYA's window's.
enum GooyaWindowSize {
  private static var installed = false

  static func install() {
    guard !installed, let cls = NSClassFromString("RCTDeviceInfo") else { return }
    let selector = NSSelectorFromString("_exportedDimensions")
    guard let method = class_getInstanceMethod(cls, selector) else { return }
    installed = true
    typealias Exported = @convention(c) (AnyObject, Selector) -> NSDictionary
    let original = unsafeBitCast(method_getImplementation(method), to: Exported.self)
    let replacement: @convention(block) (AnyObject) -> NSDictionary = { info in
      let dimensions = original(info, selector)
      guard let main = GooyaMacSettings.mainWindow(), var window = dimensions["window"] as? [String: Any] else { return dimensions }
      window["width"] = main.bounds.width
      window["height"] = main.bounds.height
      let result = NSMutableDictionary(dictionary: dimensions)
      result["window"] = window
      return result
    }
    method_setImplementation(method, imp_implementationWithBlock(replacement))
  }
}

/// The Settings window's scene: React Native's content under the toolbar.
final class GooyaSettingsSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    // A Settings window the Mac would bring back from before GOOYA quit stays closed: Settings opens when asked for.
    // So is a second one (Settings is one window).
    let asked = connectionOptions.userActivities.contains { $0.activityType == GooyaMacSettings.activityType }
    if !asked || GooyaMacSettings.scene.map({ $0 != scene && $0.activationState != .unattached }) == true {
      UIApplication.shared.requestSceneSessionDestruction(session, options: nil)
      return
    }
    session.userInfo = ["gooya": "settings"]
    let window = UIWindow(windowScene: scene)
    self.window = window
    GooyaMacSettings.connect(scene, window)
    window.makeKeyAndVisible()
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    if let scene = scene as? UIWindowScene { GooyaMacSettings.disconnect(scene) }
    window = nil
  }

  // A link that comes here anyway (it shouldn't: see the activation conditions) is GOOYA's window's.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let main = GooyaMacSettings.mainScene() else { return }
    main.delegate?.scene?(main, openURLContexts: URLContexts)
  }
}

/// The window's content: React Native's view below the title bar and toolbar, made once React Native is running.
final class GooyaSettingsController: UIViewController {
  private var tries = 0

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    attach()
  }

  override func viewSafeAreaInsetsDidChange() {
    super.viewSafeAreaInsetsDidChange()
    GooyaMacSettings.fit()
  }

  private func attach() {
    guard let factory = GooyaMacSettings.factory,
      let content = GooyaSurface.view(withFactory: factory, moduleName: "GooyaSettings", properties: ["tab": GooyaMacSettings.tab])
    else {
      tries += 1
      if tries < 80 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.attach() } }
      return
    }
    content.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(content)
    NSLayoutConstraint.activate([
      content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      content.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    GooyaMacSettings.content = content
  }
}

/// The tabs in the Settings window's toolbar (the Mac's Settings style: icons over their names, the one shown
/// highlighted).
final class GooyaSettingsToolbar: NSObject, NSToolbarDelegate {
  static let shared = GooyaSettingsToolbar()
  private var ids: [NSToolbarItem.Identifier] { GooyaMacSettings.tabs.map { NSToolbarItem.Identifier($0.id) } }

  func make() -> NSToolbar {
    let toolbar = NSToolbar(identifier: "GooyaSettings")
    toolbar.delegate = self
    toolbar.displayMode = .iconAndLabel
    toolbar.allowsUserCustomization = false
    toolbar.selectedItemIdentifier = NSToolbarItem.Identifier(GooyaMacSettings.tab)
    return toolbar
  }

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { ids }
  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { ids }
  func toolbarSelectableItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { ids }

  func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
    guard let tab = GooyaMacSettings.tabs.first(where: { $0.id == id.rawValue }) else { return nil }
    let item = NSToolbarItem(itemIdentifier: id)
    item.image = UIImage(systemName: tab.symbol)
    item.label = tab.title
    item.target = self
    item.action = #selector(pick(_:))
    return item
  }

  @objc private func pick(_ item: NSToolbarItem) {
    GooyaMacSettings.select(item.itemIdentifier.rawValue)
  }
}
#endif
