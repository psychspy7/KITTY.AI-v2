# KITTY AI 2.0.0 — release validation

Released 13 October 2026. Android package com.kitty.ai, versionCode 11, minimum API 26, target API 35. Backend and owner console: https://kitty-ai-v2.kitty-ai.workers.dev . APK: https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-2.0.0.apk . Future versions require code 12 or higher.

## Delivered behavior

Cleaner chat presentation, roomier composer and send action, three starter suggestions, draft restoration scoped to account and conversation, native reply copying, local history search, and a Kitty Corp hub with membership status, support, honest feedback and founder links. Existing identity, Markdown, manual-scroll pause, memory, speech, notifications and updates are preserved. Full chat history remains on the device; bounded personal context remains in Aiven. No private transcripts were added to the public library.

Firebase now holds a historical, openly licensed WikiText-103/Wikipedia reference library: exactly 500,000,000 UTF8 content bytes (decimal 500 MB), packed into 10,056 attributed documents. Relevant excerpts are retrieved using the signed-in user's verified Firebase token and bounded by 4 documents, 3,200 context characters and a 2.5-second deadline. References are treated as untrusted data; the admin core remains authoritative. Retrieval failure leaves chat available. English keyword retrieval has limited coverage and is not live web search. This is reference retrieval, not model training or fine-tuning.

## Verified checks

- Final Android signed release build, 32 unit tests and release lint passed. History search excludes orphan messages. Compiler reported two existing deprecated icon warnings; no release build error.
- APK signature verified; signing certificate matched 1.8.0. APK identity and merged permissions inspected: no microphone, accessibility, SMS, contacts, call-log or phone-control permission.
- Backend: 75 fixture/unit tests passed, including membership ownership, provider status/signature checks, duplicate callbacks, quota/expiry, knowledge bounds and early cancellation. Backend/admin type checks, owner console build and Worker dry run passed.
- Firebase official Rules test engine: 12 authorization/query/schema cases passed. Owner UID alone/email alone is insufficient; default-deny and bounded published reads are enforced.
- Actual Firebase upload completed: 10,056 documents and 500,000,000 content bytes. Live metadata and composite indexed lookup passed; anonymous document access returned 403. Verification time 2026-10-13T15:13:54.745Z. The live indexed lookup used owner OAuth; Google-user rules were checked separately through the official Rules test engine.
- Deployed health/static console returned 200; unauthenticated sync/admin requests returned 401; disallowed origin returned 403. Public APK MIME type, byte count and SHA256 matched the signed local release.
- Worker version ce7b6131-4b6c-460c-8d0b-9418a4f8b40f deployed at 100%; original service/provider/owner configuration retained. In-app release metadata updated only after verifying the public APK.

APK size: 4,495,385 bytes. SHA256: 3bc61fa51b7afd6a51d9464d931cda9bccd27c4dd7b12cbd62bd18092e8159cd.

## Practical limits and owner acceptance

No Android phone was connected for fresh 2.0 acceptance. No actual Google-user-to-provider reference reply, funded speech call, real paid purchase, cancellation/refund payment delivery, or measured device performance improvement was tested in this release. Those are distinct from fixture tests, builds and live access/download checks. Install over the existing APK, then verify login/resume, chat completion/formatting, copying, local search, manual scrolling, sound/settings, memory and membership status using the same Google account. Use Settings → Check for updates or the APK link. Android still asks the user to approve installation.

KITTY Plus retains the existing enabled LIVE checkout: INR 99/calendar month, 100 chat and 10 cloud speech requests/day, manual renewal. The free allowance is five elapsed minutes per UTC day. LISA entitlements and feedback rewards remain off; website services, donations and preorder reservations are separate. This release creates no payment, charge or paid grant. Background notifications use WorkManager polling and depend on permission/battery limits; they are not instant push.

## Cost, source and handover

No payment card or billing activation was added. Firebase Standard Firestore was explicitly created with freeTier true; its 1 GiB free storage and daily read/write quotas still apply. The import uses 10,056 documents, below the reserved 18,000-write budget; source text is 500 MB and indexing overhead is separate. Long reference texts are excluded from indexes. Traffic may exhaust free read/egress quotas; lookup failures fail open. Cloud Storage was not added because its current setup requires Blaze billing. Existing Aiven/provider costs are unchanged; an allowance is not unlimited service capacity.

Source is kept in the existing KITTY.AI-v2 repository and this canonical project. Full handover ZIP includes source, configured public Firebase Android file, original public icon asset, signed APK, complete packed reference corpus, attribution, beginner instructions and docs/CONTINUATION-PROMPT.txt. CRC validation is required before replacing the ZIP. Private keys, signing passwords, CLI sessions, vault keys and private databases are excluded. Keep separate private signing/configuration backups; otherwise another machine cannot publish a compatible signed update. Clean source snapshots exclude generated tools and the large reproducible corpus.
