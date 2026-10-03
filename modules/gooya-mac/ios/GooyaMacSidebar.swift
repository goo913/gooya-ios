import UIKit

#if targetEnvironment(macCatalyst)
/// One row of the sidebar (from JavaScript, src/mac/sidebar.ts): a calendar-like row with a tick in its colour, or a
/// link (a list to open) with its symbol and a count.
struct GooyaSidebarRow: Hashable {
  let id: String
  let title: String
  /// "#rrggbb": the tick's colour; none for a link.
  let color: String?
  let checked: Bool
  /// An SF Symbol in a circle of `iconColor`, for a link.
  let icon: String?
  let iconColor: String?
  let count: String?
  /// "category": a category's row (dragged to reorder; right-click: edit, colour, delete).
  let menu: String?
  /// It can be deleted (every category but Tasks).
  let deletable: Bool

  init(_ d: [String: Any]) {
    id = d["id"] as? String ?? ""
    title = d["title"] as? String ?? ""
    color = d["color"] as? String
    checked = d["checked"] as? Bool ?? false
    icon = d["icon"] as? String
    iconColor = d["iconColor"] as? String
    count = d["count"] as? String
    menu = d["menu"] as? String
    deletable = d["deletable"] as? Bool ?? false
  }
}

/// A section's heading: it folds its rows away and back (macOS's sidebar disclosure); Categories' has a + too.
struct GooyaSidebarHeader: Hashable {
  let id: String
  let title: String
  /// A + at its right, to add one (a category).
  let addable: Bool
}

struct GooyaSidebarSection {
  let header: GooyaSidebarHeader
  let rows: [GooyaSidebarRow]

  init(_ d: [String: Any]) {
    header = GooyaSidebarHeader(id: d["id"] as? String ?? "", title: d["title"] as? String ?? "", addable: d["addable"] as? Bool ?? false)
    rows = (d["rows"] as? [[String: Any]] ?? []).map(GooyaSidebarRow.init)
  }
}

enum GooyaSidebarItem: Hashable {
  case header(GooyaSidebarHeader)
  case row(GooyaSidebarRow)
}

/// The sidebar's column, after Apple Calendar's: its calendar list (a heading per account, each calendar with a tick in
/// its colour), then the month at the bottom. A tick shows or hides what it stands for; choosing a link opens it; a
/// day in the month shows that day. A heading folds its section (remembered on this Mac); the categories can be dragged
/// into each person's own order, and right-clicked to edit, recolour or delete one. Each sends `onSidebar` to JavaScript.
final class GooyaMacSidebarController: UIViewController, UICollectionViewDelegate, UICollectionViewDragDelegate, UICollectionViewDropDelegate {
  private var sections: [GooyaSidebarSection] = []
  private var collection: UICollectionView!
  private var source: UICollectionViewDiffableDataSource<String, GooyaSidebarItem>!
  let month = GooyaMiniMonth()
  private static let foldedKey = "GooyaSidebarFolded"
  /// The sections folded away (their ids), as left.
  private var folded = Set(UserDefaults.standard.stringArray(forKey: foldedKey) ?? [])
  /// Apple's colours for a list, as shared/categories.ts has them (CATEGORY_COLORS): the colour menu's palette.
  private static let palette: [(name: String, hex: String)] = [
    ("Red", "#ff3b30"), ("Orange", "#ff9500"), ("Yellow", "#ffcc00"), ("Green", "#34c759"), ("Mint", "#00c7be"), ("Light Blue", "#32ade6"),
    ("Blue", "#007aff"), ("Indigo", "#5856d6"), ("Purple", "#af52de"), ("Pink", "#ff2d55"), ("Brown", "#a2845e"), ("Gray", "#8e8e93"),
  ]

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear

    var config = UICollectionLayoutListConfiguration(appearance: .sidebar)
    config.headerMode = .firstItemInSection
    config.showsSeparators = false
    config.backgroundColor = .clear
    collection = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: config))
    collection.backgroundColor = .clear
    collection.delegate = self
    collection.dragDelegate = self
    collection.dropDelegate = self
    collection.dragInteractionEnabled = true
    collection.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(collection)

    let cell = UICollectionView.CellRegistration<UICollectionViewListCell, GooyaSidebarRow> { [weak self] cell, _, row in
      self?.configure(cell, row)
    }
    let header = UICollectionView.CellRegistration<UICollectionViewListCell, GooyaSidebarHeader> { [weak self] cell, _, header in
      self?.configure(cell, header)
    }
    source = UICollectionViewDiffableDataSource(collectionView: collection) { collection, index, item in
      switch item {
      case .header(let h): return collection.dequeueConfiguredReusableCell(using: header, for: index, item: h)
      case .row(let r): return collection.dequeueConfiguredReusableCell(using: cell, for: index, item: r)
      }
    }
    // A section folded or opened stays so.
    source.sectionSnapshotHandlers.willCollapseItem = { [weak self] item in
      if case .header(let h) = item { self?.setFolded(h.id, true) }
    }
    source.sectionSnapshotHandlers.willExpandItem = { [weak self] item in
      if case .header(let h) = item { self?.setFolded(h.id, false) }
    }

    month.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(month)
    NSLayoutConstraint.activate([
      collection.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      collection.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      collection.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      collection.bottomAnchor.constraint(equalTo: month.topAnchor),
      month.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
      month.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
      month.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -10),
    ])
    apply()
  }

  /// The calendar list JavaScript sends (sections of rows).
  func update(_ data: [[String: Any]]) {
    sections = data.map(GooyaSidebarSection.init)
    if isViewLoaded { apply() }
  }

  private func setFolded(_ id: String, _ isFolded: Bool) {
    if isFolded { folded.insert(id) } else { folded.remove(id) }
    UserDefaults.standard.set(Array(folded), forKey: Self.foldedKey)
  }

  private func apply() {
    var main = NSDiffableDataSourceSnapshot<String, GooyaSidebarItem>()
    main.appendSections(sections.map(\.header.id))
    // Sections that went (an account disconnected) go; the others are filled in below, each with its heading.
    if Set(source.snapshot().sectionIdentifiers) != Set(main.sectionIdentifiers) || source.snapshot().sectionIdentifiers != main.sectionIdentifiers {
      source.apply(main, animatingDifferences: false)
    }
    for section in sections {
      var snap = NSDiffableDataSourceSectionSnapshot<GooyaSidebarItem>()
      let head = GooyaSidebarItem.header(section.header)
      snap.append([head])
      snap.append(section.rows.map { .row($0) }, to: head)
      if !folded.contains(section.header.id) { snap.expand([head]) }
      source.apply(snap, to: section.header.id, animatingDifferences: false)
    }
  }

  private func configure(_ cell: UICollectionViewListCell, _ header: GooyaSidebarHeader) {
    var content = UIListContentConfiguration.sidebarHeader()
    content.text = header.title
    content.textProperties.font = .systemFont(ofSize: 11, weight: .semibold)
    content.textProperties.color = .secondaryLabel
    cell.contentConfiguration = content
    var accessories: [UICellAccessory] = [.outlineDisclosure(options: .init(style: .header))]
    if header.addable {
      let add = GooyaHeaderAdd { [weak self] in self?.send(["type": "add", "id": header.id]) }
      accessories.append(.customView(configuration: .init(customView: add, placement: .trailing(displayed: .always), reservedLayoutWidth: .custom(18))))
    }
    cell.accessories = accessories
  }

  private func configure(_ cell: UICollectionViewListCell, _ row: GooyaSidebarRow) {
    var content = UIListContentConfiguration.sidebarCell()
    content.text = row.title
    content.textProperties.font = .systemFont(ofSize: 13)
    content.textProperties.numberOfLines = 1
    content.textProperties.lineBreakMode = .byTruncatingTail
    content.imageToTextPadding = 7
    if let icon = row.icon {
      content.image = UIImage(systemName: icon, withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .regular))
      content.imageProperties.tintColor = row.iconColor.flatMap(UIColor.init(gooyaHex:)) ?? .secondaryLabel
      content.imageProperties.reservedLayoutSize = CGSize(width: 16, height: 16)
    }
    cell.contentConfiguration = content
    var accessories: [UICellAccessory] = []
    if let color = row.color {
      let tick = GooyaTick(color: UIColor(gooyaHex: color) ?? .systemBlue, checked: row.checked) { [weak self] in
        self?.send(["type": "toggle", "id": row.id])
      }
      accessories.append(.customView(configuration: .init(customView: tick, placement: .leading(), reservedLayoutWidth: .custom(14))))
    }
    if let count = row.count {
      accessories.append(.label(text: count, options: .init(isHidden: false, reservedLayoutWidth: .actual, tintColor: .secondaryLabel, font: .monospacedDigitSystemFont(ofSize: 12, weight: .regular), adjustsFontForContentSizeCategory: false)))
    }
    cell.accessories = accessories
  }

  func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
    guard case .row(let row)? = source.itemIdentifier(for: indexPath) else { return }
    send(["type": "select", "id": row.id])
    // A link opens what it stands for; a calendar row keeps no lasting selection either.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { collectionView.deselectItem(at: indexPath, animated: true) }
  }

  private func send(_ body: [String: Any]) {
    GooyaMacModule.current?.sendEvent("onSidebar", body)
  }

  // MARK: Right-click

  func collectionView(_ collectionView: UICollectionView, contextMenuConfigurationForItemsAt indexPaths: [IndexPath], point: CGPoint) -> UIContextMenuConfiguration? {
    guard let index = indexPaths.first, let item = source.itemIdentifier(for: index) else { return nil }
    let newCategory = UIAction(title: "New Category…", image: UIImage(systemName: "plus")) { [weak self] _ in self?.send(["type": "add", "id": "categories"]) }
    switch item {
    case .header(let h) where h.addable:
      return UIContextMenuConfiguration(actionProvider: { _ in UIMenu(children: [newCategory]) })
    case .row(let row) where row.menu == "category":
      return UIContextMenuConfiguration(actionProvider: { [weak self] _ in self?.categoryMenu(row, newCategory) })
    case .row(let row) where row.color == nil:
      // A list (Library's): open it.
      let open = UIAction(title: "Open “\(row.title)”") { [weak self] _ in self?.send(["type": "select", "id": row.id]) }
      return UIContextMenuConfiguration(actionProvider: { _ in UIMenu(children: [open]) })
    default:
      return nil
    }
  }

  /// A category's menu, as Calendar's for a calendar: edit it, its colour (the palette, or a custom one in its sheet),
  /// a new one, and delete it.
  private func categoryMenu(_ row: GooyaSidebarRow, _ newCategory: UIAction) -> UIMenu {
    let id = String(row.id.dropFirst("category:".count))
    let menu = { [weak self] (action: String, extra: [String: Any]) in
      self?.send((["type": "menu", "action": action, "id": id] as [String: Any]).merging(extra) { a, _ in a })
    }
    let current = row.color?.lowercased()
    let known = Self.palette.contains { $0.hex == current }
    let colors = Self.palette.map { swatch in
      UIAction(title: swatch.name, image: Self.dot(swatch.hex), state: swatch.hex == current ? .on : .off) { _ in menu("color", ["color": swatch.hex]) }
    }
    let edit = UIAction(title: "Edit Category…", image: UIImage(systemName: "pencil")) { _ in menu("edit", [:]) }
    let custom = UIAction(title: "Custom Color…", state: known ? .off : .on) { _ in menu("edit", [:]) }
    let delete = UIAction(title: "Delete Category…", image: UIImage(systemName: "trash"), attributes: row.deletable ? [.destructive] : [.destructive, .disabled]) { _ in menu("delete", [:]) }
    return UIMenu(children: [
      UIMenu(options: .displayInline, children: [edit]),
      UIMenu(options: .displayInline, children: [UIMenu(options: [.displayInline, .displayAsPalette], children: colors), custom]),
      UIMenu(options: .displayInline, children: [newCategory]),
      UIMenu(options: .displayInline, children: [delete]),
    ])
  }

  private static func dot(_ hex: String) -> UIImage? {
    UIImage(systemName: "circle.fill")?.withTintColor(UIColor(gooyaHex: hex) ?? .gray, renderingMode: .alwaysOriginal)
  }

  // MARK: Dragging the categories into an order

  /// The categories' rows' ids (category:…), as shown.
  private func categoryIds() -> [String] {
    guard source.snapshot().sectionIdentifiers.contains("categories") else { return [] }
    return source.snapshot(for: "categories").items.compactMap { item in
      if case .row(let r) = item, r.menu == "category" { return r.id }
      return nil
    }
  }

  func collectionView(_ collectionView: UICollectionView, itemsForBeginning session: UIDragSession, at indexPath: IndexPath) -> [UIDragItem] {
    guard case .row(let row)? = source.itemIdentifier(for: indexPath), row.menu == "category" else { return [] }
    let item = UIDragItem(itemProvider: NSItemProvider(object: row.title as NSString))
    item.localObject = row.id
    return [item]
  }

  func collectionView(_ collectionView: UICollectionView, dropSessionDidUpdate session: UIDropSession, withDestinationIndexPath destination: IndexPath?) -> UICollectionViewDropProposal {
    // Only a category, only among the categories (under their heading).
    guard session.localDragSession != nil, let destination, source.snapshot().sectionIdentifiers[safe: destination.section] == "categories", destination.item >= 1 else {
      return UICollectionViewDropProposal(operation: .forbidden)
    }
    return UICollectionViewDropProposal(operation: .move, intent: .insertAtDestinationIndexPath)
  }

  func collectionView(_ collectionView: UICollectionView, performDropWith coordinator: UICollectionViewDropCoordinator) {
    guard let drop = coordinator.items.first, let id = drop.dragItem.localObject as? String, let destination = coordinator.destinationIndexPath else { return }
    var ids = categoryIds()
    guard ids.contains(id) else { return }
    ids.removeAll { $0 == id }
    // Item 0 is the heading.
    ids.insert(id, at: max(0, min(ids.count, destination.item - 1)))
    if let section = sections.firstIndex(where: { $0.header.id == "categories" }) {
      let rows = sections[section].rows
      let byId = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
      let reordered = ids.compactMap { byId[$0] } + rows.filter { $0.menu != "category" }
      sections[section] = GooyaSidebarSection(header: sections[section].header, rows: reordered)
      apply()
    }
    send(["type": "order", "ids": ids.map { String($0.dropFirst("category:".count)) }])
  }
}

extension GooyaSidebarSection {
  init(header: GooyaSidebarHeader, rows: [GooyaSidebarRow]) {
    self.header = header
    self.rows = rows
  }
}

/// The + by a heading (Categories: a new one): a grey symbol the size of the heading's disclosure arrow, as the arrow is.
/// Not a button: macOS draws a button's symbol in the app's accent colour (Calendar's red).
final class GooyaHeaderAdd: UIControl {
  private let action: () -> Void

  init(action: @escaping () -> Void) {
    self.action = action
    super.init(frame: CGRect(x: 0, y: 0, width: 18, height: 18))
    let symbol = UIImageView(image: UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold)))
    symbol.tintColor = .secondaryLabel
    symbol.contentMode = .center
    symbol.frame = bounds
    symbol.isUserInteractionEnabled = false
    addSubview(symbol)
    addTarget(self, action: #selector(tapped), for: .touchUpInside)
    toolTip = "New Category"
    isAccessibilityElement = true
    accessibilityLabel = "New Category"
    accessibilityTraits = .button
  }

  required init?(coder: NSCoder) { fatalError() }

  override var intrinsicContentSize: CGSize { CGSize(width: 18, height: 18) }

  @objc private func tapped() { action() }
}

/// A calendar's tick, as macOS draws it in Calendar's list: a rounded square in the calendar's colour, with a white
/// check when it is shown; grey while the window is in the background.
final class GooyaTick: UIControl {
  private let color: UIColor
  private let checked: Bool
  private let action: () -> Void
  private let check = UIImageView()

  init(color: UIColor, checked: Bool, action: @escaping () -> Void) {
    self.color = color
    self.checked = checked
    self.action = action
    super.init(frame: CGRect(x: 0, y: 0, width: 14, height: 14))
    layer.cornerRadius = 3.5
    layer.cornerCurve = .continuous
    check.image = UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 8.5, weight: .heavy))
    check.tintColor = .white
    check.contentMode = .center
    check.frame = bounds
    check.isHidden = !checked
    check.isUserInteractionEnabled = false
    addSubview(check)
    addTarget(self, action: #selector(tapped), for: .touchUpInside)
    registerForTraitChanges([UITraitActiveAppearance.self]) { (tick: GooyaTick, _: UITraitCollection) in tick.paint() }
    paint()
  }

  required init?(coder: NSCoder) { fatalError() }

  override var intrinsicContentSize: CGSize { CGSize(width: 14, height: 14) }

  private func paint() {
    let active = traitCollection.activeAppearance != .inactive
    backgroundColor = active ? color : UIColor { t in t.userInterfaceStyle == .dark ? UIColor(white: 0.42, alpha: 1) : UIColor(white: 0.79, alpha: 1) }
  }

  @objc private func tapped() { action() }
}

/// The month at the bottom of the sidebar: ‹ October 2026 ›, the weekdays' letters and six weeks; today in a red
/// circle (grey while the window is in the background), the days of the months around it fainter. A day shows it.
final class GooyaMiniMonth: UIView {
  private var today = ""
  /// The month shown, "YYYY-MM" (its arrows go a month back or on).
  private var shown = ""
  private let title = UILabel()
  private let grid = UIStackView()
  private var dayLabels: [GooyaDayLabel] = []
  private var dayKeys: [String] = []
  private let rule = UIView()

  override init(frame: CGRect) {
    super.init(frame: frame)
    rule.backgroundColor = .separator
    rule.translatesAutoresizingMaskIntoConstraints = false
    addSubview(rule)

    title.font = .systemFont(ofSize: 13)
    title.textColor = .label
    title.textAlignment = .center
    let back = arrow("chevron.left") { [weak self] in self?.step(-1) }
    let next = arrow("chevron.right") { [weak self] in self?.step(1) }
    let head = UIStackView(arrangedSubviews: [back, title, next])
    head.distribution = .fill
    head.alignment = .center
    head.translatesAutoresizingMaskIntoConstraints = false
    addSubview(head)

    grid.axis = .vertical
    grid.distribution = .fillEqually
    grid.translatesAutoresizingMaskIntoConstraints = false
    addSubview(grid)
    let letters = UIStackView(arrangedSubviews: ["S", "M", "T", "W", "T", "F", "S"].map { l in
      let label = UILabel()
      label.text = l
      label.font = .systemFont(ofSize: 10, weight: .medium)
      label.textColor = .secondaryLabel
      label.textAlignment = .center
      return label
    })
    letters.distribution = .fillEqually
    grid.addArrangedSubview(letters)
    for _ in 0..<6 {
      let week = UIStackView()
      week.distribution = .fillEqually
      for _ in 0..<7 {
        let label = GooyaDayLabel()
        label.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        label.textAlignment = .center
        label.isUserInteractionEnabled = true
        label.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(pick(_:))))
        dayLabels.append(label)
        week.addArrangedSubview(label)
      }
      grid.addArrangedSubview(week)
    }
    NSLayoutConstraint.activate([
      rule.topAnchor.constraint(equalTo: topAnchor),
      rule.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4),
      rule.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
      rule.heightAnchor.constraint(equalToConstant: 1),
      head.topAnchor.constraint(equalTo: rule.bottomAnchor, constant: 12),
      head.leadingAnchor.constraint(equalTo: leadingAnchor),
      head.trailingAnchor.constraint(equalTo: trailingAnchor),
      head.heightAnchor.constraint(equalToConstant: 22),
      back.widthAnchor.constraint(equalToConstant: 22),
      next.widthAnchor.constraint(equalToConstant: 22),
      grid.topAnchor.constraint(equalTo: head.bottomAnchor, constant: 8),
      grid.leadingAnchor.constraint(equalTo: leadingAnchor),
      grid.trailingAnchor.constraint(equalTo: trailingAnchor),
      grid.bottomAnchor.constraint(equalTo: bottomAnchor),
      grid.heightAnchor.constraint(equalToConstant: 7 * 23),
    ])
    registerForTraitChanges([UITraitActiveAppearance.self]) { (view: GooyaMiniMonth, _: UITraitCollection) in view.render() }
  }

  required init?(coder: NSCoder) { fatalError() }

  private func arrow(_ symbol: String, _ action: @escaping () -> Void) -> UIButton {
    var config = UIButton.Configuration.plain()
    config.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .medium))
    config.baseForegroundColor = .secondaryLabel
    config.contentInsets = .zero
    return UIButton(configuration: config, primaryAction: UIAction { _ in action() })
  }

  /// Today ("YYYY-MM-DD"); the month shown follows it until an arrow is used.
  func set(today: String) {
    if shown.isEmpty || self.today.prefix(7) == shown { shown = String(today.prefix(7)) }
    self.today = today
    render()
  }

  private func step(_ months: Int) {
    let parts = shown.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return }
    let m0 = parts[0] * 12 + parts[1] - 1 + months
    shown = String(format: "%04d-%02d", m0 / 12, m0 % 12 + 1)
    render()
  }

  private func render() {
    let parts = shown.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    guard let first = cal.date(from: DateComponents(year: parts[0], month: parts[1], day: 1)) else { return }
    let names = DateFormatter().standaloneMonthSymbols ?? []
    title.text = "\(names[safe: parts[1] - 1] ?? "") \(parts[0])"
    let lead = cal.component(.weekday, from: first) - 1
    dayKeys = []
    for (i, label) in dayLabels.enumerated() {
      let date = cal.date(byAdding: .day, value: i - lead, to: first)!
      let c = cal.dateComponents([.year, .month, .day], from: date)
      let key = String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
      dayKeys.append(key)
      label.text = "\(c.day!)"
      let isToday = key == today
      let inMonth = c.month == parts[1]
      label.mark = isToday ? .systemRed : nil
      label.textColor = isToday ? .white : inMonth ? .label : .tertiaryLabel
      label.font = .monospacedDigitSystemFont(ofSize: 11, weight: isToday ? .semibold : .regular)
    }
  }

  @objc private func pick(_ tap: UITapGestureRecognizer) {
    guard let label = tap.view as? GooyaDayLabel, let i = dayLabels.firstIndex(of: label), dayKeys.indices.contains(i) else { return }
    GooyaMacModule.current?.sendEvent("onSidebar", ["type": "date", "date": dayKeys[i]])
  }
}

/// A day's number in the sidebar's month, on a circle when it is today.
final class GooyaDayLabel: UILabel {
  var mark: UIColor? { didSet { setNeedsDisplay() } }

  override func draw(_ rect: CGRect) {
    if let mark {
      let d: CGFloat = 18
      mark.setFill()
      UIBezierPath(ovalIn: CGRect(x: rect.midX - d / 2, y: rect.midY - d / 2, width: d, height: d)).fill()
    }
    super.draw(rect)
  }
}

extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

extension UIColor {
  /// "#rrggbb" (or "#rrggbbaa").
  convenience init?(gooyaHex: String) {
    var text = gooyaHex.trimmingCharacters(in: .whitespaces)
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6 || text.count == 8, let value = UInt64(text, radix: 16) else { return nil }
    let rgb = text.count == 8 ? value >> 8 : value
    let alpha = text.count == 8 ? CGFloat(value & 0xff) / 255 : 1
    self.init(red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: alpha)
  }
}
#endif
