import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { saveField } from 'src/domain/trips/bookings';
import type { Library } from 'src/schema/library';
import { is } from 'src/schema/parse';
import {
  PHRASES_MAX,
  PREP_FIELD_CHARS,
  PREP_NOTES_MAX,
  PhraseSchema,
  PrepNoteSchema,
  type Booking,
  type Phrase,
  type PrepNote,
} from 'src/schema/trip';

export const PREP_TOPIC_ORDER = PrepNoteSchema.fields.topic.literals;
export const PHRASE_SITUATION_ORDER = PhraseSchema.fields.situation.literals;

export function sortNotes(list: readonly PrepNote[]) {
  return list.toSorted(
    (a, b) => PREP_TOPIC_ORDER.indexOf(a.topic) - PREP_TOPIC_ORDER.indexOf(b.topic),
  );
}

export function noteRegions(list: readonly PrepNote[]) {
  return [...new Set(list.map(({ region }) => region).filter(Boolean))];
}

export function filterNotes(
  list: readonly PrepNote[],
  { region, unsure }: { region: string | null; unsure: boolean },
) {
  return list.filter(
    (note) =>
      (region === null || note.region === '' || note.region === region) && (!unsure || note.unsure),
  );
}

export function phraseLangs(list: readonly Phrase[]) {
  return [...new Set(list.map(({ lang }) => lang))];
}

export function phraseSituations(list: readonly Phrase[], lang: string) {
  const situations = new Set(list.filter((phrase) => phrase.lang === lang).map((p) => p.situation));
  return PHRASE_SITUATION_ORDER.filter((situation) => situations.has(situation));
}

export function bookingsOn(list: readonly Booking[], date: string) {
  return list
    .filter((booking) => booking.date === date && booking.status !== 'skipped')
    .sort((a, b) => {
      if (a.at === null) return Number(b.at !== null);
      if (b.at === null) return -1;
      return a.at.slice(11).localeCompare(b.at.slice(11));
    });
}

type Input<T> = Omit<T, 'id'> & { id?: string };
export type PrepNoteInput = Input<PrepNote>;
export type PhraseInput = Input<Phrase>;

export function proposePrepItem<T extends { id: string }>(
  list: readonly T[],
  item: T,
): readonly T[] {
  return list.some(({ id }) => id === item.id)
    ? list.map((current) => (current.id === item.id ? item : current))
    : [...list, item];
}

const limits = {
  prepNotes: { count: PREP_NOTES_MAX, subject: '정보는', length: '정보를 모두 합치면 너무 길어요' },
  phrases: { count: PHRASES_MAX, subject: '문장은', length: '문장을 모두 합치면 너무 길어요' },
};

type PrepKey = keyof typeof limits;

export function prepCountMessage(key: PrepKey) {
  const { subject, count } = limits[key];
  return `${subject} ${count}개까지 적을 수 있어요`;
}

export function prepLimitsIssue(key: PrepKey, list: readonly (PrepNote | Phrase)[]) {
  if (list.length > limits[key].count) return prepCountMessage(key);
  if (JSON.stringify(list).length > PREP_FIELD_CHARS[key]) return limits[key].length;
  return null;
}

const notFound = (id: string): OpResult => ({ ok: false, error: { _tag: 'NotFound', id } });
const invalid = (message: string): OpResult => ({
  ok: false,
  error: { _tag: 'PrepInvalid', message },
});

export function putPrepNote(
  lib: Library,
  tripId: string,
  input: PrepNoteInput,
  ctx: OpCtx,
): OpResult {
  const trip = lib.trips[tripId];
  if (trip === undefined || trip.deletedAt !== null) return notFound(tripId);
  const list = trip.prepNotes?.value ?? [];
  const note = { ...input, id: input.id ?? ctx.newId('booking') };
  if (!is(PrepNoteSchema, note)) return invalid('정보를 다시 확인해 주세요');
  if (input.id === undefined && list.some(({ id }) => id === note.id)) {
    return invalid('정보를 추가하지 못했어요. 다시 시도해 주세요');
  }
  const next = proposePrepItem(list, note);
  const issue = prepLimitsIssue('prepNotes', next);
  return issue === null ? saveField(lib, trip, 'prepNotes', next, ctx) : invalid(issue);
}

export function removePrepNote(lib: Library, tripId: string, id: string, ctx: OpCtx): OpResult {
  const trip = lib.trips[tripId];
  if (trip === undefined || trip.deletedAt !== null) return notFound(tripId);
  return saveField(
    lib,
    trip,
    'prepNotes',
    (trip.prepNotes?.value ?? []).filter((n) => n.id !== id),
    ctx,
  );
}

export function putPhrase(lib: Library, tripId: string, input: PhraseInput, ctx: OpCtx): OpResult {
  const trip = lib.trips[tripId];
  if (trip === undefined || trip.deletedAt !== null) return notFound(tripId);
  const list = trip.phrases?.value ?? [];
  const phrase = { ...input, id: input.id ?? ctx.newId('booking') };
  if (!is(PhraseSchema, phrase)) return invalid('문장을 다시 확인해 주세요');
  if (input.id === undefined && list.some(({ id }) => id === phrase.id)) {
    return invalid('문장을 추가하지 못했어요. 다시 시도해 주세요');
  }
  const next = proposePrepItem(list, phrase);
  const issue = prepLimitsIssue('phrases', next);
  return issue === null ? saveField(lib, trip, 'phrases', next, ctx) : invalid(issue);
}

export function removePhrase(lib: Library, tripId: string, id: string, ctx: OpCtx): OpResult {
  const trip = lib.trips[tripId];
  if (trip === undefined || trip.deletedAt !== null) return notFound(tripId);
  return saveField(
    lib,
    trip,
    'phrases',
    (trip.phrases?.value ?? []).filter((p) => p.id !== id),
    ctx,
  );
}
