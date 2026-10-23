# Poxia DSC Agent

A small Windows application that lives on a **doctor's own PC**, next to the **USB DSC token**.
When the doctor presses **Sign & Approve** in the LIMS, the report is signed here, with the
doctor's own certificate, and only then released.

```
LIMS (browser) ──► Poxia DSC Agent (this PC, 127.0.0.1) ──► USB token (PIN typed here)
        ▲                          │
        └──────── signed report ───┘   (private key and PIN never leave the PC / token)
```

* One application for every token make (HyperPKI, ProxKey, ePass, SafeNet, mToken…): it talks to the
  token through the vendor's standard **PKCS#11** driver, so no per-vendor code.
* The PIN is typed in the agent window only. It is not stored, not logged, not sent to the LIMS.
* The agent never receives the report: the LIMS prepares the exact bytes to sign; the token signs
  them; the LIMS checks the signature and builds the PDF signature.

## 1. Get the installer (.exe)

### Easiest: build it in the cloud
1. Push a tag that starts with `dsc-v`:
   ```
   git tag dsc-v0.1.0
   git push origin dsc-v0.1.0
   ```
2. GitHub builds it on a Windows machine (workflow *Build & Release Poxia DSC Agent*).
3. Download **Poxia-DSC-Agent-Setup-0.1.0.exe** from that run's *Artifacts*
   (it is also copied to `…/download/` on the server, like the LIS Agent).

### Or build it yourself on a Windows PC
Needs: Node 20+, and the *Desktop development with C++* tools of Visual Studio Build Tools
(the token module, `pkcs11js`, is compiled once during the build; doctors' PCs need nothing).
```
cd Poxia-DSC-Agent
npm install
npm test
npm run dist:win
```
The installer is written to `release\Poxia-DSC-Agent-Setup-<version>.exe`.

> It cannot be built from a Mac or Linux machine: the token module must be compiled on Windows.

## 2. Install on a doctor's PC
1. Install the **token's own driver** (the software that came with the DSC token) — as for any DSC use.
2. Run **Poxia-DSC-Agent-Setup-x.y.z.exe**. It installs per user (no administrator needed) and
   starts in the tray. Tick *Start the agent when this PC starts* in **Settings** so it is always ready.
3. Plug in the token. The agent's header shows **DSC token: …**.
   If it says *not detected*: open **Settings** — the driver list shows which PKCS#11 files were
   found. A token whose driver is elsewhere is added there by its full path (e.g.
   `C:\Windows\System32\eps2003csp11.dll`). Ask the token vendor which `…pkcs11…` file their driver installs.
4. In **Settings**, check *LIMS servers* and *LIMS web pages* list your LIMS address
   (`https://ka-lims.poxiatechnologies.com` is there by default).

The agent is 64-bit. A token with only a 32-bit driver will not load; install the vendor's 64-bit driver.

### Check a new token first
With the token plugged in, run `npm run diagnose` (from source, after `npm install`). It lists the driver files found, the tokens and their certificates — no PIN, nothing signed. If a driver is not found, pass its path: `npm run diagnose -- "C:\path\to\driver.dll"`.

## 3. Turn it on for a hospital (LIMS admin)
**Settings → Digital Signature (DSC)** → tick **Doctors sign with their own USB token (Poxia DSC Agent)**.
Optionally also tick *Require a Digital Signature Certificate*.

## 4. Signing a report (doctor)
1. LIMS → Lab Verification → **Sign & Approve** → type the login password.
2. The agent window comes to the front: check the report details, choose the certificate,
   type the **DSC PIN**, press **Sign report**.
3. The LIMS shows *digitally signed and approved*. For **Approve all**, the token stays unlocked
   for the idle time set in Settings (default 2 minutes), so the PIN is typed once.

The first time a doctor signs, their certificate is registered. After that only that certificate
works for them; a hospital admin can **Reset** it (Settings → Digital Signature) if the doctor gets a new one.

## 5. If something goes wrong
| What you see | What to do |
|---|---|
| "The Poxia DSC Agent is not running" (in the LIMS) | Start *Poxia DSC Agent* from the Start menu; check the header says *Agent running*. |
| "DSC token not detected" | Insert the token; install its driver; add the driver file in Settings. |
| "The PIN is incorrect" | Retry. Tokens lock after a few wrong PINs — the agent warns on the last try. |
| "Port 8765 is already in use" | Change the port in Settings (and tell your LIMS admin — the web page uses 8765). |
| "This certificate cannot be used" | Expired, or not a signing certificate. Use the right certificate / renew the DSC. |
| "This is not the certificate registered for you" | Use the token you signed with before, or ask the admin to **Reset** it. |
| Request "expired" | A signing request lasts 10 minutes. Press Sign & Approve again. |

The **Activity** tab lists what the agent did (never a PIN). The report is only ever released
after the token has signed it; any failure leaves it *not approved*.

## 6. Security notes
* Listens on `127.0.0.1` only; checks the browser's `Origin` and the `Host` header.
* Each signing needs a one-time job token from the LIMS (valid 10 minutes, one report).
* The window can only ask the main process to list certificates, sign, cancel and save settings.
* Not yet implemented: certificate revocation (CRL/OCSP) checks; set `DSC_TRUSTED_ROOTS_PATH` on
  the LIMS server to a bundle of the Controller of Certifying Authorities' roots to have chains verified.
* The signature is a standard PDF signature (PAdES-style, SHA-256 with the signing-certificate
  attribute). A trusted timestamp (needed for long-term validity after the certificate expires) is not added.

## 7. Developer notes
* `npm start` runs it from source (needs `npm install` first). For a rehearsal without a token, set
  **Developer test → .p12 file** in Settings; the .p12 password acts as the PIN.
* `npm test` exercises the signing protocol and the local API against a stand-in LIMS server.
* Local API (127.0.0.1:8765): `GET /health`, `/version`, `/tokens`, `/certificates?token=…`,
  `POST /sign`, `GET /jobs/:id`, `POST /cancel`.
