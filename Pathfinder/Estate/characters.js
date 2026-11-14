// The six attendees of the evening sale. index.html renders whatever is here;
// nothing about a character is written into the page itself.
//
// Shape of one entry (every field but slug and name is optional, and a missing
// one simply does not render):
//
//   slug       url-safe id, used in the address bar (#slug) so a phone can be
//              bookmarked straight to its sheet. Never rename one mid-campaign:
//              a player's bookmark is pointing at it.
//   name       as printed in the catalogue
//   epithet    one line under the name ("Retired cartographer")
//   lot        the catalogue number shown on the card
//   portrait   path to the bust image, relative to this folder, or null.
//              null shows a monogram plate instead.
//   blurb      two or three sentences, italic, under the name on the sheet
//   vitals     the big numbers at the top: [{ label, value }]
//   saves      [{ label, value }]
//   attributes [{ label, value }]
//   skills     [{ label, value }]
//   sections   free-form blocks below the numbers:
//              [{ title, items: [{ name, tag, text }] }]
//              (tag is a small right-aligned note such as "2 actions")

export const characters = [1, 2, 3, 4, 5, 6].map(n => ({
  slug: `lot-${n}`,
  name: `Attendee ${n}`,
  epithet: 'Particulars to follow',
  lot: n,
  portrait: null,
  blurb: 'The auctioneer has not yet read this name aloud.',
  vitals: [
    { label: 'HP', value: '—' },
    { label: 'AC', value: '—' },
    { label: 'Perception', value: '—' },
  ],
  saves: [
    { label: 'Fort', value: '—' },
    { label: 'Ref', value: '—' },
    { label: 'Will', value: '—' },
  ],
  attributes: [],
  skills: [],
  sections: [],
}));
