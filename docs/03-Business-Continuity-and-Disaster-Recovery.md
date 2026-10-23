# Karnataka LIMS — Business Continuity and Disaster Recovery Procedure

Tender reference: business-continuity and disaster-recovery procedure (requirement 62), with the low-network operation of requirement 59.
Audience: the Department's IT team, the hosting/operations team, laboratory heads and facility administrators.
Status: draft for adoption. Values marked **[confirm]** are proposals that the Department or the service-level agreement must fix; they are not commitments of the current deployment.

## 1. Purpose and scope

This procedure keeps laboratory services running when something fails, and restores the system and its data afterwards. It covers the application server, the database, the laboratory PCs and analyzers, the network, and the people who respond. It does not replace each hospital's own downtime procedures for non-laboratory services.

## 2. What is protected, and what already helps

| Asset | Failure it must survive | Protection in the system today |
|---|---|---|
| Patient, order, result and billing data | Server loss, disk failure, corruption, accidental deletion | Database in a dedicated container with a persistent volume; logical backup script `ops/backup-ka-lims.sh` and rehearsal restore `ops/restore-ka-lims.sh` (**to be scheduled — section 5**) |
| Audit trail | Tampering | Append-only table with database triggers and a hash chain; `GET /api/audit/verify` proves the chain intact after any restore |
| Result capture from analyzers | Network or server outage | The LIS Agent queues every result locally and sends it when the connection returns; results are checksummed end to end; analyzers also retain their own results |
| Registration and sample collection | Network outage | Offline registration and collection in the LIS Agent and in the mobile Field app, reconciled with duplicate checks on reconnection; the laboratory worklist can be read from a saved copy and analyzer results are matched to today's saved orders |
| Application availability | Process crash, host restart | Containers restart automatically (`restart: unless-stopped`); the database container has a health check and the API waits for it |
| Report authenticity | Loss of certificate | Hospital and doctor certificates are held outside the database in the signing screens/vault; the vault key (`DSC_VAULT_KEY`) is part of the recovery kit (section 7) |

## 3. Recovery objectives **[confirm]**

| Objective | Proposed value | How it is achieved |
|---|---|---|
| Recovery point (data that may be lost) | 24 hours with nightly backups; 15 minutes if database binary logging and log shipping are enabled by the hosting team | Nightly dump (section 5); optional binary-log shipping |
| Recovery time for the service | 4 hours to restore on the same or replacement server | Documented rebuild (section 6) and a rehearsed restore |
| Maximum tolerable downtime for sample processing | None for result capture (agents queue); registration continues offline | LIS Agent offline mode |

## 4. Incident classes and first response

| Class | Examples | Laboratory continues by | Operations respond by |
|---|---|---|---|
| A. Single laboratory cut off | Link or power failure at one hospital | Agent offline mode: register, collect samples and capture results locally; verification and report release wait for the link | Restore connectivity; confirm the agent queue drains (Today's Results shows no *Pending* items) |
| B. Application fault | Backend crash, bad release | Waiting; agents queue | Restart containers; if a release caused it, roll back to the previous image and re-run the health checks |
| C. Database fault | Corruption, disk full | Agents queue; paper requisitions for anything urgent | Section 6 restore |
| D. Server or site loss | Hardware failure, fire, flood | Agents queue for the length of the outage; critical results are telephoned from the analyzer print-out | Section 6 rebuild on a replacement server |
| E. Security incident | Credential leak, malicious change | As the incident dictates | Section 8 |
| F. Analyzer failure | Breakdown | Raise a breakdown ticket and link the affected samples; refer samples to another laboratory | Sample referral workflow; engineering call |

**Declaring an incident.** Anyone who sees a failure informs the laboratory head and the operations contact **[confirm names and numbers]**. The operations lead decides the class, announces it, and keeps a time-stamped log from the first message to closure.

## 5. Backups

1. **Nightly logical backup.** Schedule on the host, for example `15 1 * * * /opt/ka-lims/ops/backup-ka-lims.sh >> /var/log/ka-lims-backup.log 2>&1`. The script takes a consistent snapshot without locking, includes triggers and routines (so the audit-log protection is preserved), compresses it, tests the archive, writes a SHA-256 file beside it and deletes dumps older than `KEEP_DAYS` (default 14).
2. **Off-site copy.** The backup directory must be copied nightly to a second site or object store **[confirm destination and retention]**. A backup that exists only on the server does not survive a server loss.
3. **Verify.** Each morning the log is checked for `backup ok`. Weekly, one dump is restored into the scratch database (section 6.3) and the sanity counts compared with production.
4. **Optional.** Enable MySQL binary logging and ship the logs off-site to bring the recovery point to minutes.
5. **Uploaded files.** Prescription images are stored under `HIMS-backend/uploads`; include that directory in the same off-site copy.
6. **Configuration.** Keep the deployment environment file, the compose file and the certificate material in the recovery kit (section 7), stored separately from the database backups.

## 6. Restoring service

### 6.1 Application restart (classes B)
`docker compose -f docker-compose.ka.yml up -d` then check: the sign-in page loads, `GET /` on the API answers, and a test sign-in succeeds.

### 6.2 Release rollback
Keep the previous images. To roll back, redeploy the previous tag, then re-check as above. Database migrations are additive; if a migration must be undone, restore the pre-release backup rather than editing tables by hand.

### 6.3 Database restore (classes C, D)
1. Announce downtime; stop the API: `docker stop ka_backend`.
2. Choose the newest dump whose checksum verifies.
3. Rehearse first when time allows: `ops/restore-ka-lims.sh <dump> ` restores into `ka-lims_restore_test` and prints row counts.
4. Restore into the live schema: `ops/restore-ka-lims.sh <dump> ka-lims`.
5. Verify: the audit chain (`GET /api/audit/verify` as an auditor) is intact up to the dump time; spot-check the latest patient, sample and result records against paper or analyzer print-outs.
6. Start the API: `docker start ka_backend`. Agents resume sending their queues automatically; duplicates are rejected by the server's duplicate checks.
7. Reconcile the gap: results captured between the backup and the failure are re-sent from agent queues and analyzer memories; registrations made in that window are re-entered from the front-desk record.

### 6.4 Replacement server (class D)
1. Provision a host with Docker, the same compose file and the environment file from the recovery kit.
2. Restore the database as in 6.3 and the `uploads` directory.
3. Point DNS or the reverse proxy at the new host; confirm HTTPS certificates.
4. Check payment webhooks (Razorpay) and the WhatsApp bot address; run the payment reconciliation job once.
5. Ask each laboratory to confirm its LIS Agent shows *Connected*.

## 7. Recovery kit (kept offline, access logged)

Environment file; `JWT_SECRET`, `DSC_VAULT_KEY`, payment and SMTP secrets; hospital signing certificate and password; the compose file and the release images or source tag; DNS and certificate access; the contact list; this procedure. It is reviewed whenever a secret changes and at least twice a year.

## 8. Security incident addendum

Contain (disable affected accounts or device keys from Staff Management / LIS-Agent Keys; reset the hospital certificate if exposed); preserve (export the audit trail for the period); assess with the Privilege Review report and the audit-trail integrity check; recover from a clean backup if integrity is in doubt; notify as required by law and the Department **[confirm obligations and timelines]**.

## 9. Roles and communication **[confirm]**

| Role | Responsibility |
|---|---|
| Operations lead | Declares and closes incidents; runs recovery |
| Database owner | Backups, restores, integrity checks |
| Laboratory head (each facility) | Local downtime procedure; priority of samples; confirms agent queues drained |
| Programme officer / Department IT | Receives status; authorises declaring a disaster and moving to a replacement site |
| Vendor support | Application defects and agent builds |

Status messages go out when an incident is declared, every 60 minutes while it lasts, and at closure with cause and follow-up.

## 10. Testing the plan

| Test | Frequency | Pass criterion |
|---|---|---|
| Backup completes and verifies | Daily (automatic) | `backup ok` and a valid checksum |
| Rehearsal restore into scratch schema | Weekly | Counts match production at the dump time; audit chain verifies |
| Full rebuild on a spare host | Every six months | Service back within the recovery time objective |
| Agent offline drill | Every six months | Disconnect a laboratory, register, collect and capture results; reconnect; nothing lost or duplicated |
| Table-top of a site loss | Yearly | Contacts reached; kit complete |

Each test is recorded with date, who ran it, result and corrections.

## 11. Maintenance of this document

Reviewed yearly and after every incident of class C or above, any change of hosting, and any change to backup tooling. Owner: operations lead. Items marked **[confirm]** are closed when the Department's service-level agreement is signed.
