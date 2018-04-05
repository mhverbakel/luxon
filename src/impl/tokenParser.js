import { parseMillis, isUndefined, untruncateYear, signedOffset } from './util';
import Formatter from './formatter';
import FixedOffsetZone from '../zones/fixedOffsetZone';
import IANAZone from '../zones/IANAZone';

const MISSING_FTP = 'missing Intl.DateTimeFormat.formatToParts support';

function intUnit(regex, post = i => i) {
  return { regex, deser: ([s]) => post(parseInt(s)) };
}

function fixListRegex(s) {
  // make dots optional and also make them literal
  return s.replace(/\./, '\\.?');
}

function stripInsensitivities(s) {
  return s.replace(/\./, '').toLowerCase();
}

function oneOf(strings, startIndex) {
  if (strings === null) {
    return null;
  } else {
    return {
      regex: RegExp(strings.map(fixListRegex).join('|')),
      deser: ([s]) =>
        strings.findIndex(i => stripInsensitivities(s) === stripInsensitivities(i)) + startIndex
    };
  }
}

function offset(regex, groups) {
  return { regex, deser: ([, h, m]) => signedOffset(h, m), groups };
}

function simple(regex) {
  return { regex, deser: ([s]) => s };
}

function literal(t) {
  return { regex: RegExp(t.val), deser: ([s]) => s, literal: true };
}

function unitate(token, loc) {
  if (token.literal) {
    return literal(token);
  }
  switch (token.val) {
    // era
    case 'G':
      return oneOf(loc.eras('short', false), 0);
    case 'GG':
      return oneOf(loc.eras('long', false), 0);
    // years
    case 'y':
      return intUnit(/\d{1,6}/);
    case 'yy':
      return intUnit(/\d{2,4}/, untruncateYear);
    case 'yyyy':
      return intUnit(/\d{4}/);
    case 'yyyyy':
      return intUnit(/\d{4,6}/);
    case 'yyyyyy':
      return intUnit(/\d{6}/);
    // months
    case 'M':
      return intUnit(/\d{1,2}/);
    case 'MM':
      return intUnit(/\d{2}/);
    case 'MMM':
      return oneOf(loc.months('short', false, false), 1);
    case 'MMMM':
      return oneOf(loc.months('long', false, false), 1);
    case 'L':
      return intUnit(/\d{1,2}/);
    case 'LL':
      return intUnit(/\d{2}/);
    case 'LLL':
      return oneOf(loc.months('short', true, false), 1);
    case 'LLLL':
      return oneOf(loc.months('long', true, false), 1);
    // dates
    case 'd':
      return intUnit(/\d{1,2}/);
    case 'dd':
      return intUnit(/\d{2}/);
    // ordinals
    case 'o':
      return intUnit(/\d{1,3}/);
    case 'ooo':
      return intUnit(/\d{3}/);
    // time
    case 'HH':
      return intUnit(/\d{2}/);
    case 'H':
      return intUnit(/\d{1,2}/);
    case 'hh':
      return intUnit(/\d{2}/);
    case 'h':
      return intUnit(/\d{1,2}/);
    case 'mm':
      return intUnit(/\d{2}/);
    case 'm':
      return intUnit(/\d{1,2}/);
    case 's':
      return intUnit(/\d{1,2}/);
    case 'ss':
      return intUnit(/\d{2}/);
    case 'S':
      return intUnit(/\d{1,3}/);
    case 'SSS':
      return intUnit(/\d{3}/);
    case 'u':
      return simple(/\d{1,9}/);
    // meridiem
    case 'a':
      return oneOf(loc.meridiems(), 0);
    // weekYear (k)
    case 'kkkk':
      return intUnit(/\d{4}/);
    case 'kk':
      return intUnit(/\d{2,4}/, untruncateYear);
    // weekNumber (W)
    case 'W':
      return intUnit(/\d{1,2}/);
    case 'WW':
      return intUnit(/\d{2}/);
    // weekdays
    case 'E':
    case 'c':
      return intUnit(/\d/);
    case 'EEE':
      return oneOf(loc.weekdays('short', false, false), 1);
    case 'EEEE':
      return oneOf(loc.weekdays('long', false, false), 1);
    case 'ccc':
      return oneOf(loc.weekdays('short', true, false), 1);
    case 'cccc':
      return oneOf(loc.weekdays('long', true, false), 1);
    // offset/zone
    case 'Z':
    case 'ZZ':
      return offset(/([+-]\d{1,2})(?::(\d{2}))?/, 2);
    case 'ZZZ':
      return offset(/([+-]\d{1,2})(\d{2})?/, 2);
    // we don't support ZZZZ (PST) or ZZZZZ (Pacific Standard Time) in parsing
    // because we don't have any way to figure out what they are
    case 'z':
      return simple(/[A-Za-z_]{1,256}\/[A-Za-z_]{1,256}/);
    default:
      return literal(token);
  }
}

function unitForToken(token, loc) {
  const unit = unitate(token, loc) || {
    invalidReason: MISSING_FTP
  };

  unit.token = token;

  return unit;
}

function buildRegex(units) {
  const re = units.map(u => u.regex).reduce((f, r) => `${f}(${r.source})`, '');
  return [`^${re}$`, units];
}

function match(input, regex, handlers) {
  const matches = input.match(regex);

  if (matches) {
    const all = {};
    let matchIndex = 1;
    for (const i in handlers) {
      if (handlers.hasOwnProperty(i)) {
        const h = handlers[i],
          groups = h.groups ? h.groups + 1 : 1;
        if (!h.literal && h.token) {
          all[h.token.val[0]] = h.deser(matches.slice(matchIndex, matchIndex + groups));
        }
        matchIndex += groups;
      }
    }
    return [matches, all];
  } else {
    return [matches, {}];
  }
}

function dateTimeFromMatches(matches) {
  const toField = token => {
    switch (token) {
      case 'S':
        return 'millisecond';
      case 's':
        return 'second';
      case 'm':
        return 'minute';
      case 'h':
      case 'H':
        return 'hour';
      case 'd':
        return 'day';
      case 'o':
        return 'ordinal';
      case 'L':
      case 'M':
        return 'month';
      case 'y':
        return 'year';
      case 'E':
      case 'c':
        return 'weekday';
      case 'W':
        return 'weekNumber';
      case 'k':
        return 'weekYear';
      default:
        return null;
    }
  };

  let zone;
  if (!isUndefined(matches.Z)) {
    zone = new FixedOffsetZone(matches.Z);
  } else if (!isUndefined(matches.z)) {
    zone = new IANAZone(matches.z);
  } else {
    zone = null;
  }

  if (!isUndefined(matches.h)) {
    if (matches.h < 12 && matches.a === 1) {
      matches.h += 12;
    } else if (matches.h === 12 && matches.a === 0) {
      matches.h = 0;
    }
  }

  if (matches.G === 0 && matches.y) {
    matches.y = -matches.y;
  }

  if (!isUndefined(matches.u)) {
    matches.S = parseMillis(matches.u);
  }

  const vals = Object.keys(matches).reduce((r, k) => {
    const f = toField(k);
    if (f) {
      r[f] = matches[k];
    }

    return r;
  }, {});

  return [vals, zone];
}

/**
 * @private
 */

export function explainFromTokens(locale, input, format) {
  const tokens = Formatter.parseFormat(format);
  const units = [];
  for (var i = 0; i < tokens.length; i++) {
    const unit = unitForToken(tokens[i], locale);
    if (unit.invalidReason) {
      return { input, tokens, invalidReason: unit.invalidReason };
    }
    
    units.push(unit);
  }

  const [regexString, handlers] = buildRegex(units),
    regex = RegExp(regexString, 'i'),
    [rawMatches, matches] = match(input, regex, handlers),
    [result, zone] = matches ? dateTimeFromMatches(matches) : [null, null];

  return { input, tokens, regex, rawMatches, matches, result, zone };
}

export function parseFromTokens(locale, input, format) {
  const { result, zone, invalidReason } = explainFromTokens(locale, input, format);
  return [result, zone, invalidReason];
}
