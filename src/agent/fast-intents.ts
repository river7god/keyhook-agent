/**
 * Layer 1 of the intent funnel: replies so short and fixed that a rule reads them exactly, so
 * no model call is made. A rule only answers when the WHOLE message matches; anything extra
 * ("option 2, the dog will be out", "fixed but it still drips") goes to the model, which also
 * picks up access notes, negation and injection. A miss costs one model call; a wrong match
 * would book the wrong time, so the rules stay narrow.
 */

const MAX_LENGTH = 48;

/** Politeness and filler that never changes the meaning of a short reply. */
const FILLER =
  /\b(please|pls|plz|thanks|thank you|thankyou|ta|cheers|so much|heaps|mate|thx|ty|ok|okay|sure|great|perfect|awesome|lovely|sounds good|that works|works for me|for me|i'?ll take|i'?d like|i'?ll go with|go with|let'?s do|let'?s go with|the|one|is|it|it'?s|its|that|please)\b/g;
const ZH_FILLER = /谢谢你?|多谢|麻烦了|就|吧|好的|可以/g;

function normalise(body: string): string | null {
  const text = body.normalize('NFKC').toLowerCase().trim();
  if (!text || text.length > MAX_LENGTH) return null;
  return text;
}

/** Strip punctuation, emoji and filler words; returns the meaningful remainder. */
function core(text: string): string {
  return text
    .replace(ZH_FILLER, ' ')
    .replace(/[\p{P}\p{S}\p{Extended_Pictographic}]/gu, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ORDINALS: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
};
const ZH_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
};

/**
 * "2", "Option 2 please", "#2", "the second one", "第二个" → 2. Null when the reply says anything
 * else, or the number is not one of the options offered.
 */
export function matchSlotChoice(body: string, optionCount: number): number | null {
  const text = normalise(body);
  if (text === null) return null;
  let n: number | undefined;
  const zh = /^(?:选)?第?([一二两三四1-4])(?:个|号|个时间|个选项)?$/.exec(
    core(text).replace(/\s/g, ''),
  );
  if (zh?.[1] && /[第选个号]/.test(text)) n = ZH_NUM[zh[1]];
  else {
    const c = core(text);
    const m = /^(?:option|opt|number|no|#)?\s*(\d)$/.exec(c);
    if (m?.[1]) n = Number(m[1]);
    else if (c in ORDINALS) n = ORDINALS[c];
    else {
      const o = /^(?:option\s+)?(first|second|third|fourth|1st|2nd|3rd|4th)(?:\s+option)?$/.exec(c);
      if (o?.[1]) n = ORDINALS[o[1]];
    }
  }
  return n !== undefined && n >= 1 && n <= optionCount ? n : null;
}

/** Any of these means the reply is not a plain "yes, it's fixed" — the model reads it. */
const NEGATION =
  /\b(not|no|nope|nah|never|still|but|again|leak\w*|drip\w*|broken|problem|issue|however|except|only|almost|partly|sort of|kind of|half|wrong|worse|n't|dont|didnt|isnt|wasnt|cant|wont)\b|n't|没|不|还|但|仍|漏|坏/;

const YES_WORDS = new Set([
  'yes',
  'yep',
  'yeah',
  'yup',
  'yea',
  'confirmed',
  'confirm',
  'fixed',
  'sorted',
  'working',
  'works',
  'all',
  'good',
  'now',
  'fine',
  'done',
  'great',
  'job',
  'is',
  'all good',
]);
const YES_ANCHORS = /\b(yes|yep|yeah|yup|yea|confirmed?|fixed|sorted|working|works)\b/;
const ZH_YES = /^(?:是的?|对的?|好了|修好了|已经修好了|搞定了)+$/;

/** "Yes", "Yep all fixed, thanks!", "修好了，谢谢" → true. Null (ask the model) for anything else. */
export function matchConfirmation(body: string): true | null {
  const text = normalise(body);
  if (text === null || NEGATION.test(text)) return null;
  const c = core(text);
  if (!c) return null;
  if (/[一-鿿]/.test(c)) return ZH_YES.test(c.replace(/\s/g, '')) ? true : null;
  if (!YES_ANCHORS.test(c)) return null;
  return c.split(' ').every((w) => YES_WORDS.has(w)) ? true : null;
}
