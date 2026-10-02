import UIKit

/// What the app delegate implements for GOOYA's menu commands (app.config.ts adds it: plugins/withMac.js).
@objc public protocol GooyaMacCommandTarget {
  func gooyaCommand(_ command: UICommand)
}

/// GOOYA's menus in the Mac's menu bar, as Apple Calendar's are: Settings… and Accounts… in the GOOYA menu; New Schedule or Task, New
/// Routine and New Category in File; Search in Edit; By Day · By Week · By Month · By Year, Next and Previous, Go to
/// Today, Zoom In and Out (what is on the calendar only) and Show or Hide Calendar List in View, with Calendar's
/// keyboard shortcuts. A command goes to JavaScript as `onCommand` with its id (modules/gooya-mac/index.ts).
public enum GooyaMacMenu {
  /// The view shown and whether the sidebar is, for the View menu's check mark and Show/Hide Calendar List.
  public static var view = "month"
  public static var sidebar = true
  /// Escape is JavaScript's while something can be cancelled with it (a drag, a new item's popover).
  public static var escape = false

  public static func build(_ builder: UIMenuBuilder) {
    guard builder.system == .main else { return }
    // Font and text formatting, toolbar customizing, a second window and document commands are not GOOYA's.
    builder.remove(menu: .format)
    builder.remove(menu: .toolbar)
    builder.remove(menu: .newScene)
    builder.remove(menu: .document)
    // The split view's own Show Sidebar (⌃⌘S): Calendar's is Show or Hide Calendar List, as GOOYA's is.
    builder.remove(menu: .sidebar)

    builder.insertSibling(UIMenu(options: .displayInline, children: [command("Settings…", ",", [.command], "settings"), plain("Accounts…", "accounts")]), afterMenu: .about)

    builder.insertChild(
      UIMenu(options: .displayInline, children: [
        command("New Schedule or Task", "n", [.command], "new"),
        command("New Routine", "n", [.command, .shift], "new.routine"),
        command("New Category", "n", [.command, .alternate], "new.category"),
      ]),
      atStartOfMenu: .file
    )

    builder.replace(menu: .find, with: UIMenu(options: .displayInline, children: [command("Search", "f", [.command], "search")]))

    // Inserted at the start of View, last first.
    builder.insertChild(UIMenu(options: .displayInline, children: [plain("Hide Calendar List", "sidebar")]), atStartOfMenu: .view)
    builder.insertChild(
      UIMenu(options: .displayInline, children: [
        command("Zoom In", "+", [.command], "zoom.in"),
        command("Zoom Out", "-", [.command], "zoom.out"),
      ]),
      atStartOfMenu: .view
    )
    builder.insertChild(UIMenu(options: .displayInline, children: [command("Go to Today", "t", [.command], "today")]), atStartOfMenu: .view)
    builder.insertChild(
      UIMenu(options: .displayInline, children: [
        command("Next", UIKeyCommand.inputRightArrow, [.command], "next"),
        command("Previous", UIKeyCommand.inputLeftArrow, [.command], "previous"),
      ]),
      atStartOfMenu: .view
    )
    builder.insertChild(
      UIMenu(options: .displayInline, children: [
        command("By Day", "1", [.command], "view.day"),
        command("By Week", "2", [.command], "view.week"),
        command("By Month", "3", [.command], "view.month"),
        command("By Year", "4", [.command], "view.year"),
      ]),
      atStartOfMenu: .view
    )
  }

  /// Ticks the view shown and names the sidebar command for what it will do.
  public static func validate(_ command: UICommand) {
    guard let id = command.propertyList as? String else { return }
    if id.hasPrefix("view.") { command.state = id == "view.\(view)" ? .on : .off }
    if id == "sidebar" { command.title = sidebar ? "Hide Calendar List" : "Show Calendar List" }
  }

  public static func perform(_ command: UICommand) {
    guard let id = command.propertyList as? String else { return }
    #if targetEnvironment(macCatalyst)
    if id == "sidebar" {
      GooyaMacSplit.toggle()
      return
    }
    #endif
    GooyaMacModule.current?.sendEvent("onCommand", ["id": id])
  }

  /// Keys outside the menus, from the app delegate's key commands: ⌘= for Zoom In (the + key without Shift, as
  /// Calendar takes it), and Escape while JavaScript wants it.
  public static func keyCommands() -> [UIKeyCommand] {
    var keys = [UIKeyCommand(title: "", action: #selector(GooyaMacCommandTarget.gooyaCommand(_:)), input: "=", modifierFlags: [.command], propertyList: "zoom.in")]
    if escape {
      let esc = UIKeyCommand(title: "", action: #selector(GooyaMacCommandTarget.gooyaCommand(_:)), input: UIKeyCommand.inputEscape, modifierFlags: [], propertyList: "escape")
      esc.wantsPriorityOverSystemBehavior = true
      keys.append(esc)
    }
    return keys
  }

  private static func command(_ title: String, _ input: String, _ flags: UIKeyModifierFlags, _ id: String) -> UIKeyCommand {
    UIKeyCommand(title: title, action: #selector(GooyaMacCommandTarget.gooyaCommand(_:)), input: input, modifierFlags: flags, propertyList: id)
  }

  private static func plain(_ title: String, _ id: String) -> UICommand {
    UICommand(title: title, action: #selector(GooyaMacCommandTarget.gooyaCommand(_:)), propertyList: id)
  }
}
