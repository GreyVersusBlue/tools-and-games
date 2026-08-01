# Vendored libraries

The Final Grade Checker used to pull all three of these from
`cdnjs.cloudflare.com` on every page load. They were vendored instead so the
page loads them from disk, and the spreadsheet export (`xlsx.full.min.js`,
861 KB, 67% of the original total) was removed entirely. See "Why xlsx is
gone" below.

| File | Library | Version | Licence | Size |
| --- | --- | --- | --- | --- |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | MIT | 356 KB |
| `jspdf.plugin.autotable.min.js` | [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) | 3.6.0 | MIT | 37 KB |

**402,489 bytes, 393 KB for the two that remain.** Byte-for-byte as served by
cdnjs on 2026-07-28, fetched from:

```
https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.6.0/jspdf.plugin.autotable.min.js
```

Both carry their MIT notices in the file header.

## None of this loads until you press a button

- **Export PDF** pulls `jspdf.umd.min.js` and `jspdf.plugin.autotable.min.js`. 393 KB.
- **Export CSV** pulls nothing. It's built with a `Blob` and `URL.createObjectURL`, no library at all.
- **Everything else** pulls nothing. The page is 0 KB of library.

They come off local disk, so the first press is not a network round trip.

## Why they are in the repo at all

The hotlinks were three real offsite requests in production, on the one page in
this repo that handles student grades. Two problems, and the smaller one is the
privacy problem:

- A teacher on school wifi with cdnjs behind the content filter got a tool
  whose export buttons silently did nothing. The failure showed up at the
  moment of use, not at load.
- The spreadsheet library was being fetched from a third-party CDN in order to
  write a file of student grades.

Vendoring settles both, and it matches what v4 decided for three.js and what v7
decided for Golden Hour's sand. Each project keeps its own copy (locked
decision #17). `Tools/image-to-pdf.html` also uses jsPDF and gets its own,
because a shared `Tools/libs/` would couple two tools that other threads are
editing right now.

## Why xlsx is gone

`xlsx.full.min.js` (SheetJS Community Edition 0.18.5, Apache-2.0, 861 KB) was
used for exactly one thing: writing `final_grades.xlsx`. It never read a
spreadsheet (the import path is a paste box), and its cell styling (header
fills, grade colours, row banding) was already dead on write: SheetJS
Community drops `cell.s` when it writes a file, checked by unzipping the
output and finding `xl/styles.xml` with one font, no fills, and no cell
carrying a style index.

So the library was buying a file extension, not an appearance. A CSV export
produces the same information, same columns and values, openable
identically in Excel, Google Sheets or Numbers, at zero vendored bytes.
Removed this round. The export button is now "Export CSV" and writes
`final_grades.csv` with a UTF-8 byte-order mark so Excel on Windows reads
accented names correctly.
