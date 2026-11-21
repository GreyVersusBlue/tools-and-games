# Content fixtures

Each folder is an overlay on `data/testport/`: the files in it replace the testport file of the
same relative path, and the tools load the result (`node tools/lint-content.mjs testport
--overlay test/fixtures/<name>`). Each one breaks exactly one rule on purpose, and
`test/content.mjs` checks that the right tool fails and names that rule.

| Folder | Fault | Fails with |
| --- | --- | --- |
| `no-later` | a card whose choices have no later effect | lint rule 3 |
| `dominated` | "Pay Odo" is cheaper than "Refuse to pay" and the same otherwise | lint rule 4 |
| `missing-source` | a source id that is not in `sources.json` | lint rule 1 |
| `banned-word` | a banned stem in a choice label | lint rule 5 |
| `d5-unlocked` | a card unlocks a notebook entry marked `"context": "d5"` | lint rule 5 |
| `unknown-key` | `wieght` for `weight` | lint rule 6 |
| `duplicate-id` | two cards with one id | lint rule 6 |
| `web-address` | a web address in a note | lint rule 7 |
| `em-dash` | an em dash in a body | lint rule 7 |
| `over-grade` | a card body far over grade 7.0 | reading level, grade ceiling |
| `long-sentence` | a sentence of more than 22 words | reading level, sentence length |
| `term-without-entry` | a card uses "qirad" and neither unlocks nor requires its entry | reading level, term rule |

Two folders must pass both tools: `d5-entry-ok` (a d5 entry may hold the banned words where it
stands) and `term-with-entry` (the same card as `term-without-entry`, now unlocking the entry).

The web address and the dash are written as JSON escapes (a `\u0068` for the first letter of the address, `\u2014` for the dash), so no file here holds a web address or a dash character; JSON turns them back into text when it loads.
The D5 fixtures hold a banned word in a test entry, which is the one place such a word may go.
