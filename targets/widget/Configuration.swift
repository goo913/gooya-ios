import AppIntents
import WidgetKit

// "Show: Both · 구야 · 은비" when the widget is edited (long-press → Edit Widget). The choices are relative to the
// signed-in person, so the same widget works on either phone; the names come from the feed the app wrote.

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

struct ShowIntent: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Show"
  static let description = IntentDescription("Whose tasks the widget shows.")

  @Parameter(title: "Show")
  var person: PersonChoice?

  init() {}
  init(person: PersonChoice?) { self.person = person }

  /// "both", "me" or "other".
  var who: String { person?.id ?? "both" }
}
