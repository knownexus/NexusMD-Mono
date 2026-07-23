// regex-tester-helpers.js — pure, DOM-free regex-matching and code-gen logic
// for RegexTesterView. Mirrors json-editor-helpers.js's pattern: no React, no
// browser globals, independently unit-testable.

export function findMatches(pattern, flagsStr, str) {
  let re
  try { re = new RegExp(pattern, flagsStr + 'd') }
  catch { try { re = new RegExp(pattern, flagsStr) } catch { return null } }

  const results = []
  try {
    if (flagsStr.includes('g')) {
      for (const m of str.matchAll(re)) results.push(buildMatch(m))
    } else {
      const m = re.exec(str)
      if (m) results.push(buildMatch(m))
    }
  } catch {
    // The 'd' flag (match indices) isn't supported in every environment —
    // fall back to matching without it (no per-group highlight indices).
    try {
      const re2 = new RegExp(pattern, flagsStr)
      if (flagsStr.includes('g')) {
        let m, safety = 0
        while ((m = re2.exec(str)) !== null && safety++ < 5000) {
          results.push(buildMatchFallback(m))
          if (!m[0]) re2.lastIndex++
        }
      } else {
        const m = re2.exec(str)
        if (m) results.push(buildMatchFallback(m))
      }
    } catch { /* pattern itself is invalid — already handled above */ }
  }
  return results
}

function buildMatch(m) {
  return { index: m.index, value: m[0], groups: [...m].slice(1), indices: m.indices ? [...m.indices].slice(1) : null, named: m.groups || {} }
}
function buildMatchFallback(m) {
  return { index: m.index, value: m[0], groups: [...m].slice(1), indices: null, named: m.groups || {} }
}

// Converts a match's absolute capture-group indices into match-relative,
// non-overlapping spans for highlight rendering. Overlapping groups (rare,
// e.g. two groups covering the same text) are dropped rather than nested —
// matches the original tool's flat-highlight behavior.
export function groupHighlightSpans(match) {
  if (!match.indices || !match.indices.length) return []
  const base = match.index
  const spans = []
  match.indices.forEach((r, gi) => {
    if (r && r[0] != null) spans.push({ start: r[0] - base, end: r[1] - base, colorIndex: gi % 6 })
  })
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const nonOverlapping = []
  let p = 0
  for (const sp of spans) {
    if (sp.start >= p) { nonOverlapping.push(sp); p = sp.end }
  }
  return nonOverlapping
}

// Splits `str` into an ordered list of segments for the test-string overlay:
// unmatched text (`matchIndex: null`) and matched text (`matchIndex` is the
// index into `matches`, with `groupSpans` for per-group coloring via
// splitMatchByGroups).
export function buildOverlaySegments(str, matches) {
  const segments = []
  let pos = 0
  matches.forEach((m, i) => {
    if (m.index > pos) segments.push({ text: str.slice(pos, m.index), matchIndex: null })
    segments.push({ text: m.value, matchIndex: i, groupSpans: groupHighlightSpans(m) })
    pos = m.index + m.value.length
  })
  if (pos < str.length) segments.push({ text: str.slice(pos), matchIndex: null })
  return segments.length ? segments : [{ text: str, matchIndex: null }]
}

// Splits one matched segment's text into plain/colored pieces per
// groupHighlightSpans, for rendering distinct capture-group colors within a
// single match highlight.
export function splitMatchByGroups(value, groupSpans) {
  if (!groupSpans.length) return [{ text: value, colorIndex: null }]
  const pieces = []
  let p = 0
  groupSpans.forEach(sp => {
    if (sp.start > p) pieces.push({ text: value.slice(p, sp.start), colorIndex: null })
    pieces.push({ text: value.slice(sp.start, sp.end), colorIndex: sp.colorIndex })
    p = sp.end
  })
  if (p < value.length) pieces.push({ text: value.slice(p), colorIndex: null })
  return pieces
}

// Runs each { str, expectMatch } test against pattern/flagsStr, returning
// the same shape plus a `result: 'pass' | 'fail' | 'pending'` field.
// 'pending' when the pattern is empty or invalid.
export function runUnitTests(tests, pattern, flagsStr) {
  let re = null
  if (pattern) {
    try { re = new RegExp(pattern, flagsStr) } catch { re = null }
  }
  return tests.map(t => {
    if (!re) return { ...t, result: 'pending' }
    try {
      const r = new RegExp(re.source, re.flags.replace('g', ''))
      return { ...t, result: r.test(t.str) === t.expectMatch ? 'pass' : 'fail' }
    } catch {
      return { ...t, result: 'pending' }
    }
  })
}

// REFERENCE_DATA — ported verbatim from docs/regex-tester.html's `REF` array
// (originally lines 295-304), renamed on export.
export const REFERENCE_DATA = [
  {t:'Anchors',i:[{k:'^',d:'Start of string (or line with m)'},{k:'$',d:'End of string (or line with m)'},{k:'\\b',d:'Word boundary'},{k:'\\B',d:'Non-word boundary'}]},
  {t:'Character classes',i:[{k:'.',d:'Any character except newline'},{k:'\\d',d:'Digit [0-9]'},{k:'\\D',d:'Not a digit'},{k:'\\w',d:'Word char [a-zA-Z0-9_]'},{k:'\\W',d:'Not a word char'},{k:'\\s',d:'Whitespace'},{k:'\\S',d:'Non-whitespace'},{k:'[abc]',d:'a, b, or c'},{k:'[^abc]',d:'Not a, b, or c'},{k:'[a-z]',d:'Range a to z'}]},
  {t:'Quantifiers',i:[{k:'*',d:'Zero or more (greedy)'},{k:'+',d:'One or more (greedy)'},{k:'?',d:'Zero or one'},{k:'*?',d:'Lazy zero or more'},{k:'+?',d:'Lazy one or more'},{k:'{n}',d:'Exactly n times'},{k:'{n,m}',d:'Between n and m times'}]},
  {t:'Groups',i:[{k:'(abc)',d:'Capturing group'},{k:'(?:abc)',d:'Non-capturing group'},{k:'(?<name>)',d:'Named capturing group'},{k:'(a|b)',d:'Alternation: a or b'},{k:'\\1',d:'Backreference to group 1'},{k:'\\k<name>',d:'Named backreference'}]},
  {t:'Lookarounds',i:[{k:'(?=abc)',d:'Positive lookahead'},{k:'(?!abc)',d:'Negative lookahead'},{k:'(?<=abc)',d:'Positive lookbehind'},{k:'(?<!abc)',d:'Negative lookbehind'}]},
  {t:'Special characters',i:[{k:'\\n',d:'Newline'},{k:'\\t',d:'Tab'},{k:'\\r',d:'Carriage return'},{k:'\\xHH',d:'Hex char (\\x41 = A)'},{k:'\\uHHHH',d:'Unicode point (\\u0041 = A)'}]},
  {t:'Flags',i:[{k:'g',d:'Global — all matches'},{k:'i',d:'Case insensitive'},{k:'m',d:'Multiline'},{k:'s',d:'Dotall (. matches \\n)'},{k:'u',d:'Unicode mode'}]},
  {t:'Substitution tokens',i:[{k:'$&',d:'Whole matched string'},{k:'$1 $2',d:'Capture group 1, 2…'},{k:'$<name>',d:'Named capture group'},{k:'$`',d:'Text before match'},{k:"$'",d:'Text after match'},{k:'$$',d:'Literal dollar sign'}]},
];

// genCode — ported verbatim from docs/regex-tester.html's genCode(l,pat,fStr)
// (originally lines 504-719). l = language name, pat = pattern source,
// fStr = flags string. Already pure (template strings only) in the
// original — this port only adds `export`.
export function genCode(l,pat,fStr){
  const hi=fStr.includes('i'),hm=fStr.includes('m'),hs=fStr.includes('s'),hg=fStr.includes('g');
  const pg=hg?fStr:fStr+'g';
  const pe=pat.replace(/"/g,'\\"').replace(/\\/g,'\\\\');
  if(l==='JS')return(
`const regex = /${pat}/${fStr};
const str = \`your test string\`;

// Test for a match
console.log(regex.test(str));

// First match with details
const m = /${pat}/${fStr.replace('g','')}.exec(str);
if (m) {
  console.log('Match:', m[0], 'at index', m.index);
  // Named groups: m.groups
}

// All matches (global)
const all = [...str.matchAll(/${pat}/${pg})];
all.forEach((m, i) => {
  console.log(\`Match \${i + 1}:\`, m[0]);
  m.slice(1).forEach((g, gi) => console.log(\`  Group \${gi+1}:\`, g));
});

// Replace
const result = str.replace(regex, '$1');
console.log(result);`
  );
  if(l==='Python'){
    const pf=[hi&&'re.IGNORECASE',hm&&'re.MULTILINE',hs&&'re.DOTALL'].filter(Boolean).join(' | ')||'0';
    return(
`import re

pattern = r"${pat}"
text = "your test string"
flags = ${pf}
regex = re.compile(pattern, flags)

# Test
if regex.search(text):
    print("Match found")

# First match
m = regex.search(text)
if m:
    print(f"Match: {m.group(0)} at {m.start()}")
    print("Groups:", m.groups())
    print("Named:", m.groupdict())

# All matches
for m in regex.finditer(text):
    print(f"  {m.group(0)} at {m.start()}-{m.end()}")

# Replace
result = regex.sub("replacement", text)
print(result)`
    );
  }
  if(l==='PHP')return(
`<?php
$pattern = '/${pat.replace(/'/g,"\\'")}/${fStr.replace('g','').replace('u','')}u';
$text = "your test string";

// Test
if (preg_match($pattern, $text, $m)) {
    echo "Match: " . $m[0] . "\\n";
    print_r($m); // includes groups
}

// All matches
preg_match_all($pattern, $text, $matches, PREG_SET_ORDER);
foreach ($matches as $m) {
    echo $m[0] . "\\n";
}

// Replace
$result = preg_replace($pattern, '$1', $text);
echo $result;`
  );
  if(l==='Go'){
    let gf='';if(hi)gf+='(?i)';if(hm)gf+='(?m)';if(hs)gf+='(?s)';
    return(
`package main

import (
\t"fmt"
\t"regexp"
)

func main() {
\tre := regexp.MustCompile(\`${gf}${pat}\`)
\ts := "your test string"

\t// Test
\tfmt.Println(re.MatchString(s))

\t// First match
\tfmt.Println(re.FindString(s))

\t// First match with subgroups
\tm := re.FindStringSubmatch(s)
\tif m != nil {
\t\tfmt.Println("Match:", m[0])
\t\tfmt.Println("Groups:", m[1:])
\t}

\t// All matches with subgroups
\tall := re.FindAllStringSubmatch(s, -1)
\tfor i, m := range all {
\t\tfmt.Printf("Match %d: %s\\n", i+1, m[0])
\t}

\t// Replace
\tresult := re.ReplaceAllString(s, "$1")
\tfmt.Println(result)
}`
    );
  }
  if(l==='Java'){
    const jf=[hi&&'Pattern.CASE_INSENSITIVE',hm&&'Pattern.MULTILINE',hs&&'Pattern.DOTALL'].filter(Boolean).join(' | ')||'0';
    return(
`import java.util.regex.*;

public class RegexExample {
\tpublic static void main(String[] args) {
\t\tString pattern = "${pe}";
\t\tString text = "your test string";
\t\tPattern p = Pattern.compile(pattern, ${jf});
\t\tMatcher m = p.matcher(text);

\t\t// Test
\t\tSystem.out.println(m.find());

\t\t// All matches
\t\tm.reset();
\t\tint i = 1;
\t\twhile (m.find()) {
\t\t\tSystem.out.printf("Match %d: %s at %d%n", i++, m.group(), m.start());
\t\t\tfor (int g = 1; g <= m.groupCount(); g++) {
\t\t\t\tSystem.out.printf("  Group %d: %s%n", g, m.group(g));
\t\t\t}
\t\t}

\t\t// Replace
\t\tm.reset();
\t\tSystem.out.println(m.replaceAll("$1"));
\t}
}`
    );
  }
  if(l==='C#'){
    const cf=['RegexOptions.None',hi&&'RegexOptions.IgnoreCase',hm&&'RegexOptions.Multiline',hs&&'RegexOptions.Singleline'].filter(Boolean).join(' | ');
    return(
`using System;
using System.Text.RegularExpressions;

class Program {
\tstatic void Main() {
\t\tvar pattern = @"${pat.replace(/"/g,'""')}";
\t\tvar text = "your test string";
\t\tvar options = ${cf};
\t\tvar re = new Regex(pattern, options);

\t\t// Test
\t\tConsole.WriteLine(re.IsMatch(text));

\t\t// First match
\t\tvar m = re.Match(text);
\t\tif (m.Success) {
\t\t\tConsole.WriteLine($"Match: {m.Value} at {m.Index}");
\t\t\tfor (int i = 1; i < m.Groups.Count; i++)
\t\t\t\tConsole.WriteLine($"  Group {i}: {m.Groups[i].Value}");
\t\t}

\t\t// All matches
\t\tforeach (Match match in re.Matches(text))
\t\t\tConsole.WriteLine($"Match: {match.Value} at {match.Index}");

\t\t// Replace
\t\tConsole.WriteLine(re.Replace(text, "$1"));
\t}
}`
    );
  }
  if(l==='Ruby'){
    let rf='';if(hi)rf+='i';if(hm)rf+='m';
    return(
`pattern = /${pat}/${rf}
text = "your test string"

# Test
puts !!(text =~ pattern)
puts text.match?(pattern)

# First match
if (m = text.match(pattern))
  puts "Match: #{m[0]} at #{m.begin(0)}"
  puts "Groups: #{m.captures}"
  puts "Named: #{m.named_captures}" # Ruby 2.4+
end

# All matches
text.scan(pattern) { |match| puts match.inspect }

# Replace (first)
result = text.sub(pattern, '\\\\1')
puts result

# Replace all
result_all = text.gsub(pattern, '\\\\1')
puts result_all`
    );
  }
  return '';
}
