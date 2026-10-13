
## Verified latest source snapshot

This project has its own repository. Never merge its Git history or publish it to another Kitty-Corp project's repository.

After a major change: run the relevant project checks, then refresh ONLY this project's clean source snapshot before finishing. From the workspace's Source File Zip directory, run Update-Source-Zips.ps1 -Project kitty-ai, or python source_archive.py --project kitty-ai. The updater validates a temporary ZIP before replacing this project's SOURCE-LATEST.zip. If validation fails, keep the existing snapshot and report the error. Never remove the old verified snapshot first.

Keep credentials, environment files, original signing keys, private user data and live database state out of clean source ZIPs. Preserve them locally. Source ZIPs include working source and a continuation guide, while the live .git directory and the correct existing GitHub repository retain history. No automatic push or deployment is authorized by archive refresh.
