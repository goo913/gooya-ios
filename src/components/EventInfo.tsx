import type { AttendeeStatus, EventAttendee, EventConference } from "@shared/model";
import type { SFSymbol } from "expo-symbols";
import { useState, type ReactNode } from "react";
import { Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/theme";
import { GlassCapsule } from "./Glass";
import { Icon } from "./Icon";

// The sections of an event's details as Apple Calendar shows them (iOS 26/27): Location with Join, Invitees with their
// answers, Options, Video Call Information, Details; links in the Calendar app's red. Used by the details sheet and
// the iPad's details pane.

/** A gray section title over a rounded card. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.label2 }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: colors.bg3 }]}>{children}</View>
    </View>
  );
}

function Hairline({ inset = 16 }: { inset?: number }) {
  const colors = useColors();
  return <View style={[styles.hairline, { marginLeft: inset, backgroundColor: colors.separator }]} />;
}

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/** A call provider's tile colour (Apple shows the app's icon there). */
function tileColor(name: string): string {
  if (/meet/i.test(name)) return "#00a862";
  if (/zoom/i.test(name)) return "#0b5cff";
  if (/teams/i.test(name)) return "#5b5fc7";
  if (/webex/i.test(name)) return "#07a5d9";
  if (/facetime/i.test(name)) return "#34c759";
  return "#8e8e93";
}

function Tile({ icon, color }: { icon: SFSymbol; color: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: color }]}>
      <Icon name={icon} size={24} color="#ffffff" weight="semibold" />
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.roundButton, { backgroundColor: pressed ? colors.fill : colors.fill3 }]}>
      <Icon name={icon} size={18} color={colors.label} />
    </Pressable>
  );
}

/**
 * Location: the video call with Join (Google Meet, Zoom, …) and the place, which opens in Maps. A location that is
 * only the call's link is not shown twice.
 */
export function LocationSection({ location, conference }: { location: string; conference: EventConference | null }) {
  const colors = useColors();
  const text = location.trim();
  const place = text && !(conference && text.includes(conference.url)) ? text : "";
  const placeIsLink = /^https?:\/\/\S+$/i.test(place);
  if (!conference && !place) return null;
  return (
    <Section title="Location">
      {conference ? (
        <View style={styles.locRow}>
          <Tile icon="video.fill" color={tileColor(conference.name)} />
          <View style={styles.locText}>
            <Text numberOfLines={1} style={[styles.locTitle, { color: colors.label }]}>
              {conference.name}
            </Text>
            <Text numberOfLines={1} style={[styles.locSub, { color: colors.label2 }]}>
              Video Call
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Join ${conference.name}`} onPress={() => open(conference.url)} style={({ pressed }) => [styles.join, { backgroundColor: pressed ? colors.fill : colors.fill3 }]}>
            <Text style={[styles.joinText, { color: colors.label }]}>Join</Text>
          </Pressable>
          <RoundButton icon="square.and.arrow.up" label="Share the link" onPress={() => void Share.share({ url: conference.url, message: conference.url })} />
        </View>
      ) : null}
      {conference && place ? <Hairline inset={76} /> : null}
      {place ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={placeIsLink ? `Open ${place}` : `Open ${place} in Maps`}
          onPress={() => open(placeIsLink ? place : `maps://?q=${encodeURIComponent(place)}`)}
          style={({ pressed }) => [styles.locRow, pressed && { backgroundColor: colors.fill4 }]}
        >
          <Tile icon={placeIsLink ? "link" : "mappin.and.ellipse"} color={placeIsLink ? "#8e8e93" : colors.red} />
          <Text numberOfLines={3} style={[styles.locPlace, { color: placeIsLink ? colors.red : colors.label }]}>
            {place}
          </Text>
          <RoundButton icon="square.and.arrow.up" label="Share the location" onPress={() => void Share.share({ message: place })} />
        </Pressable>
      ) : null}
    </Section>
  );
}

const STATUS_ICON: Record<AttendeeStatus, { icon: SFSymbol; tint: "green" | "red" | "orange" | "label3"; spoken: string }> = {
  accepted: { icon: "checkmark.circle.fill", tint: "green", spoken: "accepted" },
  declined: { icon: "xmark.circle.fill", tint: "red", spoken: "declined" },
  tentative: { icon: "questionmark.circle.fill", tint: "orange", spoken: "maybe" },
  needsAction: { icon: "questionmark.circle", tint: "label3", spoken: "no answer yet" },
};

function StatusIcon({ status }: { status: AttendeeStatus }) {
  const colors = useColors();
  const s = STATUS_ICON[status];
  return <Icon name={s.icon} size={20} color={colors[s.tint]} />;
}

function AttendeeRow({ a }: { a: EventAttendee }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${a.name || a.email}, ${STATUS_ICON[a.status].spoken}`}
      onPress={() => open(`mailto:${a.email}`)}
      style={({ pressed }) => [styles.attendee, pressed && { backgroundColor: colors.fill4 }]}
    >
      <StatusIcon status={a.status} />
      <View style={styles.attendeeText}>
        <Text numberOfLines={1} style={[styles.attendeeName, { color: colors.label }]}>
          {a.name || a.email}
          {a.self ? <Text style={{ color: colors.label2 }}> (me)</Text> : null}
        </Text>
        {a.name ? (
          <Text numberOfLines={1} style={[styles.attendeeEmail, { color: colors.label2 }]}>
            {a.email}
          </Text>
        ) : null}
      </View>
      {a.optional ? <Text style={[styles.optional, { color: colors.label3 }]}>optional</Text> : null}
    </Pressable>
  );
}

function PillButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? colors.fill : colors.fill3 }]}>
      <Icon name={icon} size={20} color={colors.label} />
      <Text numberOfLines={1} style={[styles.pillText, { color: colors.label }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const SHOWN_ATTENDEES = 8;

/** Invitees (9): the organizer, then everyone with their answer; Mail All and Message All. */
export function InviteesSection({ attendees, count, organizer, title }: { attendees: EventAttendee[]; count?: number; organizer?: { email: string; name?: string; self?: boolean } | null; title: string }) {
  const colors = useColors();
  const [all, setAll] = useState(false);
  const org = attendees.find((a) => a.organizer) ?? (organizer ? { email: organizer.email, name: organizer.name, status: "accepted" as const, organizer: true, self: organizer.self } : null);
  const others = attendees.filter((a) => !a.organizer);
  if (!org && !others.length) return null;
  // Apple counts the people invited, not the organizer ("Invitees (9)" with the organizer above the nine).
  const total = Math.max((count ?? 0) - (org ? 1 : 0), others.length);
  const shown = all ? others : others.slice(0, SHOWN_ATTENDEES);
  const emails = [...(org && !org.self ? [org.email] : []), ...others.filter((a) => !a.self).map((a) => a.email)];
  return (
    <Section title={`Invitees (${total})`}>
      {org ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${org.name || org.email}, organizer`} onPress={() => open(`mailto:${org.email}`)} style={({ pressed }) => [styles.organizer, pressed && { backgroundColor: colors.fill4 }]}>
          <View style={[styles.avatar, { backgroundColor: "#7c83c4" }]}>
            <Text style={styles.avatarText}>{(org.name || org.email).slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.attendeeText}>
            <Text numberOfLines={1} style={[styles.organizerName, { color: colors.label }]}>
              {org.name || org.email}
              {org.self ? <Text style={{ color: colors.label2 }}> (me)</Text> : null}
            </Text>
            <Text style={[styles.attendeeEmail, { color: colors.label2 }]}>Organizer</Text>
          </View>
        </Pressable>
      ) : null}
      {org && shown.length ? <Hairline /> : null}
      {shown.map((a) => (
        <AttendeeRow key={a.email} a={a} />
      ))}
      {!all && others.length > SHOWN_ATTENDEES ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(true)} style={styles.more}>
          <Text style={[styles.moreText, { color: colors.red }]}>{others.length - SHOWN_ATTENDEES} more</Text>
          <Icon name="chevron.down" size={13} color={colors.red} weight="semibold" />
        </Pressable>
      ) : null}
      {total > others.length ? <Text style={[styles.hidden, { color: colors.label3 }]}>and {total - others.length} more in the calendar</Text> : null}
      {emails.length ? (
        <View style={styles.pills}>
          <PillButton icon="envelope" label="Mail All" onPress={() => open(`mailto:${emails.join(",")}?subject=${encodeURIComponent(title)}`)} />
          <PillButton icon="message" label="Message All" onPress={() => open(`sms:/open?addresses=${emails.join(",")}`)} />
        </View>
      ) : null}
    </Section>
  );
}

/** A row of Options: an icon, the name, and the value at the right. */
export function OptionRow({ icon, label, children }: { icon: SFSymbol; label: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.option}>
      <Icon name={icon} size={21} color={colors.label2} />
      <Text style={[styles.optionLabel, { color: colors.label }]}>{label}</Text>
      <View style={styles.optionValue}>{typeof children === "string" ? <Text numberOfLines={1} style={[styles.optionText, { color: colors.label2 }]}>{children}</Text> : children}</View>
    </View>
  );
}

export function OptionLine() {
  return <Hairline inset={52} />;
}

/** "30 minutes before", "At time of event", "1 day before". */
export function alertLabel(minutes: number): string {
  if (minutes <= 0) return "At time of event";
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes === 10080 ? "" : "s"} before`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"} before`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"} before`;
  return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
}

const URL_RE = /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]|www\.[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|tel:[+\d%,;#-]+)/gi;

/** Text with its links, emails and tel: numbers tappable, in red as in Apple Calendar. */
export function LinkedText({ text, style, numberOfLines }: { text: string; style?: object; numberOfLines?: number }) {
  const colors = useColors();
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const raw = m[0];
    const url = /^www\./i.test(raw) ? `https://${raw}` : raw.includes("@") && !/^https?:/i.test(raw) ? `mailto:${raw}` : raw;
    parts.push(
      <Text key={i} style={{ color: colors.red }} onPress={() => open(url)}>
        {raw.startsWith("tel:") ? decodeURIComponent(raw.slice(4)) : raw}
      </Text>,
    );
    last = i + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <Text selectable numberOfLines={numberOfLines} style={style}>
      {parts}
    </Text>
  );
}

/** Long notes and call details show ten lines, then See More. */
export function ExpandableText({ text }: { text: string }) {
  const colors = useColors();
  const long = text.length > 420 || text.split("\n").length > 10;
  const [open, setOpen] = useState(!long);
  return (
    <View style={styles.textBox}>
      <LinkedText text={text} numberOfLines={open ? undefined : 10} style={[styles.body, { color: colors.label }]} />
      {!open ? (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} hitSlop={8} style={styles.seeMore}>
          <Text style={[styles.body, { color: colors.red }]}>See More</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Video Call Information: the link, the dial-in numbers, the meeting ID and passcode. */
export function VideoCallSection({ conference }: { conference: EventConference }) {
  const lines = [conference.url, ...(conference.phones ?? []), ...(conference.details ? [conference.details] : [])];
  return (
    <Section title="Video Call Information">
      <ExpandableText text={lines.join("\n\n")} />
    </Section>
  );
}

const ANSWERS: { value: "accepted" | "tentative" | "declined"; label: string }[] = [
  { value: "accepted", label: "Accept" },
  { value: "tentative", label: "Maybe" },
  { value: "declined", label: "Decline" },
];

/** Accept · Maybe · Decline, floating at the bottom as in Apple Calendar; the chosen answer is filled. */
export function AnswerBar({ status, busy, onAnswer }: { status: AttendeeStatus; busy: boolean; onAnswer: (a: "accepted" | "tentative" | "declined") => void }) {
  const colors = useColors();
  return (
    <GlassCapsule style={styles.answerBar}>
      {ANSWERS.map((a) => {
        const chosen = status === a.value;
        const fill = chosen ? (a.value === "accepted" ? colors.green : a.value === "declined" ? colors.red : colors.fill) : "transparent";
        return (
          <Pressable key={a.value} accessibilityRole="button" accessibilityState={{ selected: chosen, disabled: busy }} disabled={busy} onPress={() => onAnswer(a.value)} style={[styles.answer, { backgroundColor: fill }]}>
            <Text style={[styles.answerText, { color: chosen && a.value !== "tentative" ? "#ffffff" : colors.label, opacity: busy && !chosen ? 0.5 : 1 }]}>{a.label}</Text>
          </Pressable>
        );
      })}
    </GlassCapsule>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 26 },
  sectionTitle: { fontSize: 17, fontWeight: "600", marginLeft: 14, marginBottom: 8 },
  card: { borderRadius: 26, overflow: "hidden" },
  hairline: { height: StyleSheet.hairlineWidth },
  locRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  tile: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  locText: { flex: 1, minWidth: 0 },
  locTitle: { fontSize: 19, fontWeight: "500" },
  locSub: { fontSize: 16, marginTop: 1 },
  locPlace: { flex: 1, fontSize: 17, lineHeight: 22 },
  join: { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  joinText: { fontSize: 17, fontWeight: "500" },
  roundButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  organizer: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontWeight: "600", color: "#ffffff" },
  organizerName: { fontSize: 18 },
  attendee: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  attendeeText: { flex: 1, minWidth: 0 },
  attendeeName: { fontSize: 17 },
  attendeeEmail: { fontSize: 14, marginTop: 1 },
  optional: { fontSize: 13 },
  more: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  moreText: { fontSize: 16 },
  hidden: { paddingHorizontal: 16, paddingBottom: 8, fontSize: 13 },
  pills: { flexDirection: "row", gap: 10, padding: 14, paddingTop: 8 },
  pill: { flex: 1, height: 46, borderRadius: 23, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10 },
  pillText: { fontSize: 17, flexShrink: 1 },
  option: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  optionLabel: { fontSize: 17 },
  optionValue: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  optionText: { fontSize: 17, flexShrink: 1 },
  textBox: { paddingHorizontal: 16, paddingVertical: 14 },
  body: { fontSize: 17, lineHeight: 23 },
  seeMore: { alignSelf: "flex-end", marginTop: 2 },
  answerBar: { flexDirection: "row", padding: 5, borderRadius: 30, gap: 4 },
  answer: { flex: 1, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  answerText: { fontSize: 17, fontWeight: "500" },
});
