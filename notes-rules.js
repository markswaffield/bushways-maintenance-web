/* GENERATED FILE — DO NOT EDIT.
   Built from supabase/functions/day-sheet/notes-rules.js by
   scripts/build-notes-rules.sh. Edit that file and run the script;
   anything changed here is lost the next time it runs. */
// Reading the five facts out of a booking's notes. THE ONLY COPY.
//
// Dietary, medical, special occasion, bed type, board basis, and the arrival
// and departure movements — read off whatever a reservations consultant
// actually typed. Every rule here was worked out against real ResRequest
// exports, and two of them exist because a wrong answer reached a real sheet:
// the continuation logic in labelled() (a blank-line stop threw away
// "Sarah - SHELLFISH ALLERGY"), and the direction guard in movementFits()
// (an "ex Khwai Guest House" line landed on Boteti's sheet because the dates
// lined up). Change either with care.
//
// WHY IT LIVES HERE AND NOT IN day-sheet.html ANY MORE.
// Two things need these rules now: the Day Sheet page, when somebody opens
// it, and the nightly sweep on the server, so a sheet is already filled in
// by morning (Mark, 2026-10-05: "lets do an automatic AI sweep every night
// after the nightly sync"). Two hand-maintained copies would drift, and the
// copy that drifted would be the one putting a flight in front of the wrong
// driver. So this is the single source.
//
// IT IS PLAIN JAVASCRIPT ON PURPOSE — no type annotations anywhere.
// Deno imports this file directly. The browser cannot use `export`, so
// `scripts/build-notes-rules.sh` generates supabase/web/notes-rules.js from
// this file by deleting the word `export` and nothing else. That only stays
// true while the file is valid JavaScript as written, so do not add types,
// and do not use any syntax a browser would refuse.
//
// AFTER EDITING THIS FILE, RUN: bash scripts/build-notes-rules.sh
//
// Nothing here touches the DOM, the database or the network. Pure text in,
// values out, each carrying the sentence it was copied from — which is what
// the AI layer's invention guard is checked against (D-018).

/* What the camp needs off the Operations Chart, pulled out of free prose.

   Mark, 2026-09-27: Room Type (Twin/Double/Triple), Booking Type (FI/SD),
   Dietaries, Medical, Special Occasions. None of these has a column in the
   export — they are sentences inside the Guest information and Notes blocks,
   written differently by every agent. Measured across 172 real Chobe
   bookings, the labels alone appear as: "Dietary requirements:",
   "Dietaries:", "Dietary:", "Diet:", "Dietaries/allergies:", "Medical
   requirements:", "Medical & dietary Requirement:", "Dietary & medical
   requirements:", "Dietaries & Medical Requirements:", "Special occasions:",
   "Special Occ:", "Spec Occ:", "Special events:", "Special request:".

   So the matching is deliberately loose, and every value carries the phrase
   it came from so a manager can check it. Nothing here is ever the only
   record: the original block is stored whole (bookings.guest_details).  */

// "None", "N/A", "TBA" and friends are an ANSWER — the agent was asked and
// said no. Treated as nothing to show, never as a failure to read.
// Spelled out rather than "anything starting with none", because "None of
// the party eat pork" IS an answer and must not be swallowed. These are the
// real forms seen across 172 bookings, typos included — agents write "None
// advsed" and "None advied" as often as they spell it correctly.
//
// "null" — the AI layer (index.ts's aiExtractCore) is told to return the
// real JSON value null for an unstated fact, and mostly does, but a model
// sometimes writes the literal word "null" inside the value instead — found
// 2026-10-05 against a real booking (Casanova x2), both dietary and medical.
// "northing" — a real typo for "nothing" (Wolff x2, same day), not a
// nonsense word; "nothing"'s own trailing-word list grows a "provided (by
// clients)" branch at the same time, which this specific note also needed.
var NOTHING = new RegExp("^\\s*(?:" + [
  "n\\.?/?a\\.?", "nil", "no", "null", "-", "–", "not applicable", "tba", "tbc", "unknown",
  "non[e]?\\s*(?:advised|advsed|advied|adviced|stated|provided(?:\\s+by\\s+(?:the\\s+)?clients?)?|requested|known|noted|given|reported|for\\s+now|at\\s+this\\s+stage|so\\s+far)?",
  "(?:nothing|northing)\\s*(?:advised|noted|reported|specific|provided(?:\\s+by\\s+(?:the\\s+)?clients?)?)?",
  "not\\s+advised", "none\\s+that\\s+we\\s+know\\s+of"
].join("|") + ")\\s*\\.?\\s*$", "i");

// Labels are classified by the WORDS THEY CONTAIN, not by the order those
// words appear in. That matters: "Medical & dietary Requirement" and
// "Dietary & medical requirements" are both real, both common, and both
// answer two fields at once — so a combined label fills dietary AND medical.
// Matching on the leading word missed half of them.

// occasion: NOT bare "special" — De Laet x2, 2026-10-05, found this reading
// "Dietary or Special requirements: Emma is vegetarian..." as an occasion
// label too, since the word "special" sits right there, and so special_
// occasion ended up holding the dietary sentence a second time. "Special
// request/occasion/event" is a real, deliberate label (measured across the
// 172 bookings above); "special" modifying "requirements" inside an
// otherwise-dietary label is not. "requirements" does not match "request"
// (they diverge at the fifth letter), so this draws the line cleanly without
// a special case for this one agent's wording.
var FIELD_WORDS = {
  dietary:  /dietar|(^|[^a-z])diet([^a-z]|$)|allerg|intoleran/i,
  medical:  /medical|allerg|condition|mobilit|wheelchair/i,
  occasion: /special\s*(?:occasion|event|request)s?\b|(?:^|[^a-z])occasion|\bocc\b|celebrat|anniversar|birthday|honeymoon/i,
  bed:      /room\s*type|bed/i,
  basis:    /basis|board|package/i
};

// Any "Something: value" line, however it is worded.
var LABEL_LINE = /^([A-Za-z][A-Za-z &\/'\-\.]{1,44}?)\s*[:\-]\s*(.*)$/;

// Section headings inside a Guest information block. A continuation run ends
// when one of these turns up; anything else is more of the same section.
var STOP_LABEL = /movement|arriv|arr\b|depart|dep\b|transfer|nationalit|agent|contact|clients?\s*name|repeat|extras?|basis|board|room\s*type|special|medical|dietar|diet\b|allerg|occasion|event|flight|pick\s*up|drop\s*off/i;

function lines(text){
  return String(text || "").split(/\n+/).map(function(l){ return l.trim(); }).filter(Boolean);
}

// The same, but keeping blank lines, because a blank line is what ends a
// paragraph and that matters for continuation below.
function rawLines(text){
  return String(text || "").split(/\n/).map(function(l){ return l.trim(); });
}

// Returns {value, source, confident} for the first line whose LABEL mentions
// this field. A label with nothing after it, or "None", is an answer — the
// agent was asked and said no — not a failure to read.
//
// CONTINUATION, and this one is a safety fix rather than a nicety. Agents
// write the heading, a summary sentence ending in a colon, and then the
// actual detail underneath:
//
//     Dietary requirements: No dietary restrictions aside from a dislike of certain foods:
//     Robert: Seafood, Cauliflower, Mushrooms, Eggplant, Brussels sprouts
//     Lorraine: Strawberries and Coconut
//
// Reading only the heading line puts "No dietary restrictions" on the day
// sheet and throws the allergies away. So when the value is empty or ends in
// a colon, the following lines are taken too, up to a blank line or the next
// real heading.
function labelled(text, key){
  var all = rawLines(text);
  for (var i = 0; i < all.length; i++){
    if (!all[i]) continue;
    var m = all[i].match(LABEL_LINE);
    if (!m) continue;
    if (!FIELD_WORDS[key].test(m[1])) continue;

    var v = (m[2] || "").trim();
    var src = all[i];
    if (!v || /:$/.test(v)){
      // NOT "stop at the next blank line": in this export every paragraph is
      // blank-separated, so that ends the run immediately and throws the
      // detail away. Stop at the next recognised SECTION heading instead —
      // "Movement details:", "Nationality:", "Special events:" — and treat
      // anything else as continuation, including "Robert: Seafood…", which is
      // label-shaped but is a guest's name and is exactly what we are after.
      // blanks must count CONSECUTIVE empty lines, not how many have been
      // seen in total. Counting cumulatively silently truncated every
      // double-spaced block at two lines — and the same export saved as .xlsx
      // is double-spaced where the .csv is single-spaced, so one format
      // dropped two guests' dietary requirements and the other did not.
      // Found by comparing the two versions of one real export; a party's
      // "does not eat fish or seafood" was among what went missing.
      var extra = [], blanks = 0;
      for (var j = i + 1; j < all.length && extra.length < 8; j++){
        if (!all[j]){ if (++blanks >= 2) break; continue; }   // a real gap ends it
        blanks = 0;
        var next = all[j].match(LABEL_LINE);
        if (next && STOP_LABEL.test(next[1])) break;
        extra.push(all[j]);
      }
      if (extra.length){
        v = (v ? v.replace(/:$/, "") + " — " : "") + extra.join("; ");
        src = all.slice(i, i + 1 + extra.length).join(" ");
      }
    }
    v = v.replace(/[.;,\s]+$/, "");
    if (!v || NOTHING.test(v)) return { value: null, source: all[i], confident: true };
    return { value: v, source: src, confident: true };
  }
  return null;
}

var BEDWORDS = /\b(double|twin|triple|single|family|king|queen)\b/i;
var BED_SHORT = { double:"DBL", twin:"TWIN", triple:"TRIP", single:"SGL",
                  family:"FAM", king:"KING", queen:"QUEEN" };

// Mark: "I would abreviate these to TWIN DBL TRIP".
function shortBed(v){
  if (!v) return null;
  var found = [];
  String(v).replace(new RegExp(BEDWORDS.source, "gi"), function(w){
    var s = BED_SHORT[w.toLowerCase()];
    if (s && found.indexOf(s) < 0) found.push(s);
    return w;
  });
  return found.length ? found.join("/") : null;
}

function bed(text){
  var lab = labelled(text, "bed");
  if (lab && lab.value){
    var s = shortBed(lab.value);
    if (s) return { value: s, source: lab.source, confident: true };
  }
  // Very commonly a bare line of its own: "Double", "Twin beds", "Double x 1".
  var all = lines(text);
  for (var i = 0; i < all.length; i++){
    if (all[i].length > 30) continue;                 // a sentence, not a label
    var m = all[i].match(/^(double|twin|triple|single|family|king|queen)\b[\s\w]{0,14}$/i);
    if (m) return { value: BED_SHORT[m[1].toLowerCase()], source: all[i], confident: true };
  }
  // Inside a longer sentence — real, but worth a manager's eye.
  for (var j = 0; j < all.length; j++){
    var m2 = all[j].match(BEDWORDS);
    if (m2) return { value: BED_SHORT[m2[1].toLowerCase()], source: all[j], confident: false };
  }
  return null;
}

// Mark: "Fully Inclusive or Self Drive... FI and SD". Both can be true —
// a self-driving party can still be fully inclusive once they arrive.
//
// FBA — Mark, 2026-10-05: "FBA stands for Full Board and Activities
// (drinks are excluded) wheras FI - drinks are included... this is
// sometimes used here [Khwai] and for BRC... must be treated the same
// as FI." Same meaning for the day sheet either way: the camp provides
// the activities, so a real guide and vehicle are needed, not Self Drive.
var BASES = [
  { code:"FI",  re:/fully\s*inclusive|\bF\.?I\.?\b/i },
  { code:"FBA", re:/full\s*board\s*(?:and|&)\s*activit\w*|\bFBA\b/i },
  { code:"SD",  re:/self[\s-]*driv\w*/i },
  { code:"DBB", re:/\bDBB\b|dinner,?\s*bed\s*(?:&|and)\s*breakfast/i },
  { code:"B&B", re:/\bB\s*&\s*B\b|bed\s*(?:&|and)\s*breakfast/i }
];
function basis(text){
  var all = lines(text), found = [], src = null, sure = false;
  for (var i = 0; i < all.length; i++){
    for (var j = 0; j < BASES.length; j++){
      if (!BASES[j].re.test(all[i])) continue;
      if (found.indexOf(BASES[j].code) < 0){
        found.push(BASES[j].code);
        if (!src) src = all[i];
      }
      // A short line saying only this is a statement of the basis; the same
      // words inside a long movement note are a passing mention.
      if (all[i].length <= 40) sure = true;
    }
  }
  return found.length ? { value: found.join("/"), source: src, confident: sure } : null;
}

// De Laet x2, 2026-10-05: "Special Note is honeymoon" — but "Honeymooners"
// sat on its own line under [note], no colon, no label. labelled() only
// ever looks at "Something: value" lines, so it never saw this at all.
// Same shape bed() already has for a bare "Double" on its own line — try
// the labelled form first, then a short line that's just this word (plus a
// little else — "Honeymoon trip"), then anywhere in a longer sentence, with
// lower confidence since that's a passing mention rather than a statement.
var OCCASION_WORDS = /\b(?:honeymoon(?:ers?)?|anniversary|birthday|engagement|proposal|celebrat\w*)\b/i;
function occasion(text){
  var lab = labelled(text, "occasion");
  if (lab && lab.value) return lab;
  var all = lines(text);
  for (var i = 0; i < all.length; i++){
    if (all[i].length > 30) continue;                 // a sentence, not a bare line
    if (OCCASION_WORDS.test(all[i])) return { value: all[i], source: all[i], confident: true };
  }
  for (var j = 0; j < all.length; j++){
    if (OCCASION_WORDS.test(all[j])) return { value: all[j], source: all[j], confident: false };
  }
  return null;
}

function extract(guestInfo, notes){
  var both = [guestInfo || "", notes || ""].join("\n");
  var out = {};
  ["dietary","medical"].forEach(function(k){
    var r = labelled(both, k);
    if (r) out[k] = r;
  });
  var oc = occasion(both); if (oc) out.occasion = oc;
  var bd = bed(both);      if (bd) out.bed = bd;
  var bs = basis(both);    if (bs) out.basis = bs;
  return out;
}

/* Which line of a booking's movement notes belongs to THIS camp on THIS date.

   The hard part is not finding movement text — nearly every booking has some.
   It is that the text covers the whole itinerary. A party doing Mababe then
   Chobe has both camps' transfers in one block, and putting Mababe's flight in
   front of a Chobe driver is worse than showing nothing.

   Two signals, in order of trust:
     1. A DATE on the line that matches this leg's own arrive or depart date.
        "17 Sept: Please collect from Kasane Airport" against a leg arriving
        17 September is as certain as this gets.
     2. A labelled line — "Arrival Details:", "Depart:" — used only when the
        booking touches ONE camp, because with several there is no way to tell
        which camp's arrival it describes.

   Anything else is left alone for the AI layer, which can weigh the camp names
   in the prose. */

var MONTH = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

// "17 Sept:", "15 Sep 2026 :", "19 Sept -", "03 Oct 2026"
function dateOn(line){
  var m = String(line).match(/(^|[^0-9])(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?\s*(\d{4})?/);
  if (!m) return null;
  var mon = MONTH[m[3].toLowerCase()];
  return mon ? { day: +m[2], month: mon, year: m[4] ? +m[4] : null } : null;
}

function sameDay(d, iso){
  if (!d || !iso) return false;
  var p = String(iso).split("-");
  return d.day === +p[2] && d.month === +p[1] && (!d.year || d.year === +p[0]);
}

var ARRIVE_WORD  = /\barriv|\barr\b|collect|pick\s*up|transfer\s+(?:in|from)|ex\b/i;
var DEPART_WORD  = /\bdepart|\bdep\b|\bleav|drop\s*off|transfer\s+(?:out|to)\b/i;
var MOVEMENT_LABEL = /movement|arriv|arr\b|depart|dep\b|transfer|flight|pick\s*up|drop\s*off/i;
// LABEL_LINE is declared once, near the top with FIELD_WORDS. It was declared
// twice in the page script, which a browser tolerates and an ES module does
// not — a duplicate export is a hard error. Both copies were identical.

// Every Bush Ways property, by full name and by the code the agents use.
// A movement line that names a DIFFERENT camp is that camp's movement, not
// ours, however well its date matches — a party leaving Boteti and reaching
// Khwai the same day has both on one date, and "ex Khwai Guest House" on a
// Boteti sheet would send a Boteti driver to the wrong lodge.
//
// Matched on full names and on codes as whole words, so "Khwai Hippo Pool
// Campsite" (a public site, not ours) is not mistaken for Khwai Guest House.
var CAMPS = [
  { name: "Boteti River Camp",     re: /boteti/i,                          code: /\bBRCC?\b/ },
  { name: "Chobe Elephant Camp",   re: /chobe\s+elephant/i,                code: /\bCEC\b/ },
  { name: "Khwai Guest House",     re: /khwai\s+guest\s+house/i,           code: /\bKGH\b/ },
  { name: "Sango Safari Camp",     re: /sango/i,                           code: /\bSSC\b/ },
  { name: "Mababe Tented Camp",    re: /mababe/i,                          code: /\bMTC\b/ },
  { name: "The Dune Camp",         re: /dune\s+camp/i,                     code: /\bDC\b/ },
  { name: "Deception Valley Lodge", re: /deception\s+valley/i,             code: /\bDVL\b/ }
];

// Does this movement line describe leaving OUR camp, or arriving at it?
//
// Direction is what separates a good line from a wrong one, and a plain
// "does it mention another lodge" test gets it backwards. Naming another
// lodge is normal and useful — "self-driving from Deception Valley Campsite"
// is exactly right for an arrival. What is wrong is the DIRECTION:
//
//   arrival   "...to Boteti from Khwai"      the FROM may be any lodge
//   departure "...ex Boteti to Khwai"        the EX must be ours
//   departure "...ex Khwai Guest House"      <- another camp's departure,
//                                               and the AI put this on
//                                               Boteti's sheet because the
//                                               dates line up: a party can
//                                               leave one lodge and reach the
//                                               next on the same day.
//
// So: whichever lodge sits behind "ex"/"from" owns the departure, and
// whichever sits behind "to"/"at" owns the arrival. If that lodge is not
// ours, the line is not ours.
function movementFits(text, kind, campNames){
  if (!text) return true;
  var mine = (campNames || []).join(" ").toLowerCase();
  var after = kind === "departure"
    ? String(text).match(/\b(?:ex|from|departing|leaving)\s+([A-Za-z][A-Za-z '\-]{2,40})/i)
    : String(text).match(/\b(?:to|at|into|arriving\s+at)\s+([A-Za-z][A-Za-z '\-]{2,40})/i);
  if (!after) return true;                       // no direction word, leave it alone
  var who = after[1];
  var named = null, isMine = false;
  CAMPS.forEach(function(c){
    if (!c.re.test(who) && !c.code.test(who)) return;
    named = named || c.name;
    if (c.re.test(mine)) isMine = true;
  });
  return named ? isMine : true;                  // names no lodge at all -> fine
}

// -1 this line belongs to another camp, +1 it names ours, 0 it names none.
function campFit(line, campNames){
  var mine = (campNames || []).join(" ").toLowerCase();
  var named = null, isMine = false;
  CAMPS.forEach(function(c){
    if (!c.re.test(line) && !c.code.test(line)) return;
    named = named || c.name;
    if (c.re.test(mine)) isMine = true;
  });
  if (!named) return 0;
  return isMine ? 1 : -1;
}

function movement(guestInfo, notes, arriveISO, departISO, campCount, campNames){
  var all = [guestInfo || "", notes || ""].join("\n").split(/\n/)
    .map(function(l){ return l.trim(); }).filter(Boolean);

  var out = {};

  // 1. Date-matched lines. The strongest signal there is.
  all.forEach(function(line){
    var d = dateOn(line);
    if (!d) return;
    var text = line.replace(/^[^:]{0,24}:\s*/, "").trim();   // drop a leading "17 Sept:"
    if (!text || text.length < 6) return;
    if (campFit(line, campNames) < 0) return;        // another camp's movement
    if (sameDay(d, arriveISO) && !out.arrival && movementFits(text, "arrival", campNames))
      out.arrival = { value: text, source: line, confident: true };
    if (sameDay(d, departISO) && !out.departure && movementFits(text, "departure", campNames))
      out.departure = { value: text, source: line, confident: true };
  });

  // 2. Labelled lines — "Arrival Details:", "Arr:", "Departure details:".
  //
  //    The first version only looked at these for a SINGLE-camp booking, on
  //    the reasoning that a two-camp itinerary carries two "Arrival Details:"
  //    lines and nothing says which is which. That was too blunt and it lost
  //    real detail. Mark, 2026-09-29, on two bookings at Chobe: "the
  //    information describing this has not been captured into the Arrival or
  //    Departure notes."  Both read plainly:
  //
  //        Arr:Self drive Ex Nkasa Linyanti to CEC
  //        Arrival Details: ex Kasane Airport... to Chobe Elephant Camp
  //
  //    They name the camp, so there was never any ambiguity to protect
  //    against. The rule now uses the evidence instead of the camp count:
  //
  //      a line naming OUR camp, in the right direction   -> take it
  //      exactly one candidate naming no camp at all      -> take it
  //      several candidates, none naming ours             -> leave it blank
  //
  //    Only the last case is genuinely ambiguous, and only that one is lost.
  ["arrival", "departure"].forEach(function (kind) {
    if (out[kind]) return;                                  // a dated line already won
    var candidates = [];
    all.forEach(function (line) {
      var m = line.match(LABEL_LINE);
      if (!m || !MOVEMENT_LABEL.test(m[1])) return;
      var v = (m[2] || "").trim();
      if (!v || v.length < 6) return;
      var isDep = DEPART_WORD.test(m[1]);
      var isArr = ARRIVE_WORD.test(m[1]) || /movement/i.test(m[1]);
      if (kind === "departure" ? !isDep : !(isArr && !isDep)) return;
      if (campFit(line, campNames) < 0) return;             // another camp's, outright
      if (!movementFits(v, kind, campNames)) return;        // right words, wrong direction
      candidates.push({ line: line, value: v, mine: campFit(line, campNames) > 0 });
    });
    var mine = candidates.filter(function (c) { return c.mine; });
    var pick = mine.length ? mine[0]
             : (candidates.length === 1 ? candidates[0] : null);
    if (pick) out[kind] = { value: pick.value, source: pick.line, confident: true };
  });
  return out;
}
