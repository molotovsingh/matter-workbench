# Matter Workbench Private VM Recoverability Pack

Generated at: 2026-08-29T08:08:03.714Z
Success: yes
Service URL: http://127.0.0.1:4191

This pack is the private-VM recovery proof. It ties together the Postgres backup, restored-database drill, local storage-object backup, storage hash check, and optional live service check.

## Result

- Database backup: ok
- Database restore drill: ok
- V4 database backup: ok
- V4 database restore drill: ok
- Storage backup: ok
- Storage restore check: ok
- Service check: ok

## Storage Boundary

A DB backup alone is not a complete recovery artifact if any DB row points at local filesystem storage. The storage backup and restore check prove that those file bytes travel with the database backup.
