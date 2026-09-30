import AppIntents
import WidgetKit

// Touch and hold the widget → Edit Widget: Show (both of you, you, or the other person), Layout (the large and extra
// large sizes: two weeks with the list, the month with the list, two weeks alone, or the month with what is on each
// day; the extra large size puts the list beside the grid, or the grid across its whole width) and Appearance (as the
// iPhone is, or always light or always dark). The people's names come from the feed the app wrote, so the same widget
// works on either phone.

struct PersonChoice: AppEntity {
  let id: String
  let name: String

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Person"
  static let defaultQuery = PersonChoiceQuery()
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

  static let both = PersonChoice(id: "both", name: "Both of us")

  static func all() -> [PersonChoice] {
    let feed = FeedStore.cached()
    let me = feed?.person(feed?.me ?? "")?.name ?? "Me"
    let other = feed?.person(feed?.other ?? "")?.name ?? "The other person"
    return [both, PersonChoice(id: "me", name: me), PersonChoice(id: "other", name: other)]
  }
}

struct PersonChoiceQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [PersonChoice] {
    PersonChoice.all().filter { identifiers.contains($0.id) }
  }
  func suggestedEntities() async throws -> [PersonChoice] { PersonChoice.all() }
  func defaultResult() async -> PersonChoice? { PersonChoice.both }
}

extension WidgetLayout: AppEnum {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Layout"
  static let caseDisplayRepresentations: [WidgetLayout: DisplayRepresentation] = [
    .twoWeeks: "Two Weeks & List",
    .monthList: "Month & List",
    .twoWeeksOnly: "Two Weeks",
    .month: "Month",
  ]
}

extension WidgetAppearance: AppEnum {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Appearance"
  static let caseDisplayRepresentations: [WidgetAppearance: DisplayRepresentation] = [
    .system: "System",
    .light: "Light",
    .dark: "Dark",
  ]
}

struct ShowIntent: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "GOOYA"
  static let description = IntentDescription("Whose calendar the widget shows, how, and whether it is light or dark.")

  @Parameter(title: "Show")
  var person: PersonChoice?

  @Parameter(title: "Layout", default: .twoWeeks)
  var layout: WidgetLayout

  @Parameter(title: "Appearance", default: .system)
  var appearance: WidgetAppearance

  // Layout only where there is one to pick (the large and extra large sizes; iPadOS 27 gives the settings sheet
  // .systemLarge for an extra large widget, so the two cannot have different settings); Appearance not on the Lock
  // Screen, which tints widgets.
  static var parameterSummary: some ParameterSummary {
    When(widgetFamily: .oneOf, [.systemLarge, .systemExtraLarge]) {
      Summary {
        \.$person
        \.$layout
        \.$appearance
      }
    } otherwise: {
      When(widgetFamily: .oneOf, [.systemSmall, .systemMedium]) {
        Summary {
          \.$person
          \.$appearance
        }
      } otherwise: {
        Summary {
          \.$person
        }
      }
    }
  }

  init() {}

  /// "both", "me" or "other".
  var who: String { person?.id ?? "both" }
}
