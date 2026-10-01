import UIKit

/// What the app delegate implements for GOOYA's menu commands (app.config.ts adds it: plugins/withMac.ts).
@objc public protocol GooyaMacCommandTarget {
  func gooyaCommand(_ command: UICommand)
}

/// GOOYA's menus in the Mac's menu bar, after Apple Calendar's: Settings… in the GOOYA menu, New Task / Schedule /
/// Routine in File, Search in Edit, and Day · Week · Month · Year, the sidebar, Today, Next and Previous in View, with
/// Calendar's keyboard shortcuts. A command goes to JavaScript as `onCommand` with its id (modules/gooya-mac/index.ts).
public enum GooyaMacMenu {
  /// The view shown and whether the sidebar is, for the View menu's check mark and Show/Hide Sidebar (from JavaScript).
  public static var view = "month"
  public static var sidebar = true

  public static func build(_ builder: UIMenuBuilder) {
    guard builder.system == .main else { return }
    // Font and text formatting, toolbar customizing, a second window and document commands are not GOOYA's.
    builder.remove(menu: .format)
    builder.remove(menu: .toolbar)
    builder.remove(menu: .newScene)
    builder.remove(menu: .document)

    builder.insertSibling(UIMenu(options: .displayInline, children: [command("Settings…", ",", [.command], "settings")]), afterMenu: .about)

    builder.insertChild(
      UIMenu(options: .displayInline, children: [
        command("New Task", "n", [.command], "new.task"),
        command("New Schedule", "n", [.command, .alternate], "new.schedule"),
        command("New Routine", "n", [.command, .shift], "new.routine"),
      ]),
      atStartOfMenu: .file
    )

    builder.replace(menu: .find, with: UIMenu(options: .displayInline, children: [command("Search", "f", [.command], "search")]))

    // Inserted at the start of View, last first.
    builder.insertChild(
      UIMenu(options: .displayInline, children: [
        command("Go to Today", "t", [.command], "today"),
        command("Next", UIKeyCommand.inputRightArrow, [.command], "next"),
        command("Previous", UIKeyCommand.inputLeftArrow, [.command], "previous"),
      ]),
      atStartOfMenu: .view
    )
    builder.insertChild(UIMenu(options: .displayInline, children: [command("Hide Sidebar", "s", [.command, .control], "sidebar")]), atStartOfMenu: .view)
    builder.insertChild(
      UIMenu(options: .displayInline, children: [
        command("Day", "1", [.command], "view.day"),
        command("Week", "2", [.command], "view.week"),
        command("Month", "3", [.command], "view.month"),
        command("Year", "4", [.command], "view.year"),
      ]),
      atStartOfMenu: .view
    )
  }

  /// Ticks the view shown and names the sidebar command for what it will do.
  public static func validate(_ command: UICommand) {
    guard let id = command.propertyList as? String else { return }
    if id.hasPrefix("view.") { command.state = id == "view.\(view)" ? .on : .off }
    if id == "sidebar" { command.title = sidebar ? "Hide Sidebar" : "Show Sidebar" }
  }

  public static func perform(_ command: UICommand) {
    guard let id = command.propertyList as? String else { return }
    GooyaMacModule.current?.sendEvent("onCommand", ["id": id])
  }

  private static func command(_ title: String, _ input: String, _ flags: UIKeyModifierFlags, _ id: String) -> UIKeyCommand {
    UIKeyCommand(title: title, action: #selector(GooyaMacCommandTarget.gooyaCommand(_:)), input: input, modifierFlags: flags, propertyList: id)
  }
}
