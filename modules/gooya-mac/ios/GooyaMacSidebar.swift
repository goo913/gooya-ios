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

  init(_ d: [String: Any]) {
    id = d["id"] as? String ?? ""
    title = d["title"] as? String ?? ""
    color = d["color"] as? String
    checked = d["checked"] as? Bool ?? false
    icon = d["icon"] as? String
    iconColor = d["iconColor"] as? String
    count = d["count"] as? String
  }
}

struct GooyaSidebarSection: Hashable {
  let id: String
  let title: String
  let rows: [GooyaSidebarRow]

  init(_ d: [String: Any]) {
    id = d["id"] as? String ?? ""
    title = d["title"] as? String ?? ""
    rows = (d["rows"] as? [[String: Any]] ?? []).map(GooyaSidebarRow.init)
  }
}

/// The sidebar's column, after Apple Calendar's: its calendar list (a heading per account, each calendar with a tick in
/// its colour), then the month at the bottom. A tick shows or hides what it stands for; choosing a link opens it; a
/// day in the month shows that day. Each sends `onSidebar` to JavaScript.
final class GooyaMacSidebarController: UIViewController, UICollectionViewDelegate {
  private var sections: [GooyaSidebarSection] = []
  private var collection: UICollectionView!
  private var source: UICollectionViewDiffableDataSource<String, GooyaSidebarRow>!
  let month = GooyaMiniMonth()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear

    var config = UICollectionLayoutListConfiguration(appearance: .sidebar)
    config.headerMode = .supplementary
    config.showsSeparators = false
    config.backgroundColor = .clear
    collection = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: config))
    collection.backgroundColor = .clear
    collection.delegate = self
    collection.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(collection)

    let cell = UICollectionView.CellRegistration<UICollectionViewListCell, GooyaSidebarRow> { [weak self] cell, _, row in
      self?.configure(cell, row)
    }
    let header = UICollectionView.SupplementaryRegistration<UICollectionViewListCell>(elementKind: UICollectionView.elementKindSectionHeader) { [weak self] view, _, index in
      var content = UIListContentConfiguration.sidebarHeader()
      content.text = self?.sections[safe: index.section]?.title
      content.textProperties.font = .systemFont(ofSize: 11, weight: .semibold)
      content.textProperties.color = .secondaryLabel
      view.contentConfiguration = content
    }
    source = UICollectionViewDiffableDataSource(collectionView: collection) { collection, index, row in
      collection.dequeueConfiguredReusableCell(using: cell, for: index, item: row)
    }
    source.supplementaryViewProvider = { collection, _, index in
      collection.dequeueConfiguredReusableSupplementary(using: header, for: index)
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

  private func apply() {
    var snapshot = NSDiffableDataSourceSnapshot<String, GooyaSidebarRow>()
    for section in sections {
      snapshot.appendSections([section.id])
      snapshot.appendItems(section.rows, toSection: section.id)
    }
    source.apply(snapshot, animatingDifferences: false)
    // Headings may have new names: the diffable source keeps supplementary views as they were.
    var reload = snapshot
    reload.reloadSections(sections.map(\.id))
    source.apply(reload, animatingDifferences: false)
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
    guard let row = source.itemIdentifier(for: indexPath) else { return }
    send(["type": "select", "id": row.id])
    // A link opens what it stands for; a calendar row keeps no lasting selection either.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { collectionView.deselectItem(at: indexPath, animated: true) }
  }

  private func send(_ body: [String: Any]) {
    GooyaMacModule.current?.sendEvent("onSidebar", body)
  }
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
