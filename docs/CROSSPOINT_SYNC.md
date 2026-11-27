# CrossPoint Reader Sync

BookOrbit can upload EPUB books from your library to a CrossPoint Reader over Wi-Fi. Books are copied from the library into a folder BookOrbit manages on the reader's SD card.

Reading progress, highlights, bookmarks, and reading status are not part of this sync.

## Requirements

- The CrossPoint Reader and the BookOrbit server must be on the same network, or otherwise reachable from the server.
- Put the reader into File Transfer mode while syncing.
- The server must be able to reach the reader's IP address. In Docker bridge mode, outbound TCP usually works. Enter the address shown on the reader.
- Only books with an EPUB file are uploaded. PDF, CBZ, MOBI, and other formats are skipped.

## Add a reader

1. Open **Settings > Devices > CrossPoint**.
2. Select **Add reader**.
3. Enter the IP address or hostname shown on the reader.
4. Leave the upload port at `81` and the web port at `80` unless your setup uses different ports.
5. Use **Test connection** to check the address. The reader should report its model and firmware.
6. Choose what to sync: all books, selected libraries, or selected collections and smart scopes.
7. Select **Add reader**.

The new reader starts with the managed folder `/BookOrbit`, the filename pattern `{library}/<{authors:first}|Unknown Author>/<{series}/>{originalFilename}`, and all accessible books selected.

## Choose books

Open the reader's edit sheet to change what it receives.

- **All books** sends every EPUB the account can access.
- **Selected libraries** sends every EPUB in the chosen libraries.
- **Selected collections and smart scopes** sends only books in the chosen collections or matching the chosen smart scopes.
- Library access and account content filters still apply in all modes.
- If a selected mode has no choices, nothing is sent.

## Files on the reader

BookOrbit only manages the folder configured for the reader. Files outside that folder are never touched.

The filename pattern is relative to the managed folder. It supports the same tokens as BookOrbit's file naming rules, including title, authors, series, series index, year, publisher, language, library, and the original filename. Modifiers such as `:first`, `:sort`, `:upper`, `:lower`, and `:fixed2` are available, as are optional blocks.

Changing the pattern changes the paths on the next sync. With removal enabled, the old tracked files are deleted after the new copies are uploaded.

**Remove books no longer selected** is off by default. When enabled, files BookOrbit uploaded are deleted from the reader if the book leaves the selection. Files BookOrbit did not upload are never deleted.

## How sync works

- **Sync now** first builds a preview with the number of books, upload size, and removal impact.
- The transfer runs on the server and continues if the settings page is closed.
- Books are uploaded one at a time over the reader's WebSocket upload endpoint.
- A per-reader ledger records the remote path, file hash, and size. Unchanged books are skipped, matching untracked files can be adopted, changed files are replaced, and missing files are uploaded again.
- Only one sync runs per reader at a time.
- A sync interrupted by a server restart is marked interrupted. Run it again to continue; already uploaded books are skipped.
- **Activity** lists recent runs with counts and errors.

## Troubleshooting

**The reader cannot be reached.** Check that it is in File Transfer mode, that it is on the same Wi-Fi network, and that the address is correct.

**The address is not a CrossPoint reader.** Another device answered at that address. Check the IP shown on the reader.

**No books are synced.** Check the selection, the account's library access and content filters, and whether the books have EPUB files.

**A file already exists on the reader.** BookOrbit treats the managed folder as its own. If an untracked file has the same name, the reader upload rejects it. BookOrbit adds a book-id suffix when it detects a collision.

**The reader reports that it is out of space.** Free space on the SD card or reduce the selected books, then run the sync again.

## Limitations

- EPUBs are sent as they are stored in BookOrbit. The Calibre plugin's EPUB optimizer is not part of this version.
- One BookOrbit account should own a given reader. Sharing one reader between accounts can make their managed folders overlap.
